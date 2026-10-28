import http from 'node:http'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { EmailProviderId } from '../../../shared/types/email'
import type { EmailScope } from './contracts'

interface Request { provider: EmailProviderId; buildAuthorizationUrl(redirectUri: string, state: string, challenge: string): string | Promise<string> }
interface Result { code: string; verifier: string; redirectUri: string }
interface Dependencies { openBrowser(url: string): Promise<void>; timeoutMs?: number }
/** Only a transient loopback callback. This never exchanges tokens or opens an embedded browser. */
export class OAuthSession {
  private readonly active = new Map<AbortController, Promise<void>>()
  constructor(private readonly deps: Dependencies) {}
  async begin(request: Request, scope: EmailScope): Promise<Result> {
    scope.signal.throwIfAborted(); scope.check()
    const controller = new AbortController(), signal = AbortSignal.any([controller.signal, scope.signal])
    const verifier = randomBytes(32).toString('base64url'), state = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url'), callbackPath = request.provider === 'outlook' ? '/oauth/microsoft' : `/oauth/${randomBytes(24).toString('hex')}`
    let done!: () => void, redirectUri = '', settled = false
    const closed = new Promise<void>(resolve => { done = resolve })
    this.active.set(controller, closed)
    let accept!: (code: string) => void, reject!: (error: Error) => void
    const callback = new Promise<string>((resolve, fail) => { accept = resolve; reject = fail })
    // Abort may occur before startup/browser opening finishes; attach immediately.
    void callback.catch(() => {})
    const abort = () => reject(signal.reason instanceof Error ? signal.reason : new Error('email_oauth_cancelled'))
    signal.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => controller.abort(new Error('email_oauth_timeout')), this.deps.timeoutMs ?? 300000)
    const server = http.createServer((incoming, response) => {
      response.setHeader('Content-Type', 'text/plain; charset=utf-8')
      response.setHeader('Cache-Control', 'no-store')
      response.setHeader('Connection', 'close')
      const invalid = () => { response.writeHead(400); response.end('Resposta de autorização inválida.') }
      try {
        if (!redirectUri || settled || incoming.method !== 'GET' || !incoming.url || incoming.url.length > 8192) { invalid(); return }
        const url = new URL(incoming.url, redirectUri), expected = new URL(redirectUri)
        const receivedState = url.searchParams.get('state') ?? ''
        if (url.origin !== expected.origin || url.pathname !== callbackPath || incoming.headers.host !== expected.host || url.searchParams.getAll('state').length !== 1 || receivedState.length !== state.length || !timingSafeEqual(Buffer.from(receivedState), Buffer.from(state))) { invalid(); return }
        scope.check(); signal.throwIfAborted()
        if (url.searchParams.has('error')) {
          settled = true; response.end('Autorização não concluída.', () => reject(new Error('email_oauth_denied'))); return
        }
        const code = url.searchParams.get('code')
        if (!code || code.length > 4096 || /[\u0000-\u0020]/.test(code) || url.searchParams.getAll('code').length !== 1) { invalid(); return }
        settled = true
        response.end('Conta autorizada. Você pode retornar ao Jasper.', () => accept(code))
      } catch { invalid() }
    })
    const serverError = () => reject(new Error('email_oauth_listener_failed'))
    server.on('error', serverError)
    try {
      await new Promise<void>((resolve, fail) => {
        const onAbort = () => { cleanup(); fail(signal.reason instanceof Error ? signal.reason : new Error('email_oauth_cancelled')) }
        const onError = () => { cleanup(); fail(new Error('email_oauth_listener_failed')) }
        const cleanup = () => { signal.removeEventListener('abort', onAbort); server.removeListener('error', onError) }
        signal.addEventListener('abort', onAbort, { once: true }); server.once('error', onError)
        server.listen({ host: '127.0.0.1', port: 0, signal }, () => { cleanup(); resolve() })
        if (signal.aborted) onAbort()
      })
      signal.throwIfAborted(); scope.check()
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('email_oauth_listener_failed')
      redirectUri = `http://${request.provider === 'outlook' ? 'localhost' : '127.0.0.1'}:${address.port}${callbackPath}`
      const authorization = await Promise.race([
        Promise.resolve(request.buildAuthorizationUrl(redirectUri, state, challenge)),
        callback.then(() => { throw new Error('email_oauth_cancelled') })
      ])
      signal.throwIfAborted(); scope.check()
      const url = new URL(authorization)
      const origin = request.provider === 'gmail' ? 'https://accounts.google.com' : request.provider === 'outlook' ? 'https://login.microsoftonline.com' : ''
      if (url.origin !== origin || url.username || url.password || url.hash) throw new Error('invalid_email_authorization_url')
      // A stalled OS browser opener must not prevent cancellation/timeout.
      await Promise.race([this.deps.openBrowser(authorization), callback.then(() => {})])
      const code = await callback
      signal.throwIfAborted(); scope.check()
      return { code, verifier, redirectUri }
    } finally {
      clearTimeout(timer); signal.removeEventListener('abort', abort)
      controller.abort(new Error('email_oauth_cancelled'))
      await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections() })
      server.removeListener('error', serverError)
      this.active.delete(controller); done()
    }
  }
  async stop(): Promise<void> {
    const pending = [...this.active]
    for (const [controller] of pending) controller.abort(new Error('email_oauth_cancelled'))
    await Promise.all(pending.map(([, closed]) => closed))
  }
}
