import type { WebResearchRecord } from '../../../shared/types/web-research'

export interface HistoryCrypto {
  available(): boolean
  encrypt(text: string): Uint8Array
  decrypt(bytes: Uint8Array): string
}
export const HISTORY_BYTES = 262144
export const historyUnavailable = (): Error => new Error('web_history_unavailable')
export const isResearchId = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const exact = (value: unknown, keys: string[]): value is Record<string, unknown> => object(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max
const date = (value: unknown): boolean => typeof value === 'string' && value.length <= 80
  && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value.slice(0, 10))).toISOString().slice(0, 10) === value.slice(0, 10)
const url = (value: unknown): boolean => {
  if (!text(value, 4096)) return false
  try { const parsed = new URL(value); return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password } catch { return false }
}

/** Strict structure and byte validation is applied to both sides of the crypto boundary. */
export function validateHistoryRecord(value: unknown): asserts value is WebResearchRecord {
  if (!exact(value, ['id', 'sequence', 'createdAt', 'updatedAt', 'state', 'query', 'results', 'pages', 'summary', 'summaryState'])
    || !isResearchId(value.id) || !Number.isSafeInteger(value.sequence) || Number(value.sequence) < 1
    || !date(value.createdAt) || !date(value.updatedAt) || !text(value.query, 500) || !value.query.trim()
    || !['running', 'complete', 'partial', 'blocked', 'unavailable', 'cancelled'].includes(String(value.state))
    || !['pending', 'available', 'unavailable'].includes(String(value.summaryState))
    || !(value.summary === null || text(value.summary, 4000))
    || !Array.isArray(value.results) || value.results.length > 5 || !Array.isArray(value.pages) || value.pages.length > 3) throw historyUnavailable()
  for (const hit of value.results) if (!exact(hit, ['title', 'url', 'snippet']) || !text(hit.title, 512) || !url(hit.url) || !text(hit.snippet, 2000)) throw historyUnavailable()
  const urls = new Set<string>()
  for (const page of value.pages) {
    if (!exact(page, ['title', 'url', 'text', 'fetchedAt', 'publishedAt', 'mode', 'truncated']) || !text(page.title, 512)
      || !url(page.url) || !text(page.text, 49152) || Buffer.byteLength(page.text) > 49152 || !date(page.fetchedAt)
      || !(page.publishedAt === null || date(page.publishedAt)) || !['http', 'browser'].includes(String(page.mode))
      || typeof page.truncated !== 'boolean' || urls.has(String(page.url))) throw historyUnavailable()
    urls.add(String(page.url))
  }
}

export class WebHistoryCodec {
  constructor(private readonly crypto: HistoryCrypto) {}
  available(): boolean {
    try { return this.crypto.available() } catch { return false }
  }
  encode(record: WebResearchRecord): Uint8Array {
    try {
      if (!this.crypto.available()) throw historyUnavailable()
      validateHistoryRecord(record)
      const text = JSON.stringify({ schemaVersion: 1, record })
      if (Buffer.byteLength(text) > HISTORY_BYTES) throw historyUnavailable()
      const bytes = this.crypto.encrypt(text)
      if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 524288) throw historyUnavailable()
      return bytes
    } catch { throw historyUnavailable() }
  }
  decode(bytes: Uint8Array): WebResearchRecord {
    try {
      if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 524288 || !this.crypto.available()) throw historyUnavailable()
      const text = this.crypto.decrypt(bytes)
      if (Buffer.byteLength(text) > HISTORY_BYTES) throw historyUnavailable()
      const envelope: unknown = JSON.parse(text)
      if (!exact(envelope, ['schemaVersion', 'record']) || envelope.schemaVersion !== 1) throw historyUnavailable()
      validateHistoryRecord(envelope.record)
      return envelope.record
    } catch { throw historyUnavailable() }
  }
}
