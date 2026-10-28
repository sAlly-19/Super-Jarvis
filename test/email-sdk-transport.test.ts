import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGmailSdkTransport, createOutlookSdkTransport } from '../src/main/modules/email/providers/sdk-transport'
import type { EmailScope } from '../src/main/modules/email/contracts'
const scope: EmailScope = { context: { taskId: 't', stepId: 's', sessionId: 1, moduleRevision: 0, invocationId: 'i' }, signal: new AbortController().signal, check() {} }
const auth = { accessToken: async () => 'synthetic-access' }

test('attachment SDK responses have a bounded binary budget above the mailbox response limit', async () => {
  const bytes = Buffer.alloc(2097153, 7)
  for (const create of [createGmailSdkTransport, createOutlookSdkTransport]) {
    const google = create === createGmailSdkTransport
    const fetcher: typeof fetch = async () => new Response(JSON.stringify(google ? { size: bytes.length, data: bytes.toString('base64url') } : { '@odata.type': '#microsoft.graph.fileAttachment', id: 'f', contentBytes: bytes.toString('base64') }), { headers: { 'Content-Type': 'application/json' } })
    const transport = create('account', auth, fetcher)
    const data: any = await transport.request('GET', google ? '/messages/m/attachments/f' : '/me/messages/m/attachments/f', undefined, scope)
    assert.ok((google ? data.data : data.contentBytes).length > 2097152)
    await assert.rejects(transport.request('GET', google ? '/messages/m' : '/me/messages/m', undefined, scope), /email_response_limit_exceeded/)
  }
})
test('real Google and Graph clients retain authorization, escaped query and immutable Outlook identity without default retry middleware', async () => {
  const calls: Array<{ url: URL; headers: Headers }> = []
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url), headers: new Headers(init?.headers) })
    return new Response(JSON.stringify({ messages: [], value: [] }), { headers: { 'Content-Type': 'application/json' } })
  }
  await createGmailSdkTransport('account', auth, fetcher).request('GET', '/messages?q=subject%3Aa%26b&maxResults=50', undefined, scope)
  assert.equal(calls[0].url.pathname, '/gmail/v1/users/me/messages')
  assert.equal(calls[0].url.searchParams.get('q'), 'subject:a&b')
  assert.equal(calls[0].headers.get('Authorization'), 'Bearer synthetic-access')
  await createOutlookSdkTransport('account', auth, fetcher).request('GET', '/me/messages', undefined, scope)
  assert.equal(calls[1].url.pathname, '/v1.0/me/messages')
  assert.equal(calls[1].headers.get('Prefer'), 'IdType="ImmutableId"')
  assert.equal(calls[1].headers.get('Authorization'), 'Bearer synthetic-access')
  await assert.rejects(createOutlookSdkTransport('account', auth, fetcher).request('GET', 'https://evil.invalid/steal', undefined, scope), /invalid_email_endpoint/)
  assert.equal(calls.length, 2)
})
test('real read transports make one request on throttle and preserve a bounded private diagnostic', async () => {
  for (const create of [createGmailSdkTransport, createOutlookSdkTransport]) {
    let requests = 0
    const fetcher: typeof fetch = async () => { requests++; return new Response('{"error":"private-provider-body"}', { status: 429, headers: { 'Retry-After': '2', 'Content-Type': 'application/json' } }) }
    await assert.rejects(create('account', auth, fetcher).request('GET', create === createGmailSdkTransport ? '/messages' : '/me/messages', undefined, scope), (error: any) => {
      assert.equal(error.status, 429)
      assert.equal(error.retryAfterMs, 2000)
      assert.doesNotMatch(error.message, /private-provider-body|synthetic-access/)
      return true
    })
    assert.equal(requests, 1)
  }
})
test('real mutation transports never retry Google or Graph POST requests on HTTP 503', async () => {
  for (const create of [createGmailSdkTransport, createOutlookSdkTransport]) {
    let requests = 0
    const fetcher: typeof fetch = async () => { requests++; return new Response('{"error":"private"}', { status: 503, headers: { 'Content-Type': 'application/json' } }) }
    await assert.rejects(create('account', auth, fetcher).request('POST', create === createGmailSdkTransport ? '/drafts/send' : '/me/messages/draft/send', create === createGmailSdkTransport ? { id: 'draft' } : {}, scope), (error: any) => { assert.equal(error.status, 503); return true })
    assert.equal(requests, 1)
  }
})
