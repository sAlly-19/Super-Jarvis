import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gzipSync, brotliCompressSync, deflateSync } from 'node:zlib'
import { SafeWebHttpClient } from '../src/main/modules/web-research/http-client'
import { WebNetworkPolicy } from '../src/main/modules/web-research/network-policy'
import { fakeHttp } from './fixtures/web/http'
import type { WebScope } from '../src/main/modules/web-research/contracts'

const scope = (ms = 1000, signal = new AbortController().signal): WebScope => ({ deadline: Date.now() + ms, signal, check() {} })
const policy = () => new WebNetworkPolicy({ resolve: async () => [{ address: '93.184.215.14', family: 4 }] })

test('HTTP pins one approved DNS address, retains TLS hostname and strips cookie response headers', async () => {
  let lookups = 0
  const dns = new WebNetworkPolicy({ resolve: async () => { lookups++; return [{ address: '93.184.215.14', family: 4 }] } })
  const driver = fakeHttp([{ headers: { 'content-type': 'text/html', 'set-cookie': 'private-cookie' } }])
  const response = await new SafeWebHttpClient({ policy: dns, request: driver.request }).fetch('https://example.com/article', scope())
  const options = driver.calls[0].options as any
  assert.equal(options.agent, false)
  assert.equal(options.servername, 'example.com')
  assert.equal(options.rejectUnauthorized, true)
  assert.equal(options.maxHeaderSize, 16384)
  assert.equal(options.headers.Host, 'example.com')
  assert.equal(options.headers.Cookie, undefined)
  assert.equal(options.headers.Authorization, undefined)
  const address = await new Promise((resolve, reject) => options.lookup('example.com', {}, (error: Error | null, ip: string) => error ? reject(error) : resolve(ip)))
  assert.equal(address, '93.184.215.14'); assert.equal(lookups, 1)
  assert.equal(response.headers['set-cookie'], undefined)
  assert.equal(Buffer.from(response.body).toString(), 'ok')
})

test('HTTP revalidates redirect destinations and never dials private targets', async () => {
  const driver = fakeHttp([{ status: 302, headers: { location: 'http://127.0.0.1/secret' } }])
  await assert.rejects(new SafeWebHttpClient({ policy: policy(), request: driver.request }).fetch('https://example.com/', scope()), /blocked_url/)
  assert.equal(driver.calls.length, 1)
})

test('HTTP allows five redirects, rejects sixth, loops and malformed Location', async () => {
  const redirects = Array.from({ length: 5 }, (_, i) => ({ status: 302, headers: { location: `/page-${i}` } }))
  const driver = fakeHttp([...redirects, {}])
  const response = await new SafeWebHttpClient({ policy: policy(), request: driver.request }).fetch('https://example.com/', scope())
  assert.equal(response.url, 'https://example.com/page-4')
  for (const replies of [[...redirects, { status: 302, headers: { location: '/sixth' } }],
    [{ status: 302, headers: { location: '/' } }], [{ status: 302, headers: { location: 'https://[' } }]]) {
    const fixture = fakeHttp(replies)
    await assert.rejects(new SafeWebHttpClient({ policy: policy(), request: fixture.request }).fetch('https://example.com/', scope()), /blocked_url|network_unavailable/)
    assert.ok(fixture.calls.length <= 6)
  }
})

test('HTTP enforces the transfer budget and decoded gzip, deflate and brotli budgets', async () => {
  const limit = 2 * 1024 * 1024
  const fixture = fakeHttp([{ chunks: [Buffer.alloc(limit), Buffer.from('x')] }])
  await assert.rejects(new SafeWebHttpClient({ policy: policy(), request: fixture.request }).fetch('https://example.com/', scope()), /too_large/)
  for (const [encoding, encode] of [['gzip', gzipSync], ['deflate', deflateSync], ['br', brotliCompressSync]] as const) {
    const fixture = fakeHttp([{ headers: { 'content-type': 'text/plain', 'content-encoding': encoding }, chunks: [encode(Buffer.alloc(limit + 1, 'a'))] }])
    await assert.rejects(new SafeWebHttpClient({ policy: policy(), request: fixture.request }).fetch('https://example.com/', scope(3000)), /too_large/)
    assert.equal(fixture.calls[0].request.destroyed, true)
  }
})

test('HTTP rejects unsupported encodings, interrupted responses and a mismatching socket peer', async () => {
  for (const reply of [{ headers: { 'content-encoding': 'unknown' } }, { broken: true }, { peer: '127.0.0.1' }]) {
    const fixture = fakeHttp([reply])
    await assert.rejects(new SafeWebHttpClient({ policy: policy(), request: fixture.request }).fetch('https://example.com/', scope()), /unsupported_content|network_unavailable|blocked_url/)
  }
})

test('HTTP timeout and cancellation destroy stalled requests; POST never dispatches', async () => {
  const fixture = fakeHttp([{ stall: true }]), client = new SafeWebHttpClient({ policy: policy(), request: fixture.request })
  await assert.rejects(client.fetch('https://example.com/', scope(15)), /timeout/)
  assert.equal(fixture.calls[0].request.destroyed, true)
  const aborted = fakeHttp([{ stall: true }]), controller = new AbortController()
  const work = new SafeWebHttpClient({ policy: policy(), request: aborted.request }).fetch('https://example.com/', scope(1000, controller.signal))
  await new Promise(resolve => setImmediate(resolve)); controller.abort()
  await assert.rejects(work, /cancelled/); assert.equal(aborted.calls[0].request.destroyed, true)
  const noCalls = fakeHttp([])
  await assert.rejects(new SafeWebHttpClient({ policy: policy(), request: noCalls.request }).fetch('https://example.com/', scope(), { method: 'POST' } as any), /blocked_url/)
  assert.equal(noCalls.calls.length, 0)
})

test('HTTP discards bytes after access revocation and never retries failures', async () => {
  let allowed = true
  const fixture = fakeHttp([{ chunks: [Buffer.from('private')] }])
  const original = fixture.request
  const client = new SafeWebHttpClient({ policy: policy(), request: (url, options, callback) => original(url, options, response => { allowed = false; callback(response) }) })
  await assert.rejects(client.fetch('https://example.com/', { ...scope(), check() { if (!allowed) throw new Error('revoked') } }), /revoked/)
  assert.equal(fixture.calls.length, 1)
})
