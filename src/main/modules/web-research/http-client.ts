import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest, type RequestOptions } from 'node:https'
import { BlockList, isIP, type Socket } from 'node:net'
import { Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib'
import { WebNetworkPolicy, type ApprovedWebTarget } from './network-policy'
import { WebError, WEB_RESPONSE_BYTES, checkWebScope, type SafeHttpResponse, type WebScope, type WebTransport } from './contracts'

export type WebHttpRequest = (url: URL, options: RequestOptions, respond: (response: IncomingMessage) => void) => ClientRequest
const redirects = new Set([301, 302, 303, 307, 308])

/** No ambient cookies, proxy agent, redirects or retries. The caller supplies authority and deadline. */
export class SafeWebHttpClient implements WebTransport {
  private readonly policy: WebNetworkPolicy
  private readonly request: WebHttpRequest
  private readonly now: () => number
  constructor(deps: { policy?: WebNetworkPolicy; request?: WebHttpRequest; now?: () => number } = {}) {
    this.policy = deps.policy ?? new WebNetworkPolicy()
    this.request = deps.request ?? ((url, options, callback) => (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, options, callback))
    this.now = deps.now ?? Date.now
  }

  public async fetch(raw: string, scope: WebScope, options: { method?: 'GET' | 'HEAD'; accept?: string } = {}): Promise<SafeHttpResponse> {
    if (options.method && !['GET', 'HEAD'].includes(options.method)) throw new WebError('blocked_url')
    if (options.accept && (options.accept.length > 256 || /[\r\n\u0000]/.test(options.accept))) throw new WebError('blocked_url')
    let url = raw
    const visited = new Set<string>()
    for (let hop = 0; ; hop++) {
      checkWebScope(scope, this.now)
      const target = await this.policy.approve(url, scope)
      checkWebScope(scope, this.now)
      if (visited.has(target.url)) throw new WebError('blocked_url')
      visited.add(target.url)
      const response = await this.requestOnce(target, scope, options)
      checkWebScope(scope, this.now)
      if (!redirects.has(response.status)) return response
      if (hop >= 5 || !response.headers.location || /[\u0000-\u0020\u007f\\]/.test(response.headers.location)) throw new WebError('blocked_url')
      try { url = new URL(response.headers.location, target.url).href } catch { throw new WebError('blocked_url') }
    }
  }

  private requestOnce(target: ApprovedWebTarget, scope: WebScope, options: { method?: 'GET' | 'HEAD'; accept?: string }): Promise<SafeHttpResponse> {
    checkWebScope(scope, this.now)
    const url = new URL(target.url)
    const hostname = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname
    const requestOptions: RequestOptions = {
      method: options.method ?? 'GET', agent: false, maxHeaderSize: 16384, rejectUnauthorized: true,
      ...(isIP(hostname) ? {} : { servername: hostname }),
      headers: { Host: url.host, Accept: options.accept ?? 'text/html,text/plain;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br', 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.7',
        'User-Agent': 'Jasper-AI-WebResearch/1.0' },
      lookup: (_host, lookupOptions, callback) => {
        // Support both lookup signatures used by Node's single-address and auto-family paths.
        if (typeof lookupOptions === 'object' && lookupOptions.all) {
          (callback as unknown as (error: null, addresses: Array<{ address: string; family: number }>) => void)(null, [{ address: target.address, family: target.family }])
        } else callback(null, target.address, target.family)
      }
    }
    return new Promise((resolve, reject) => {
      let request: ClientRequest | undefined, response: IncomingMessage | undefined, socket: Socket | undefined
      let settled = false, responded = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const connectedEvent = url.protocol === 'https:' ? 'secureConnect' : 'connect'
      const finish = (error?: unknown, result?: SafeHttpResponse): void => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        scope.signal.removeEventListener('abort', abort)
        socket?.removeListener(connectedEvent, connected)
        if (error !== undefined) {
          response?.destroy(); request?.destroy()
          // Do not publish response text or low-level exception messages.
          if (error instanceof WebError) reject(error)
          else {
            try { checkWebScope(scope, this.now) } catch (scopeError) { reject(scopeError); return }
            reject(new WebError('network_unavailable'))
          }
        } else resolve(result!)
      }
      const fail = (error: unknown) => finish(error)
      const abort = () => fail(new WebError('cancelled'))
      const connected = () => {
        if (settled) return
        try {
          checkWebScope(scope, this.now)
          const peer = socket?.remoteAddress
          const allowedPeer = new BlockList()
          allowedPeer.addAddress(target.address, target.family === 4 ? 'ipv4' : 'ipv6')
          const family = peer ? isIP(peer) : 0
          if (!peer || !family || !allowedPeer.check(peer, family === 4 ? 'ipv4' : 'ipv6')) throw new WebError('blocked_url')
          // Do not flush HTTP headers until the socket peer is checked. TLS still uses the original hostname.
          request!.end()
        } catch (error) { fail(error) }
      }
      const onResponse = (message: IncomingMessage) => {
        if (settled) { message.destroy(); return }
        responded = true; response = message
        try { checkWebScope(scope, this.now) } catch (error) { fail(error); return }
        void this.collect(message, scope, options.method === 'HEAD').then(body => {
          checkWebScope(scope, this.now)
          const headers: Record<string, string> = {}
          for (const [name, value] of Object.entries(message.headers)) {
            if (value === undefined || ['set-cookie', 'set-cookie2', 'content-encoding', 'content-length'].includes(name.toLowerCase())) continue
            headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value
          }
          finish(undefined, { url: target.url, status: message.statusCode ?? 0, headers, body })
        }).catch(fail)
      }
      scope.signal.addEventListener('abort', abort, { once: true })
      timer = setTimeout(() => fail(new WebError('timeout')), Math.max(0, scope.deadline - this.now()))
      try {
        checkWebScope(scope, this.now)
        request = this.request(url, requestOptions, onResponse)
        request.on('error', fail)
        request.once('upgrade', (_message, upgradedSocket) => { upgradedSocket.destroy(); fail(new WebError('unsupported_content')) })
        request.once('close', () => { if (!responded && !settled) fail(new WebError('network_unavailable')) })
        request.once('socket', value => {
          socket = value
          if (settled) { value.destroy(); return }
          if (!value.connecting && value.remoteAddress) connected()
          else value.once(connectedEvent, connected)
        })
      } catch (error) { fail(error) }
    })
  }

  private async collect(response: IncomingMessage, scope: WebScope, head: boolean): Promise<Uint8Array> {
    if (!response.statusCode || response.statusCode < 100 || response.statusCode > 599) throw new WebError('network_unavailable')
    if (head) { response.resume(); return new Uint8Array() }
    const contentLength = response.headers['content-length']
    if (contentLength !== undefined && (!/^\d+$/.test(String(contentLength)) || Number(contentLength) > WEB_RESPONSE_BYTES)) throw new WebError('too_large')
    const encoding = String(response.headers['content-encoding'] ?? 'identity').trim().toLowerCase()
    const decoder = encoding === 'gzip' ? createGunzip() : encoding === 'deflate' ? createInflate() : encoding === 'br' ? createBrotliDecompress() : null
    if (!decoder && encoding !== 'identity') throw new WebError('unsupported_content')
    let transferred = 0, decoded = 0
    const chunks: Buffer[] = []
    const count = new Transform({ transform: (chunk: Buffer, _encoding, callback) => {
      try {
        checkWebScope(scope, this.now); transferred += chunk.length
        if (transferred > WEB_RESPONSE_BYTES) throw new WebError('too_large')
        callback(null, chunk)
      } catch (error) { callback(error as Error) }
    } })
    const sink = new Writable({ write: (chunk: Buffer, _encoding, callback) => {
      try {
        checkWebScope(scope, this.now); decoded += chunk.length
        if (decoded > WEB_RESPONSE_BYTES) throw new WebError('too_large')
        chunks.push(Buffer.from(chunk)); callback()
      } catch (error) { callback(error as Error) }
    } })
    try {
      if (decoder) await pipeline(response, count, decoder, sink, { signal: scope.signal })
      else await pipeline(response, count, sink, { signal: scope.signal })
    } catch (error) {
      if (error instanceof WebError) throw error
      checkWebScope(scope, this.now)
      if (typeof (error as NodeJS.ErrnoException)?.code === 'string' && (error as NodeJS.ErrnoException).code!.startsWith('Z_')) throw new WebError('unsupported_content')
      throw error
    }
    checkWebScope(scope, this.now)
    return Buffer.concat(chunks, decoded)
  }
}
