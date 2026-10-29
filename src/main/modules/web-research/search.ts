import { WebNetworkPolicy } from './network-policy'
import { findAll, parseDocument, hasClass, elementText, decodeWebText, type HtmlElement } from './html'
import { checkWebScope, withinWebScope, WebError, type SearchHit, type SearchOutcome, type WebScope, type WebTransport } from './contracts'

export class DuckDuckGoSearch {
  private readonly policy: WebNetworkPolicy
  private readonly now: () => number
  constructor(private readonly deps: { transport: WebTransport; policy?: WebNetworkPolicy; now?: () => number }) {
    this.policy = deps.policy ?? new WebNetworkPolicy()
    this.now = deps.now ?? Date.now
  }

  public async search(raw: string, scope: WebScope): Promise<SearchOutcome> {
    if (typeof raw !== 'string' || raw.length > 500 || !raw.trim() || /[\u0000-\u001f\u007f]/.test(raw)) throw new Error('invalid_web_query')
    const query = raw.trim().normalize('NFC')
    if (query.length > 500) throw new Error('invalid_web_query')
    const bounded: WebScope = { ...scope, deadline: Math.min(scope.deadline, this.now() + 15_000) }
    const outcome = (state: SearchOutcome['state'], results: SearchHit[] = [], code?: SearchOutcome['code']): SearchOutcome => ({
      state, query, results, queriedAt: new Date(this.now()).toISOString(), ...(code ? { code } : {})
    })
    checkWebScope(bounded, this.now)
    try {
      const url = new URL('https://html.duckduckgo.com/html/')
      url.searchParams.set('q', query)
      const response = await withinWebScope(bounded, () => this.deps.transport.fetch(url.href, bounded), this.now)
      checkWebScope(bounded, this.now)
      if (response.status === 429) return outcome('blocked', [], 'rate_limited')
      if ([401, 403].includes(response.status)) return outcome('blocked', [], 'blocked_access')
      if (response.status !== 200) return outcome('unavailable', [], 'network_unavailable')
      const document = parseDocument(decodeWebText(response))
      const challenge = findAll(node => node.attribs.id === 'challenge-form' || hasClass(node, 'anomaly-modal')
        || (node.name === 'form' && (node.attribs.action ?? '').includes('/anomaly.js')), document.children)
      if (challenge.length) return outcome('blocked', [], 'blocked_access')
      const cards = findAll(node => hasClass(node, 'result') && !this.isAdvertisement(node), document.children)
      const results: SearchHit[] = []
      const visited = new Set<string>()
      let invalid = false
      for (const card of cards) {
        const anchor = findAll(node => node.name === 'a' && hasClass(node, 'result__a'), card.children)[0]
        if (!anchor?.attribs.href) continue
        let destination: string
        try { destination = this.destination(anchor.attribs.href) }
        catch { invalid = true; continue }
        if (visited.has(destination)) continue
        const title = elementText(anchor, 512)
        if (!title) continue
        const snippet = findAll(node => hasClass(node, 'result__snippet'), card.children)[0]
        visited.add(destination)
        results.push({ title, url: destination, snippet: snippet ? elementText(snippet, 2000) : '' })
        if (results.length === 5) break
      }
      checkWebScope(bounded, this.now)
      if (results.length) return outcome('ok', results)
      if (invalid) return outcome('unavailable', [], 'blocked_url')
      if (findAll(node => hasClass(node, 'no-results__message') || node.attribs.id === 'no-results', document.children).length) return outcome('empty')
      return outcome('unavailable', [], 'layout_changed')
    } catch (error) {
      // Revocation/cancellation of the enclosing operation must still invalidate the result.
      checkWebScope(scope, this.now)
      const code = error instanceof WebError ? error.code : 'network_unavailable'
      return outcome(code === 'blocked_url' || code === 'blocked_access' || code === 'rate_limited' ? 'blocked' : 'unavailable', [], code)
    }
  }

  private destination(raw: string): string {
    const url = new URL(raw, 'https://html.duckduckgo.com/')
    const duckHost = url.hostname === 'duckduckgo.com' || url.hostname === 'html.duckduckgo.com'
    if (duckHost && url.pathname === '/l/') {
      const target = url.searchParams.get('uddg')
      if (!target) throw new WebError('blocked_url')
      return this.policy.validateUrl(target).href
    }
    if (duckHost && (url.pathname === '/y.js' || url.searchParams.has('ad_provider'))) throw new WebError('blocked_url')
    return this.policy.validateUrl(url.href).href
  }

  private isAdvertisement(node: HtmlElement): boolean {
    let current: HtmlElement | null = node
    while (current) {
      if (current.attribs && (hasClass(current, 'result--ad') || hasClass(current, 'result--sponsored'))) return true
      const parent: HtmlElement['parent'] = current.parent
      current = parent && 'attribs' in parent ? parent as HtmlElement : null
    }
    return false
  }
}
