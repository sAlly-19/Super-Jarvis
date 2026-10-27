import { randomUUID } from 'node:crypto'
import type { ExecutionContext } from '../../../shared/types/modules'
import type { ImportCandidate, ImportReport, MutationRequest, ReminderExportRequest, ReminderImportAction, ReminderImportResult, ReminderListQuery, ReminderPreferencesRequest } from '../../../shared/types/reminders'
import { exactFields } from './calendar'
import { emptyImportReport } from './ical-codec'
import type { RemindersStore } from './store'
import type { RemindersService } from './service'
import type { RemindersImportService } from './import-service'
import type { ICalendarCodec } from './ical-client'

interface DashboardDependencies {
  authorize(): void
  sessionId(): string | null
  context(): ExecutionContext
  chooseImport(signal: AbortSignal): Promise<Uint8Array | null>
  exportFile(bytes: Uint8Array, signal: AbortSignal, check: () => void): Promise<boolean>
  changed(): void
}
export class RemindersDashboard {
  private readonly jobs = new Map<AbortController, Promise<unknown>>()
  private readonly previews = new Map<string, { session: string; candidates: ImportCandidate[]; report: ImportReport }>()
  private closed = false
  constructor(private readonly store: RemindersStore, private readonly service: RemindersService,
    private readonly importer: RemindersImportService, private readonly codec: ICalendarCodec, private readonly deps: DashboardDependencies) {}
  private access(): void { if (this.closed) throw new Error('reminders_closed'); this.deps.authorize() }
  public list(query: ReminderListQuery) { this.access(); const page = this.store.list(query); return { ...page, items: page.items.map(item => ({ ...item, occurrenceKey: this.store.nextOccurrence(item.id)?.key ?? null })) } }
  public get(id: string) { this.access(); const item = this.store.get(id); return item ? { ...item, occurrenceKey: this.store.nextOccurrence(item.id)?.key ?? null } : null }
  public preferences(request: ReminderPreferencesRequest) {
    this.access()
    if (request?.type === 'get') { exactFields(request, ['type']); return this.store.getPreferences() }
    exactFields(request, ['type', 'patch', 'expectedRevision'])
    if (request.type !== 'update') throw new Error('invalid_preferences_request')
    const value = this.store.updatePreferences(request.patch, request.expectedRevision); this.deps.changed(); return value
  }
  public async mutate(request: MutationRequest): Promise<void> {
    this.access()
    if (!request || !['create', 'update', 'delete', 'complete', 'snooze'].includes(request.type)) throw new Error('invalid_reminder_mutation')
    const { type, ...args } = request, context = this.deps.context()
    return this.job(async (signal, check) => {
      try {
        for (;;) {
          check()
          try { await this.service.execute(`reminder_${type}`, args, context, signal); this.deps.changed(); return }
          catch (error) {
            if (!(error instanceof Error) || error.message !== 'recurrence_checkpoint_pending') throw error
            await new Promise<void>(resolve => setImmediate(resolve))
          }
        }
      } finally { this.service.releaseObservation(context.invocationId) }
    })
  }
  private job<T>(run: (signal: AbortSignal, check: () => void) => Promise<T>): Promise<T> {
    this.access()
    if (this.jobs.size) return Promise.reject(new Error('reminder_job_in_progress'))
    const session = this.deps.sessionId()
    if (!session) return Promise.reject(new Error('reminder_window_unavailable'))
    const controller = new AbortController()
    const check = () => { controller.signal.throwIfAborted(); this.access(); if (this.deps.sessionId() !== session) throw new Error('stale_reminder_window') }
    const promise = Promise.resolve().then(() => { check(); return run(controller.signal, check) }).finally(() => this.jobs.delete(controller))
    this.jobs.set(controller, promise)
    return promise
  }
  public async import(request: ReminderImportAction): Promise<ReminderImportResult> {
    this.access()
    if (request?.type === 'cancel') { exactFields(request, ['type']); await this.abortAll(); return { status: 'cancelled', report: emptyImportReport() } }
    if (request?.type === 'preview') {
      exactFields(request, ['type'])
      return this.job(async (signal, check) => {
        const bytes = await this.deps.chooseImport(signal); check()
        if (!bytes) return { status: 'cancelled', report: emptyImportReport() }
        const parsed = await this.codec.parse(bytes, this.store.getPreferences(), signal); check()
        if (!Array.isArray(parsed.candidates) || parsed.candidates.length > 1000 || !parsed.report) throw new Error('invalid_worker_response')
        const token = randomUUID()
        this.previews.clear(); this.previews.set(token, { session: this.deps.sessionId()!, ...parsed })
        return { status: 'preview', token, count: parsed.candidates.length, report: parsed.report }
      })
    }
    exactFields(request, ['type', 'token'])
    if (request.type !== 'apply' || typeof request.token !== 'string') throw new Error('invalid_import_request')
    const preview = this.previews.get(request.token)
    if (!preview || preview.session !== this.deps.sessionId()) throw new Error('invalid_import_preview')
    return this.job(async (signal, check) => {
      const report = await this.importer.apply(preview.candidates, { invocationId: `import:${request.token}`, nowUtc: new Date().toISOString() }, signal)
      if (!report.interrupted) check()
      this.previews.delete(request.token)
      report.rejected.unshift(...preview.report.rejected); report.warnings.unshift(...preview.report.warnings)
      this.deps.changed()
      return { status: 'applied', report }
    })
  }
  public export(request: ReminderExportRequest): Promise<boolean> {
    this.access(); exactFields(request, ['items'])
    if (!Array.isArray(request.items) || !request.items.length || request.items.length > 100 || new Set(request.items.map(item => item.id)).size !== request.items.length) throw new Error('reminder_batch_limit')
    const items = request.items.map(reference => {
      exactFields(reference, ['id', 'expectedRevision'])
      const item = this.store.get(reference.id)
      if (!item || item.revision !== reference.expectedRevision) throw new Error('stale_reminder')
      if (this.store.hasExportExceptions(item.id)) throw new Error('unsupported_export_occurrence_state')
      return item
    })
    return this.job(async (signal, check) => {
      const bytes = await this.codec.serialize(items, signal); check()
      const current = () => {
        check()
        for (const item of items) if (this.store.get(item.id)?.revision !== item.revision || this.store.hasExportExceptions(item.id)) throw new Error('stale_reminder_export')
      }
      return this.deps.exportFile(bytes, signal, current)
    })
  }
  public async abortAll(): Promise<void> {
    this.previews.clear()
    for (const controller of this.jobs.keys()) controller.abort()
    await Promise.allSettled([...this.jobs.values()])
  }
  public async close(): Promise<void> { this.closed = true; await this.abortAll() }
}
