import { checkWebScope, withinWebScope, WebError, type WebReader, type WebScope, type WebTransport, type ReadOutcome } from './contracts'
import { decodeWebText } from './html'
import { extractWebPage } from './extraction'
import { WebNetworkPolicy } from './network-policy'

/** HTTP-only release. Remote JavaScript remains disabled until its network gate passes. */
export class DefaultWebReader implements WebReader {
  constructor(private readonly deps: { transport: WebTransport; now?: () => number }) {}

  async read(url: string, mode: 'auto' | 'http' | 'browser', scope: WebScope): Promise<ReadOutcome> {
    const now = this.deps.now ?? Date.now
    const bounded = { ...scope, deadline: Math.min(scope.deadline, now() + 8_000) }
    checkWebScope(scope, now)
    if (!['auto', 'http', 'browser'].includes(mode)) throw new Error('invalid_web_mode')
    if (mode === 'browser') return { state: 'unavailable', page: null, code: 'render_unavailable' }
    try {
      const policy = new WebNetworkPolicy()
      const target = policy.validateUrl(url).href
      const response = await withinWebScope(bounded, () => this.deps.transport.fetch(target, bounded), now)
      checkWebScope(scope, now)
      if (response.status === 429) return { state: 'blocked', page: null, code: 'rate_limited' }
      if ([401, 403].includes(response.status)) return { state: 'blocked', page: null, code: 'blocked_access' }
      if (response.status !== 200) return { state: 'unavailable', page: null, code: 'network_unavailable' }
      const text = decodeWebText(response)
      const meta = { url: policy.validateUrl(response.url).href, fetchedAt: new Date(now()).toISOString(), mode: 'http' as const }
      let result: ReadOutcome
      if (response.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() === 'text/plain') {
        const bytes = Buffer.from(text)
        let end = Math.min(bytes.length, 48 * 1024)
        if (end < bytes.length) while (end && (bytes[end] & 0xc0) === 0x80) end--
        result = { state: end < bytes.length ? 'partial' : 'ok', page: {
          ...meta, title: new URL(meta.url).hostname, text: bytes.subarray(0, end).toString('utf8'),
          publishedAt: null, truncated: end < bytes.length
        } }
      } else {
        const extracted = extractWebPage(text, meta)
        result = extracted.accessBlocked ? { state: 'blocked', page: null, code: 'blocked_access' }
          : extracted.needsRendering ? { state: 'unavailable', page: null, code: 'render_unavailable' }
            : { state: extracted.page.truncated ? 'partial' : 'ok', page: extracted.page }
      }
      checkWebScope(scope, now)
      return result
    } catch (error) {
      checkWebScope(scope, now)
      const code = error instanceof WebError ? error.code : 'network_unavailable'
      return { state: ['blocked_url', 'blocked_access', 'rate_limited'].includes(code) ? 'blocked' : 'unavailable', page: null, code }
    }
  }
}
