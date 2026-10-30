import type { HistorySnapshot, ResearchHandle, SearchOutcome, ReadOutcome, WebResearchRecord } from '../../../shared/types/web-research'
import type { StateDatabase, StateTransaction } from '../../storage/state-database'
import { WebHistoryCodec, HISTORY_BYTES, historyUnavailable, isResearchId, validateHistoryRecord } from './history-codec'

const changed = (): Error => new Error('history_changed')
// Reserve the worst escaped summary up front, so accepting a note never changes source text.
const payloadSize = (record: WebResearchRecord): number => Buffer.byteLength(JSON.stringify({ schemaVersion: 1,
  record: { ...record, summary: '\u0000'.repeat(4000), summaryState: 'unavailable' } }))
export function fitWebHistoryRecord(record: WebResearchRecord): void {
  validateHistoryRecord(record)
  for (const page of record.pages) {
    if (payloadSize(record) <= HISTORY_BYTES) return
    const original = Array.from(page.text)
    page.text = ''; page.truncated = true
    if (payloadSize(record) > HISTORY_BYTES) continue
    let low = 0, high = original.length
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      page.text = original.slice(0, mid).join('')
      if (payloadSize(record) <= HISTORY_BYTES) low = mid
      else high = mid - 1
    }
    page.text = original.slice(0, low).join('')
  }
  if (payloadSize(record) > HISTORY_BYTES) throw historyUnavailable()
}

export class WebHistoryStore {
  constructor(private readonly database: StateDatabase, private readonly codec: WebHistoryCodec,
    private readonly deps: { now(): string; id(): string }) {}

  private transact<T>(action: (tx: StateTransaction) => T): T {
    try { return this.database.transaction(action) }
    catch (error) {
      if (error instanceof Error && error.message === 'history_changed') throw changed()
      throw historyUnavailable()
    }
  }
  private generation(tx: StateTransaction): number {
    const value = tx.prepare('SELECT generation FROM web_research_meta WHERE singleton=1').get()?.generation
    if (!Number.isSafeInteger(value) || Number(value) < 0) throw historyUnavailable()
    return Number(value)
  }
  private row(tx: StateTransaction, id: string): Record<string, unknown> | undefined {
    if (!isResearchId(id)) throw historyUnavailable()
    return tx.prepare('SELECT * FROM web_research_history WHERE id=?').get(id)
  }
  private decode(row: Record<string, unknown>): WebResearchRecord {
    const record = this.codec.decode(row.sealed_payload as Uint8Array)
    if (record.id !== row.id || record.sequence !== row.sequence || record.createdAt !== row.created_at
      || record.updatedAt !== row.updated_at || record.state !== row.state) throw historyUnavailable()
    return record
  }
  private current(tx: StateTransaction, handle: ResearchHandle): Record<string, unknown> {
    if (!handle || handle.storage !== 'saved' || this.generation(tx) !== handle.generation) throw changed()
    const row = this.row(tx, handle.id)
    if (!row) throw changed()
    return row
  }
  begin(query: string): ResearchHandle {
    return this.transact(tx => {
      const generation = this.generation(tx), id = this.deps.id(), now = this.deps.now()
      const max = tx.prepare("SELECT seq FROM sqlite_sequence WHERE name='web_research_history'").get()
      const record: WebResearchRecord = { id, sequence: Number(max?.seq ?? 0) + 1, createdAt: now, updatedAt: now,
        state: 'running', query, results: [], pages: [], summary: null, summaryState: 'pending' }
      const sealed = this.codec.encode(record)
      tx.prepare('INSERT INTO web_research_history(sequence,id,created_at,updated_at,state,sealed_payload) VALUES(?,?,?,?,?,?)')
        .run(record.sequence, id, now, now, record.state, sealed)
      tx.exec('DELETE FROM web_research_history WHERE sequence NOT IN (SELECT sequence FROM web_research_history ORDER BY sequence DESC LIMIT 10)')
      return { id, generation, storage: 'saved' }
    })
  }
  get(id: string): WebResearchRecord | null {
    return this.transact(tx => { const row = this.row(tx, id); return row ? this.decode(row) : null })
  }
  list(): HistorySnapshot {
    return this.transact(tx => {
      const generation = this.generation(tx)
      try {
        if (!this.codec.available()) throw historyUnavailable()
        const items = tx.prepare('SELECT * FROM web_research_history ORDER BY sequence DESC LIMIT 10').all().map(row => {
          const { pages, ...rest } = this.decode(row)
          return { ...rest, pageCount: pages.length }
        })
        return { generation, storage: 'saved', items }
      } catch { return { generation, storage: 'unavailable', items: [] } }
    })
  }
  handle(id: string): ResearchHandle | null {
    return this.transact(tx => this.row(tx, id) ? { id, generation: this.generation(tx), storage: 'saved' } : null)
  }
  contains(handle: ResearchHandle): boolean {
    return this.transact(tx => {
      if (!handle || handle.storage !== 'saved' || this.generation(tx) !== handle.generation) return false
      return !!this.row(tx, handle.id)
    })
  }
  private update(handle: ResearchHandle, action: (record: WebResearchRecord) => void): void {
    this.transact(tx => {
      const record = this.decode(this.current(tx, handle))
      action(record); record.updatedAt = this.deps.now(); fitWebHistoryRecord(record)
      const sealed = this.codec.encode(record)
      tx.prepare('UPDATE web_research_history SET updated_at=?,state=?,sealed_payload=? WHERE id=?')
        .run(record.updatedAt, record.state, sealed, record.id)
    })
  }
  addResults(handle: ResearchHandle, outcome: SearchOutcome): void {
    this.update(handle, record => {
      if (record.query !== outcome.query || !['ok', 'empty', 'blocked', 'unavailable'].includes(outcome.state)) throw historyUnavailable()
      record.results = structuredClone(outcome.results)
      record.state = outcome.state === 'ok' || outcome.state === 'empty' ? 'complete' : outcome.state
    })
  }
  addPage(handle: ResearchHandle, outcome: ReadOutcome): void {
    this.update(handle, record => {
      if (!['ok', 'partial', 'blocked', 'unavailable'].includes(outcome.state)) throw historyUnavailable()
      if (outcome.page) {
        record.pages = record.pages.filter(page => page.url !== outcome.page!.url)
        record.pages.push(structuredClone(outcome.page))
        record.pages = record.pages.slice(-3)
      }
      record.state = outcome.state === 'ok' ? 'complete' : outcome.state
    })
  }
  setSummary(handle: ResearchHandle, summary: string): void {
    this.update(handle, record => { record.summary = summary; record.summaryState = 'available' })
  }
  cancel(handle: ResearchHandle): void {
    this.update(handle, record => { record.state = 'cancelled'; record.summaryState = 'unavailable' })
  }
  clear(expectedGeneration: number): HistorySnapshot {
    return this.transact(tx => {
      const generation = this.generation(tx)
      if (!Number.isSafeInteger(expectedGeneration) || expectedGeneration !== generation) throw changed()
      tx.exec('DELETE FROM web_research_history')
      tx.prepare('UPDATE web_research_meta SET generation=? WHERE singleton=1').run(generation + 1)
      return { generation: generation + 1, storage: 'saved', items: [] }
    })
  }
}
