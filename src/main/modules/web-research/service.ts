import { randomUUID } from 'node:crypto'
import type { CapabilityResult, ExecutionContext } from '../../../shared/types/modules'
import type { HistorySnapshot, ResearchHandle, WebCapabilityData, WebCode, WebModuleStatus, WebResearchNote, WebResearchRecord, WebSources } from '../../../shared/types/web-research'
import type { StateDatabase } from '../../storage/state-database'
import { ModuleRegistry } from '../registry'
import { checkWebScope, withinWebScope, type WebReader, type WebScope, type WebTransport } from './contracts'
import { HistoryCrypto, WebHistoryCodec, isResearchId } from './history-codec'
import { WebHistoryStore, fitWebHistoryRecord } from './history-store'
import { DefaultWebReader } from './reader'
import { DuckDuckGoSearch } from './search'
import { SummaryReceipts } from './summary-receipts'
import { WebProofs } from './proofs'

export interface WebApplicationDependencies {
  database: StateDatabase; crypto: HistoryCrypto; transport: WebTransport; reader?: WebReader; registry?: ModuleRegistry
  authorizeAgent(context: ExecutionContext, id: string): void
  authorizeManagement(): void
  moduleRevision(): number; sessionId(): number; changed(): void; sources(value: WebSources): void; now?(): number
}
interface Active { handle: ResearchHandle; session: number; revision: number; opened: number; query: string }
const fail = (code: string): never => { throw new Error(code) }
export class WebResearchService {
  readonly history: WebHistoryStore
  readonly notes: SummaryReceipts
  private readonly codec: WebHistoryCodec
  private readonly active = new Map<string, Active>()
  private readonly volatile = new Map<string, WebResearchRecord>()
  private readonly controllers = new Set<AbortController>()
  private readonly proofs: WebProofs
  private readonly search: DuckDuckGoSearch
  private readonly reader: WebReader
  private readonly now: () => number
  private persistenceCheck: () => void = () => {}
  private epoch = 0
  private stopped = false
  private sequence = 0
  private lastNetworkCode?: WebCode

  constructor(private readonly deps: WebApplicationDependencies) {
    this.now = deps.now ?? Date.now
    this.codec = new WebHistoryCodec({ available: () => deps.crypto.available(),
      encrypt: text => { const bytes = deps.crypto.encrypt(text); this.persistenceCheck(); return bytes }, decrypt: bytes => deps.crypto.decrypt(bytes) })
    this.history = new WebHistoryStore(deps.database, this.codec, { now: () => new Date(this.now()).toISOString(), id: randomUUID })
    this.search = new DuckDuckGoSearch({ transport: deps.transport, now: this.now })
    this.reader = deps.reader ?? new DefaultWebReader({ transport: deps.transport, now: this.now })
    this.proofs = new WebProofs((c, id) => this.authorize(c, id), () => new Date(this.now()).toISOString())
    this.notes = new SummaryReceipts({ now: this.now, currentSession: deps.sessionId,
      authorize: () => { deps.authorizeManagement(); if (this.stopped) fail('web_unavailable') },
      contains: handle => this.contains(handle),
      setSummary: (handle, text) => {
        const active = this.association(handle.id)
        const epoch = this.epoch
        // The store itself checks SQL generation inside its transaction. Crypto-time authority
        // checks must stay synchronous and must not open a nested SQLite transaction.
        const check = () => { deps.authorizeManagement(); if (this.stopped || epoch !== this.epoch
          || this.active.get(handle.id) !== active || active.session !== deps.sessionId()
          || active.revision !== deps.moduleRevision() || this.now() < active.opened || this.now() - active.opened >= 300000) fail('web_unavailable') }
        this.write(check, () => {
          if (handle.storage === 'saved') this.history.setSummary(handle, text)
          else { const record = structuredClone(this.volatile.get(handle.id)!); record.summary = text; record.summaryState = 'available'; fitWebHistoryRecord(record); this.volatile.set(handle.id, record) }
        })
        if (active) this.active.delete(handle.id)
        deps.changed()
      } })
  }
  private authorize(context: ExecutionContext, id: string): void {
    this.deps.authorizeAgent(context, id)
    if (this.stopped || context.sessionId !== this.deps.sessionId() || context.moduleRevision !== this.deps.moduleRevision()) fail('web_execution_invalidated')
  }
  private write<T>(check: () => void, action: () => T): T {
    const previous = this.persistenceCheck
    this.persistenceCheck = check
    try { check(); return action() } finally { this.persistenceCheck = previous }
  }
  private association(id: string): Active {
    const value = this.active.get(id), now = this.now()
    if (!value || now < value.opened || now - value.opened >= 300000 || value.session !== this.deps.sessionId()
      || value.revision !== this.deps.moduleRevision() || !this.contains(value.handle)) fail('history_changed')
    return value!
  }
  private contains(handle: ResearchHandle): boolean {
    const active = this.active.get(handle.id)
    if (!active || active.handle.generation !== handle.generation || active.handle.storage !== handle.storage
      || active.session !== this.deps.sessionId() || active.revision !== this.deps.moduleRevision()
      || this.now() < active.opened || this.now() - active.opened >= 300000) return false
    return handle.storage === 'saved' ? this.history.contains(handle) : this.volatile.has(handle.id)
  }
  private begin(query: string, check: () => void): ResearchHandle {
    let handle: ResearchHandle
    try { handle = this.write(check, () => this.history.begin(query)) }
    catch (error) {
      check()
      if (!(error instanceof Error) || error.message !== 'web_history_unavailable') throw error
      const id = randomUUID(), at = new Date(this.now()).toISOString()
      handle = { id, generation: this.history.list().generation, storage: 'volatile' }
      const record: WebResearchRecord = { id, sequence: ++this.sequence, createdAt: at, updatedAt: at, query,
        state: 'running', results: [], pages: [], summary: null, summaryState: 'pending' }
      fitWebHistoryRecord(record); this.volatile.set(id, record)
      while (this.volatile.size > 10) this.volatile.delete(this.volatile.keys().next().value!)
    }
    this.active.set(handle.id, { handle: { ...handle }, session: this.deps.sessionId(), revision: this.deps.moduleRevision(), opened: this.now(), query })
    for (const [id, value] of this.active) if (!this.contains(value.handle)) { this.active.delete(id); this.notes.invalidate(id) }
    while (this.active.size > 10) { const id = this.active.keys().next().value!; this.active.delete(id); this.notes.invalidate(id) }
    return handle
  }
  private update(handle: ResearchHandle, check: () => void, saved: () => void, memory: (record: WebResearchRecord) => void): void {
    check(); this.association(handle.id)
    if (handle.storage === 'saved') {
      try { this.write(check, saved); return }
      catch (error) {
        check()
        if (!(error instanceof Error) || error.message !== 'web_history_unavailable') throw error
        const active = this.association(handle.id), at = new Date(active.opened).toISOString()
        const record: WebResearchRecord = { id: handle.id, sequence: ++this.sequence, createdAt: at, updatedAt: at, query: active.query,
          state: 'running', results: [], pages: [], summary: null, summaryState: 'pending' }
        // Keep existing ciphertext untouched; this session's new observation lives only in memory.
        memory(record); fitWebHistoryRecord(record); check()
        this.volatile.set(handle.id, record); handle.storage = 'volatile'; active.handle = { ...handle }; this.notes.invalidate(handle.id)
        while (this.volatile.size > 10) this.volatile.delete(this.volatile.keys().next().value!)
        return
      }
    }
    const record = structuredClone(this.volatile.get(handle.id)!)
    memory(record); record.updatedAt = new Date(this.now()).toISOString(); fitWebHistoryRecord(record); check(); this.volatile.set(handle.id, record)
  }
  private validate(id: string, raw: unknown): Record<string, any> {
    if (this.deps.registry) this.deps.registry.validateInput(id, raw)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('invalid_web_input')
    const args = raw as Record<string, any>, keys = Object.keys(args)
    const expected: Record<string, string[]> = { web_search: ['query'], web_read: ['url', 'mode', 'researchId'], web_history_list: [], web_history_get: ['id'] }
    if (!expected[id] || keys.some(key => !expected[id].includes(key))) fail('invalid_web_input')
    if (id === 'web_search' && (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 500 || /[\x00-\x1f\x7f]/.test(args.query))) fail('invalid_web_input')
    if (id === 'web_read' && (typeof args.url !== 'string' || !args.url || args.url.length > 4096 || args.mode !== undefined && !['auto', 'http', 'browser'].includes(args.mode)
      || args.researchId !== undefined && !isResearchId(args.researchId))) fail('invalid_web_input')
    if (id === 'web_history_get' && !isResearchId(args.id)) fail('invalid_web_input')
    return args
  }
  async execute(id: string, raw: unknown, context: ExecutionContext, signal: AbortSignal): Promise<WebCapabilityData> {
    this.authorize(context, id)
    const args = this.validate(id, raw), epoch = this.epoch, controller = new AbortController()
    const abort = () => controller.abort()
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort()
    this.controllers.add(controller)
    const scope: WebScope = { signal: controller.signal, deadline: this.now() + (id === 'web_read' ? 30000 : id === 'web_search' ? 15000 : 5000), check: () => {
      this.authorize(context, id); if (epoch !== this.epoch) fail('web_execution_invalidated')
    } }
    const check = () => checkWebScope(scope, this.now)
    let handle: ResearchHandle | undefined
    try {
      check()
      let data: WebCapabilityData
      if (id === 'web_history_list') data = { kind: 'history_list', snapshot: this.history.list() }
      else if (id === 'web_history_get') data = { kind: 'history_get', record: this.volatile.get(args.id) ? structuredClone(this.volatile.get(args.id)!) : this.history.get(args.id) }
      else {
        if (args.researchId) handle = this.association(args.researchId).handle
        else handle = this.begin(id === 'web_search' ? args.query.trim().normalize('NFC') : args.url.slice(0, 500), check)
        const current = handle
        if (id === 'web_search') {
          const outcome = await withinWebScope(scope, () => this.search.search(args.query, scope), this.now)
          check(); this.association(current.id)
          try { this.update(current, check, () => this.history.addResults(current, outcome), r => { r.results = structuredClone(outcome.results); r.state = outcome.state === 'ok' || outcome.state === 'empty' ? 'complete' : outcome.state }) }
          catch (error) { check(); if (!(error instanceof Error) || error.message !== 'web_history_unavailable') throw error }
          this.lastNetworkCode = outcome.code
          data = { kind: 'search', researchId: current.id, historyStorage: current.storage, outcome }
        } else {
          const outcome = await withinWebScope(scope, () => this.reader.read(args.url, args.mode ?? 'auto', scope), this.now)
          check(); this.association(current.id)
          try { this.update(current, check, () => this.history.addPage(current, outcome), r => {
            if (outcome.page) r.pages = [...r.pages.filter(p => p.url !== outcome.page!.url), structuredClone(outcome.page)].slice(-3)
            r.state = outcome.state === 'ok' ? 'complete' : outcome.state
          }) } catch (error) { check(); if (!(error instanceof Error) || error.message !== 'web_history_unavailable') throw error }
          this.lastNetworkCode = outcome.code
          data = { kind: 'read', researchId: current.id, historyStorage: current.storage, outcome }
        }
        check()
        try { data._historyReceipt = this.notes.issue(current, context) } catch { /* Content can still be delivered without a summary receipt. */ }
        const sourceList = data.kind === 'search' ? data.outcome.results : data.outcome.page ? [{ title: data.outcome.page.title, url: data.outcome.page.url }] : []
        this.deps.sources({ researchId: current.id, query: id === 'web_search' ? args.query.trim() : args.url.slice(0, 500), consultedAt: new Date(this.now()).toISOString(), sources: sourceList.map(({ title, url }) => ({ title, url })).slice(0, 5) })
        this.deps.changed()
      }
      check()
      this.proofs.observe(context, id, data, () => { scope.check(); if (epoch !== this.epoch) fail('web_execution_invalidated') })
      return data
    } catch (error) {
      if (handle && controller.signal.aborted) {
        try {
          // Closing a cancelled operation is permitted only while its original authority
          // and epoch still hold. Revocation/clear/stop must never cause a late write.
          scope.check()
          this.write(scope.check, () => {
            if (handle!.storage === 'saved') this.history.cancel(handle!)
            else {
              const record = this.volatile.get(handle!.id)
              if (record) { record.state = 'cancelled'; record.summaryState = 'unavailable' }
            }
          })
          this.deps.changed()
        } catch { /* Preserve existing ciphertext when authority or protection is unavailable. */ }
      }
      if (handle) { this.notes.invalidate(handle.id); this.active.delete(handle.id) }
      throw error
    } finally { signal.removeEventListener('abort', abort); this.controllers.delete(controller) }
  }
  verify(context: ExecutionContext, id: string, result: CapabilityResult): CapabilityResult { return this.proofs.verify(context, id, result) }
  releaseObservation(id: string): void { this.proofs.release(id) }
  clearObservations(): void { this.proofs.clear() }
  acceptNote(note: WebResearchNote, session: number): boolean { return this.notes.accept(note, session) }
  status(): WebModuleStatus {
    let storage: 'saved' | 'unavailable' = 'unavailable'
    try { storage = this.history.list().storage === 'saved' ? 'saved' : 'unavailable' } catch { /* Preserve storage error. */ }
    return { health: this.stopped ? 'unavailable' : 'healthy', lifecycle: this.stopped ? 'stopped' : 'running', storage,
      ...(this.lastNetworkCode ? { lastNetworkCode: this.lastNetworkCode } : {}) }
  }
  listHistory(): HistorySnapshot { this.deps.authorizeManagement(); return this.history.list() }
  getHistory(id: string): WebResearchRecord | null { this.deps.authorizeManagement(); return this.volatile.has(id) ? structuredClone(this.volatile.get(id)!) : this.history.get(id) }
  clear(expectedGeneration: number): HistorySnapshot {
    this.deps.authorizeManagement()
    const result = this.history.clear(expectedGeneration)
    this.epoch++; for (const c of this.controllers) c.abort()
    this.active.clear(); this.volatile.clear(); this.notes.invalidate(); this.proofs.clear(); this.deps.changed()
    return result
  }
  async testConnection() {
    this.deps.authorizeManagement()
    const context: ExecutionContext = { taskId: 'web-test', stepId: 'manual', invocationId: randomUUID(), sessionId: this.deps.sessionId(), moduleRevision: this.deps.moduleRevision() }
    this.authorize(context, 'web_search')
    const epoch = this.epoch, controller = new AbortController(); this.controllers.add(controller)
    try {
      const scope: WebScope = { signal: controller.signal, deadline: this.now() + 15000, check: () => { this.authorize(context, 'web_search'); if (epoch !== this.epoch) fail('web_execution_invalidated') } }
      return await withinWebScope(scope, () => this.search.search('Electron documentation', scope), this.now)
    } finally { this.controllers.delete(controller) }
  }
  async stop(): Promise<void> {
    this.stopped = true; this.epoch++; for (const controller of this.controllers) controller.abort()
    this.active.clear(); this.volatile.clear(); this.notes.invalidate(); this.proofs.clear()
  }
  async restore(): Promise<void> { this.deps.authorizeManagement(); this.stopped = false }
}
