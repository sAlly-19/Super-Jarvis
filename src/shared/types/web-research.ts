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

export type ResearchState = 'running' | 'complete' | 'partial' | 'blocked' | 'unavailable' | 'cancelled'
export interface WebResearchRecord {
  id: string
  sequence: number
  createdAt: string
  updatedAt: string
  state: ResearchState
  query: string
  results: SearchHit[]
  pages: WebPage[]
  summary: string | null
  summaryState: 'pending' | 'available' | 'unavailable'
}
export interface ResearchHandle { id: string; generation: number; storage: 'saved' | 'volatile' }
export type WebHistoryItem = Omit<WebResearchRecord, 'pages'> & { pageCount: number }
export interface HistorySnapshot { generation: number; storage: 'saved' | 'volatile' | 'unavailable'; items: WebHistoryItem[] }
export interface SummaryReceipt { researchId: string; ticket: string; sessionId: number; expiresAt: number }
export interface WebResearchNote { researchId: string; ticket: string; sessionId: number; summary: string }
export type WebCapabilityData =
  | { kind: 'search'; researchId: string; historyStorage: 'saved' | 'volatile'; outcome: SearchOutcome; _historyReceipt?: SummaryReceipt }
  | { kind: 'read'; researchId: string; historyStorage: 'saved' | 'volatile'; outcome: ReadOutcome; _historyReceipt?: SummaryReceipt }
  | { kind: 'history_list'; snapshot: HistorySnapshot }
  | { kind: 'history_get'; record: WebResearchRecord | null }
export interface WebSources { researchId: string; query: string; consultedAt: string; sources: Array<{ title: string; url: string }> }
export interface WebModuleStatus {
  health: 'healthy' | 'unavailable' | 'error'
  lifecycle: 'running' | 'stopped'
  storage: 'saved' | 'volatile' | 'unavailable'
  errorCode?: string
  lastNetworkCode?: WebCode
}
