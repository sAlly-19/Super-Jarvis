import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DefaultWebReader } from '../src/main/modules/web-research/reader'
import type { WebScope, SafeHttpResponse } from '../src/main/modules/web-research/contracts'

const scope = (): WebScope => ({ signal: new AbortController().signal, deadline: Date.now() + 30_000, check() {} })
const response = (text: string, type = 'text/html', status = 200): SafeHttpResponse => ({
  url: 'https://example.org/final', status, headers: { 'content-type': type }, body: Buffer.from(text)
})

test('HTTP reader retains short articles, final URL and literal plain text without rendering', async () => {
  for (const [text, type] of [['<article>Short article.</article>', 'text/html'], ['<script>literal text</script>', 'text/plain']]) {
    let calls = 0
    const reader = new DefaultWebReader({ transport: { async fetch() { calls++; return response(text, type) } } })
    const result = await reader.read('https://example.org/start', 'auto', scope())
    assert.equal(result.state, 'ok'); assert.equal(calls, 1)
    assert.equal(result.page?.url, 'https://example.org/final')
    assert.equal(result.page?.mode, 'http')
    assert.equal(result.page?.text, type === 'text/plain' ? text : 'Short article.')
  }
})

test('HTTP release explicitly rejects browser mode and JavaScript shells', async () => {
  let calls = 0
  const reader = new DefaultWebReader({ transport: { async fetch() { calls++; return response('<div id="root"></div><script>app()</script>') } } })
  assert.equal((await reader.read('https://example.org', 'browser', scope())).code, 'render_unavailable')
  assert.equal(calls, 0)
  for (const mode of ['auto', 'http'] as const) assert.equal((await reader.read('https://example.org', mode, scope())).code, 'render_unavailable')
  assert.equal(calls, 2)
})

test('HTTP reader reports access walls, status errors and binary documents without fallback', async () => {
  for (const [body, type, status, code] of [
    ['', 'text/html', 403, 'blocked_access'], ['', 'text/html', 429, 'rate_limited'],
    ['<div class="paywall">Subscribe</div>', 'text/html', 200, 'blocked_access'],
    ['PDF', 'application/pdf', 200, 'unsupported_content']
  ] as const) {
    let calls = 0
    const reader = new DefaultWebReader({ transport: { async fetch() { calls++; return response(body, type, status) } } })
    const result = await reader.read('https://example.org', 'auto', scope())
    assert.equal(result.code, code); assert.equal(result.page, null); assert.equal(calls, 1)
  }
})

test('HTTP reader blocks private targets before transport and discards revoked results', async () => {
  let calls = 0
  const reader = new DefaultWebReader({ transport: { async fetch() { calls++; return response('<article>Text</article>') } } })
  assert.equal((await reader.read('http://127.0.0.1', 'auto', scope())).code, 'blocked_url')
  assert.equal(calls, 0)
  const authority = scope()
  const revoked = new DefaultWebReader({ transport: { async fetch() { authority.check = () => { throw new Error('revoked') }; return response('Text', 'text/plain') } } })
  await assert.rejects(revoked.read('https://example.org', 'auto', authority), /revoked/)
})

test('HTTP reader bounds Unicode plaintext by bytes and includes transport in deadline', async () => {
  const reader = new DefaultWebReader({ transport: { async fetch(_url, bounded) {
    assert.ok(bounded.deadline <= Date.now() + 8_000)
    return response('😀'.repeat(20_000), 'text/plain')
  } } })
  const result = await reader.read('https://example.org', 'http', scope())
  assert.equal(result.state, 'partial'); assert.equal(result.page?.truncated, true)
  assert.equal(Buffer.byteLength(result.page!.text), 48 * 1024)
  assert.ok(!result.page!.text.includes('\ufffd'))
})

test('HTTP reader times out without retry and rejects enclosing cancellation', async () => {
  let calls = 0
  const reader = new DefaultWebReader({ transport: { async fetch() { calls++; return new Promise(() => {}) } } })
  const short = scope()
  short.deadline = Date.now() + 40
  await assert.rejects(reader.read('https://example.org', 'auto', short), /timeout/)
  assert.equal(calls, 1)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(reader.read('https://example.org', 'http', { ...scope(), signal: controller.signal }), /cancelled/)
  assert.equal(calls, 1)
})
