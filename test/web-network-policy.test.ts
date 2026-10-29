import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WebNetworkPolicy, isPublicWebAddress } from '../src/main/modules/web-research/network-policy'
import type { WebScope } from '../src/main/modules/web-research/contracts'

const scope = (signal = new AbortController().signal): WebScope => ({ signal, deadline: Date.now() + 1000, check() {} })
const publicAnswer = [{ address: '93.184.215.14', family: 4 as const }]

test('web policy rejects private, encoded, reserved or credentialed URLs before DNS', async () => {
  let queries = 0
  const policy = new WebNetworkPolicy({ resolve: async () => { queries++; return publicAnswer } })
  for (const url of [
    'http://localhost/', 'http://localhost./', 'https://a.local/', 'http://a.internal/',
    'http://127.1/', 'http://0x7f000001/', 'http://2130706433/', 'http://0177.0.0.1/',
    'http://10.0.0.1/', 'http://169.254.169.254/', 'http://100.64.0.1/', 'http://192.0.0.9/',
    'http://198.18.0.1/', 'http://224.1.1.1/', 'http://[::1]/', 'http://[fc00::1]/',
    'http://[fe80::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[2001:db8::1]/',
    'http://[2002:7f00:1::]/', 'http://[3fff::1]/', 'http://[fe80::1%25eth0]/',
    'https://user:secret@example.com/', 'http://@example.com/', 'http://example.com:8080/',
    'file:///C:/secret', 'data:text/plain,test', 'https://example.com/\n',
    'https://example.com/' + 'a'.repeat(4096),
  ]) await assert.rejects(policy.approve(url, scope()), /blocked_url/, url)
  assert.equal(queries, 0)
})

test('web policy resolves public hosts once and canonicalizes public literals without DNS', async () => {
  const calls: string[] = []
  const policy = new WebNetworkPolicy({ resolve: async host => { calls.push(host); return publicAnswer } })
  const result = await policy.approve('https://EXAMPLE.com:443/article#part', scope())
  assert.deepEqual(result, { url: 'https://example.com/article', address: publicAnswer[0].address, family: 4 })
  assert.deepEqual(calls, ['example.com'])
  assert.equal((await policy.approve('https://1.1.1.1/', scope())).address, '1.1.1.1')
  assert.equal((await policy.approve('https://[2606:4700:4700::1111]/', scope())).family, 6)
  assert.equal(calls.length, 1)
})

test('web policy rejects mixed, oversized, missing or malformed DNS answers', async () => {
  for (const answers of [[], [...publicAnswer, { address: '127.0.0.1', family: 4 }],
    [{ address: '93.184.215.14', family: 6 }], [{ address: 'not-an-ip', family: 4 }],
    Array.from({ length: 65 }, () => publicAnswer[0]), [{ address: '::ffff:93.184.215.14', family: 6 }]]) {
    const policy = new WebNetworkPolicy({ resolve: async () => answers as any })
    await assert.rejects(policy.approve('https://example.com/', scope()), /blocked_url|network_unavailable/)
  }
})

test('web policy discards DNS after authority revocation and aborts a stalled lookup', async () => {
  let allowed = true
  const policy = new WebNetworkPolicy({ resolve: async () => { allowed = false; return publicAnswer } })
  await assert.rejects(policy.approve('https://example.com/', { ...scope(), check() { if (!allowed) throw new Error('revoked') } }), /revoked/)
  const controller = new AbortController()
  const stalled = new WebNetworkPolicy({ resolve: () => new Promise(() => {}) })
  const work = stalled.approve('https://example.com/', scope(controller.signal))
  controller.abort()
  await assert.rejects(work, /cancelled/)
  await assert.rejects(stalled.approve('https://example.com/', { ...scope(), deadline: Date.now() - 1 }), /timeout/)
  await assert.rejects(stalled.approve('https://example.com/', { ...scope(), deadline: Date.now() + 10 }), /timeout/)
})

test('public address classification excludes every special subnet and unsafe IPv6 form', () => {
  for (const value of ['0.1.1.1', '192.31.196.1', '192.52.193.1', '192.88.99.1', '192.175.48.1',
    '192.0.2.1', '198.51.100.1', '203.0.113.1', '240.0.0.1', '255.255.255.255',
    '::', '::ffff:8.8.8.8', '64:ff9b::808:808', '2001::1', '2620:4f:8000::1', '3fff::1', 'bad']) {
    assert.equal(isPublicWebAddress(value), false, value)
  }
  assert.equal(isPublicWebAddress('8.8.8.8'), true)
  assert.equal(isPublicWebAddress('2001:4860:4860::8888'), true)
})

test('web URL budget also applies after Unicode percent encoding', () => {
  const policy = new WebNetworkPolicy()
  const base = 'https://example.com/'
  assert.equal(policy.validateUrl(base + 'a'.repeat(4096 - base.length)).href.length, 4096)
  assert.throws(() => policy.validateUrl(base + 'é'.repeat(1000)), /blocked_url/)
})
