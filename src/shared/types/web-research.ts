/** Public web data contracts. No Main/Electron imports belong in shared. */
export type WebCode = 'blocked_url' | 'blocked_access' | 'rate_limited' | 'layout_changed' | 'network_unavailable'
  | 'timeout' | 'too_large' | 'unsupported_content' | 'render_unavailable' | 'cancelled'
  | 'history_unavailable' | 'history_changed' | 'invalid_receipt'

export interface SearchHit { title: string; url: string; snippet: string }
export interface SearchOutcome {
  state: 'ok' | 'empty' | 'blocked' | 'unavailable'
  query: string
  results: SearchHit[]
  queriedAt: string
  code?: WebCode
}

export interface WebPage {
  title: string
  url: string
  text: string
  fetchedAt: string
  publishedAt: string | null
  mode: 'http' | 'browser'
  truncated: boolean
}
export interface ReadOutcome {
  state: 'ok' | 'partial' | 'blocked' | 'unavailable'
  page: WebPage | null
  code?: WebCode
}
