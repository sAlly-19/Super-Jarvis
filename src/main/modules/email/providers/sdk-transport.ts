import { gmail, type gmail_v1 } from '@googleapis/gmail'
import { Client } from '@microsoft/microsoft-graph-client'
import type { Context } from '@microsoft/microsoft-graph-client'
import type { EmailScope } from '../contracts'
import type { EmailAuth } from '../auth'

export interface EmailSdkTransport { request(method: string, path: string, body: unknown, scope: EmailScope): Promise<unknown> }
export class EmailRequestError extends Error {
  constructor(readonly code: string, readonly status: number | null = null, readonly retryAfterMs: number | null = null) { super(code) }
}
type TokenSource = Pick<EmailAuth, 'accessToken'>
async function sdkRequest<T>(scope: EmailScope, work: (remember: (error: EmailRequestError) => void) => Promise<T>): Promise<T> {
  let failure: EmailRequestError | undefined
  try { return await work(error => { failure = error }) }
  catch (error) {
    scope.signal.throwIfAborted(); scope.check()
    if (failure) throw new EmailRequestError(failure.code, failure.status, failure.retryAfterMs)
    if (error instanceof EmailRequestError) throw error
    if (error instanceof Error && ['email_reauth_required', 'email_account_unavailable', 'stale_email_account', 'email_crypto_unavailable', 'email_vault_unavailable'].includes(error.message)) throw new Error(error.message)
    throw new EmailRequestError('email_network_failed')
  }
}
function rememberFetch(scope: EmailScope, origin: string, fetcher: typeof fetch, remember: (error: EmailRequestError) => void): typeof fetch {
  return async (input, init) => {
    try { return await boundedFetch(input, init, scope, origin, fetcher) }
    catch (error) { const safe = error instanceof EmailRequestError ? error : new EmailRequestError('email_network_failed'); remember(safe); throw safe }
  }
}
async function boundedFetch(input: RequestInfo | URL, init: RequestInit | undefined, scope: EmailScope, origin: string, fetcher: typeof fetch): Promise<Response> {
  scope.check(); scope.signal.throwIfAborted()
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  if (url.origin !== origin || url.username || url.password) throw new EmailRequestError('invalid_email_endpoint')
  const signal = AbortSignal.any([scope.signal, ...(init?.signal ? [init.signal] : []), AbortSignal.timeout(30000)])
  const response = await fetcher(input, { ...init, signal, redirect: 'error' })
  if (!response.ok) {
    const header = response.headers.get('Retry-After'), seconds = header === null ? NaN : Number(header)
    const retry = Number.isFinite(seconds) ? seconds * 1000 : header ? Date.parse(header) - Date.now() : NaN
    await response.body?.cancel().catch(() => {})
    throw new EmailRequestError(response.status === 401 ? 'email_reauth_required' : response.status === 403 ? 'email_permission_denied' : 'email_provider_rejected', response.status, Number.isFinite(retry) ? Math.max(0, retry) : null)
  }
  const reader = response.body?.getReader(), parts: Uint8Array[] = []
  let size = 0
  try {
    if (reader) while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.length
      const attachmentResponse = (!init?.method || init.method === 'GET') && /^\/(?:gmail\/v1\/users\/me|v1\.0\/me)\/messages\/[^/]+\/attachments\/[^/]+$/.test(url.pathname)
      if (size > (attachmentResponse ? 14082048 : 2097152)) throw new EmailRequestError('email_response_limit_exceeded')
      parts.push(chunk.value)
    }
  } finally { if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock() } }
  scope.check(); scope.signal.throwIfAborted()
  return new Response(size ? Buffer.concat(parts) : null, { status: response.status, statusText: response.statusText, headers: response.headers })
}
export function createGmailSdkTransport(accountId: string, auth: TokenSource, fetcher: typeof fetch = fetch): EmailSdkTransport {
  return { request: async (method, address, body, scope) => sdkRequest(scope, async remember => {
    if (!['GET', 'POST', 'PUT'].includes(method) || !address.startsWith('/') || address.startsWith('//')) throw new EmailRequestError('unsupported_email_request')
    const parsed = new URL(address, 'https://gmail.googleapis.com'), search = parsed.searchParams
    const token = await auth.accessToken(accountId, scope)
    scope.check(); scope.signal.throwIfAborted()
    const safeFetch = rememberFetch(scope, 'https://gmail.googleapis.com', fetcher, remember)
    const sdk = gmail({ version: 'v1', fetchImplementation: (input, init) => safeFetch(input as RequestInfo | URL, init as RequestInit) })
    const options = { signal: scope.signal, retry: false, retryConfig: { retry: 0, noResponseRetries: 0, httpMethodsToRetry: [] as string[] }, maxRedirects: 0, timeout: 30000, headers: { Authorization: `Bearer ${token}` } }
    let response
    if (method === 'POST' && parsed.pathname === '/drafts') response = await sdk.users.drafts.create({ userId: 'me', requestBody: body as gmail_v1.Schema$Draft }, options)
    else if (method === 'POST' && parsed.pathname === '/drafts/send') response = await sdk.users.drafts.send({ userId: 'me', requestBody: body as gmail_v1.Schema$Draft }, options)
    else if (method === 'PUT' && /^\/drafts\/[^/]+$/.test(parsed.pathname)) response = await sdk.users.drafts.update({ userId: 'me', id: decodeURIComponent(parsed.pathname.slice('/drafts/'.length)), requestBody: body as gmail_v1.Schema$Draft }, options)
    else if (method === 'POST' && /^\/messages\/[^/]+\/(modify|trash|untrash)$/.test(parsed.pathname)) {
      const [, , id, action] = parsed.pathname.split('/')
      if (action === 'modify') response = await sdk.users.messages.modify({ userId: 'me', id: decodeURIComponent(id), requestBody: body as gmail_v1.Schema$ModifyMessageRequest }, options)
      else if (action === 'trash') response = await sdk.users.messages.trash({ userId: 'me', id: decodeURIComponent(id) }, options)
      else response = await sdk.users.messages.untrash({ userId: 'me', id: decodeURIComponent(id) }, options)
    }
    else if (method !== 'GET') throw new EmailRequestError('unsupported_email_request')
    else if (parsed.pathname === '/drafts') response = await sdk.users.drafts.list({ userId: 'me', maxResults: Number(search.get('maxResults') ?? 100), pageToken: search.get('pageToken') ?? undefined }, options)
    else if (parsed.pathname === '/messages') response = await sdk.users.messages.list({ userId: 'me', q: search.get('q') ?? undefined, maxResults: Number(search.get('maxResults') ?? 50), pageToken: search.get('pageToken') ?? undefined, labelIds: search.getAll('labelIds') }, options)
    else if (/^\/messages\/[^/]+\/attachments\/[^/]+$/.test(parsed.pathname)) {
      const [, , messageId, , id] = parsed.pathname.split('/')
      response = await sdk.users.messages.attachments.get({ userId: 'me', messageId: decodeURIComponent(messageId), id: decodeURIComponent(id) }, options)
    }
    else if (/^\/messages\/[^/]+$/.test(parsed.pathname)) response = await sdk.users.messages.get({ userId: 'me', id: decodeURIComponent(parsed.pathname.slice('/messages/'.length)), format: search.get('format') ?? 'full', metadataHeaders: search.getAll('metadataHeaders') }, options)
    else if (/^\/threads\/[^/]+$/.test(parsed.pathname)) response = await sdk.users.threads.get({ userId: 'me', id: decodeURIComponent(parsed.pathname.slice('/threads/'.length)), fields: search.get('fields') ?? undefined }, options)
    else if (parsed.pathname === '/labels') response = await sdk.users.labels.list({ userId: 'me' }, options)
    else throw new EmailRequestError('unsupported_email_request')
    scope.check(); scope.signal.throwIfAborted()
    return response.data
  }) }
}
export function createOutlookSdkTransport(accountId: string, auth: TokenSource, fetcher: typeof fetch = fetch): EmailSdkTransport {
  return { request: async (method, address, body, scope) => sdkRequest(scope, async remember => {
    if (!['GET', 'POST', 'PATCH'].includes(method)) throw new EmailRequestError('unsupported_email_request')
    const parsed = address.startsWith('/me/') ? new URL(`/v1.0${address}`, 'https://graph.microsoft.com') : new URL(address)
    if (parsed.origin !== 'https://graph.microsoft.com' || !parsed.pathname.startsWith('/v1.0/me/') || parsed.username || parsed.password) throw new EmailRequestError('invalid_email_endpoint')
    if (method === 'POST' && !/^\/v1\.0\/me\/messages(?:\/[^/]+\/(?:createReply|createForward|send|move|attachments))?$/.test(parsed.pathname)) throw new EmailRequestError('unsupported_email_request')
    if (method === 'PATCH' && !/^\/v1\.0\/me\/messages\/[^/]+$/.test(parsed.pathname)) throw new EmailRequestError('unsupported_email_request')
    if (method !== 'GET' && Buffer.byteLength(JSON.stringify(body ?? {})) > 4000000) throw new EmailRequestError('email_request_limit_exceeded')
    const token = await auth.accessToken(accountId, scope)
    scope.check(); scope.signal.throwIfAborted()
    const safeFetch = rememberFetch(scope, 'https://graph.microsoft.com', fetcher, remember)
    const sdk = Client.initWithMiddleware({ defaultVersion: 'v1.0', middleware: [{ execute: async (context: Context) => {
      context.response = await safeFetch(context.request, context.options as RequestInit)
    } }] })
    const request = sdk.api(parsed.toString()).headers({ Authorization: `Bearer ${token}`, Prefer: 'IdType="ImmutableId"' }).option('signal', scope.signal)
    const data = method === 'GET' ? await request.get() : method === 'POST' ? await request.post(body ?? {}) : await request.patch(body ?? {})
    scope.check(); scope.signal.throwIfAborted()
    return data
  }) }
}
