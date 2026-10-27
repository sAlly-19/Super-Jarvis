import { createHash, randomUUID } from 'node:crypto'
import type { StateDatabase, StateTransaction } from '../../storage/state-database'
import type { ImportCandidate, ImportReport, MutationContext, MutationRequest, NativeSchedule, Occurrence, Reminder, ReminderListQuery, ReminderPreferences, ReminderReceipt } from '../../../shared/types/reminders'
import { exactFields, parseUtc, ReminderCalendar } from './calendar'

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value)
const revision = (value: unknown): boolean => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
const record = (row: Record<string, unknown>): Reminder => ({
  id: String(row.id), revision: Number(row.revision), scheduleRevision: Number(row.schedule_revision), title: String(row.title), description: String(row.description),
  schedule: JSON.parse(String(row.schedule)), nextDueUtc: row.next_due_utc === null ? null : String(row.next_due_utc), state: row.state as Reminder['state'],
  source: row.source as Reminder['source'], uid: String(row.uid), sourceHash: row.source_hash === null ? null : String(row.source_hash), localEdited: row.local_edited === 1,
  icalSource: row.ical_source === null ? null : JSON.parse(String(row.ical_source)), createdAt: String(row.created_at), updatedAt: String(row.updated_at)
})
const occurrence = (row: Record<string, unknown>): Occurrence => ({ key: String(row.key), reminderId: String(row.reminder_id), scheduleRevision: Number(row.schedule_revision),
  nominalLocalTime: String(row.nominal_local_time), dueUtc: String(row.due_utc), state: row.state as Occurrence['state'], snoozedUntilUtc: row.snoozed_until_utc === null ? null : String(row.snoozed_until_utc) })
const receipt = (row: Record<string, unknown>): ReminderReceipt => ({ invocationId: String(row.invocation_id), capabilityId: String(row.capability_id), argsHash: String(row.args_hash), affected: JSON.parse(String(row.affected)), committedAt: String(row.committed_at) })

/** Domain data only. Callers own operational authorization; no Python connection exists. */
export class RemindersStore {
  constructor(private readonly database: StateDatabase, private readonly calendar: ReminderCalendar, defaultTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
    this.calendar.validateTimeZone(defaultTimeZone)
    this.database.transaction(tx => tx.prepare("INSERT OR IGNORE INTO reminder_preferences(singleton,time_zone,all_day_time,notifications_enabled,revision) VALUES(1,?,'09:00',1,0)").run(defaultTimeZone))
  }
  private getIn(tx: StateTransaction, id: string): Reminder | null {
    const value = tx.prepare('SELECT * FROM reminders WHERE id=?').get(id)
    return value ? record(value) : null
  }
  public get(id: string): Reminder | null {
    if (!uuid(id)) throw new Error('invalid_reminder_id')
    return this.database.transaction(tx => this.getIn(tx, id))
  }
  public hasExportExceptions(id: string): boolean {
    if (!uuid(id)) throw new Error('invalid_reminder_id')
    return this.database.transaction(tx => Boolean(tx.prepare(`SELECT 1 FROM reminder_occurrences o JOIN reminders r ON r.id=o.reminder_id
      WHERE r.id=? AND r.schedule_revision=o.schedule_revision AND (o.state IN ('completed','cancelled') OR o.snoozed_until_utc IS NOT NULL) LIMIT 1`).get(id)))
  }
  public getReceipt(invocationId: string): ReminderReceipt | null {
    return this.database.transaction(tx => { const value = tx.prepare('SELECT * FROM reminder_receipts WHERE invocation_id=?').get(invocationId); return value ? receipt(value) : null })
  }
  public occurrences(id: string): Occurrence[] {
    if (!uuid(id)) throw new Error('invalid_reminder_id')
    return this.database.transaction(tx => tx.prepare('SELECT * FROM reminder_occurrences WHERE reminder_id=? ORDER BY due_utc,key').all(id).map(occurrence))
  }
  public nextOccurrence(id: string): Occurrence | null {
    if (!uuid(id)) throw new Error('invalid_reminder_id')
    return this.database.transaction(tx => {
      const row = tx.prepare(`SELECT o.* FROM reminder_occurrences o JOIN reminders r ON r.id=o.reminder_id
        WHERE r.id=? AND o.schedule_revision=r.schedule_revision AND o.state='pending'
        AND COALESCE(o.snoozed_until_utc,o.due_utc)=r.next_due_utc ORDER BY o.key LIMIT 1`).get(id)
      return row ? occurrence(row) : null
    })
  }
  public getOccurrence(key: string, reminderId: string): Occurrence | null {
    if (!uuid(reminderId) || typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) throw new Error('invalid_occurrence')
    return this.database.transaction(tx => {
      const row = tx.prepare('SELECT * FROM reminder_occurrences WHERE key=? AND reminder_id=?').get(key, reminderId)
      return row ? occurrence(row) : null
    })
  }
  public list(query: ReminderListQuery): { items: Reminder[]; nextCursor: string | null } {
    exactFields(query, ['limit'], ['state', 'fromUtc', 'toUtc', 'cursor'])
    if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 100 || (query.state !== undefined && !['active', 'completed'].includes(query.state))) throw new Error('invalid_reminder_query')
    const from = query.fromUtc === undefined ? null : new Date(parseUtc(query.fromUtc)).toISOString()
    const to = query.toUtc === undefined ? null : new Date(parseUtc(query.toUtc)).toISOString()
    if (from !== null && to !== null && from > to) throw new Error('invalid_reminder_range')
    let cursor: { due: string; id: string } | null = null
    if (query.cursor !== undefined) {
      if (typeof query.cursor !== 'string' || query.cursor.length > 512) throw new Error('invalid_reminder_cursor')
      try {
        cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'))
        exactFields(cursor, ['due', 'id'])
        if (typeof cursor!.due !== 'string' || !uuid(cursor!.id)) throw new Error()
        if (cursor!.due !== '~') parseUtc(cursor!.due)
      } catch { throw new Error('invalid_reminder_cursor') }
    }
    return this.database.transaction(tx => {
      const rows = tx.prepare(`SELECT * FROM reminders WHERE state=? AND (? IS NULL OR next_due_utc>=?) AND (? IS NULL OR next_due_utc<=?)
        AND (? IS NULL OR COALESCE(next_due_utc,'~')>? OR (COALESCE(next_due_utc,'~')=? AND id>?)) ORDER BY COALESCE(next_due_utc,'~'),id LIMIT ?`)
        .all(query.state ?? 'active', from, from, to, to, cursor?.due ?? null, cursor?.due ?? null, cursor?.due ?? null, cursor?.id ?? null, query.limit + 1)
      const items = rows.slice(0, query.limit).map(record), last = items.at(-1)
      return { items, nextCursor: rows.length > query.limit && last ? Buffer.from(JSON.stringify({ due: last.nextDueUtc ?? '~', id: last.id })).toString('base64url') : null }
    })
  }
  public getPreferences(): ReminderPreferences {
    return this.database.transaction(tx => {
      const row = tx.prepare('SELECT * FROM reminder_preferences WHERE singleton=1').get()!
      return { timeZone: String(row.time_zone), allDayTime: String(row.all_day_time), notificationsEnabled: row.notifications_enabled === 1, revision: Number(row.revision) }
    })
  }
  public claimDue(nowUtc: string, epoch: string): Occurrence[] {
    nowUtc = new Date(parseUtc(nowUtc)).toISOString()
    if (!epoch || epoch.length > 160) throw new Error('invalid_delivery_epoch')
    return this.database.transaction(tx => {
      const rows = tx.prepare(`SELECT o.* FROM reminder_occurrences o JOIN reminders r ON r.id=o.reminder_id
        WHERE r.state='active' AND o.schedule_revision=r.schedule_revision AND o.state='pending'
        AND COALESCE(o.snoozed_until_utc,o.due_utc)<=? AND NOT EXISTS
        (SELECT 1 FROM reminder_deliveries d WHERE d.occurrence_key=o.key AND d.state='claimed')
        ORDER BY COALESCE(o.snoozed_until_utc,o.due_utc),o.key LIMIT 100`).all(nowUtc)
      for (const row of rows) {
        this.calendar.nextAfter(this.getIn(tx, String(row.reminder_id))!.schedule, String(row.due_utc))
        tx.prepare(`INSERT INTO reminder_deliveries(occurrence_key,epoch,state,claimed_at) VALUES(?,?,'claimed',?)
          ON CONFLICT(occurrence_key) DO UPDATE SET epoch=excluded.epoch,state='claimed',claimed_at=excluded.claimed_at,shown_at=NULL`).run(String(row.key), epoch, nowUtc)
      }
      return rows.map(occurrence)
    })
  }
  public canDeliver(key: string, epoch: string, nowUtc?: string): boolean {
    const cutoff = nowUtc ? new Date(parseUtc(nowUtc) - 60_000).toISOString() : ''
    return this.database.transaction(tx => Boolean(tx.prepare(`SELECT 1 FROM reminder_deliveries d
      JOIN reminder_occurrences o ON o.key=d.occurrence_key JOIN reminders r ON r.id=o.reminder_id
      WHERE d.occurrence_key=? AND d.epoch=? AND d.state='claimed' AND r.state='active'
      AND o.state='pending' AND o.schedule_revision=r.schedule_revision
      AND COALESCE(o.snoozed_until_utc,o.due_utc)<=d.claimed_at AND d.claimed_at>?`).get(key, epoch, cutoff)))
  }
  public markDelivery(key: string, epoch: string, state: 'shown' | 'missed' | 'uncertain' | 'blocked'): boolean {
    return this.database.transaction(tx => {
      const row = tx.prepare(`SELECT o.*,d.claimed_at FROM reminder_deliveries d JOIN reminder_occurrences o ON o.key=d.occurrence_key
        WHERE d.occurrence_key=? AND d.epoch=? AND d.state='claimed'`).get(key, epoch)
      if (!row) return false
      const item = this.getIn(tx, String(row.reminder_id))!
      const valid = item.state === 'active' && item.scheduleRevision === row.schedule_revision && row.state === 'pending'
        && String(row.snoozed_until_utc ?? row.due_utc) <= String(row.claimed_at)
      if (!valid) {
        // A changed/snoozed instance may be claimed again at its new time.
        tx.prepare("DELETE FROM reminder_deliveries WHERE occurrence_key=? AND epoch=? AND state='claimed'").run(key, epoch)
        return false
      }
      tx.prepare('UPDATE reminder_deliveries SET state=?,shown_at=? WHERE occurrence_key=? AND epoch=?')
        .run(state, state === 'shown' ? String(row.claimed_at) : null, key, epoch)
      tx.prepare('UPDATE reminder_occurrences SET state=? WHERE key=?').run(state === 'shown' ? 'notified' : 'missed', key)
      try { this.ensureNext(tx, item, String(row.due_utc)); this.refreshNext(tx, item) }
      catch (error) {
        if (!(error instanceof Error) || error.message !== 'recurrence_checkpoint_pending') throw error
        // Commit the observed delivery now; next_due_utc retains the durable advancement checkpoint.
        item.nextDueUtc = String(row.snoozed_until_utc ?? row.due_utc)
      }
      this.write(tx, item)
      return true
    })
  }
  public releaseClaims(epoch: string, generation = false): void {
    const keys = this.database.transaction(tx => tx.prepare("SELECT occurrence_key,epoch FROM reminder_deliveries WHERE state='claimed' AND (epoch=? OR (?=1 AND substr(epoch,1,?)=?))").all(epoch, Number(generation), epoch.length + 1, `${epoch}:`))
    for (const row of keys) this.markDelivery(String(row.occurrence_key), String(row.epoch), 'uncertain')
  }
  public expireClaims(nowUtc: string): number {
    const cutoff = new Date(parseUtc(nowUtc) - 60_000).toISOString()
    const rows = this.database.transaction(tx => tx.prepare("SELECT occurrence_key,epoch FROM reminder_deliveries WHERE state='claimed' AND claimed_at<=? LIMIT 100").all(cutoff))
    for (const row of rows) this.markDelivery(String(row.occurrence_key), String(row.epoch), 'uncertain')
    return rows.length
  }
  public resumeAdvancements(nowUtc: string): number {
    nowUtc = new Date(parseUtc(nowUtc)).toISOString()
    return this.database.transaction(tx => {
      const rows = tx.prepare(`SELECT o.* FROM reminder_occurrences o JOIN reminders r ON r.id=o.reminder_id
        WHERE r.state='active' AND r.schedule_revision=o.schedule_revision AND o.state IN ('notified','missed')
        AND COALESCE(o.snoozed_until_utc,o.due_utc)=r.next_due_utc AND r.next_due_utc<=? LIMIT 100`).all(nowUtc)
      for (const row of rows) {
        const item = this.getIn(tx, String(row.reminder_id))!
        this.ensureNext(tx, item, String(row.due_utc)); this.refreshNext(tx, item); this.write(tx, item)
      }
      return rows.length
    })
  }
  /** One bounded recovery checkpoint; the next instance and missed row commit together. */
  public recoverDue(nowUtc: string): number {
    nowUtc = new Date(parseUtc(nowUtc)).toISOString()
    return this.database.transaction(tx => {
      const rows = tx.prepare(`SELECT o.* FROM reminder_occurrences o JOIN reminders r ON r.id=o.reminder_id
        WHERE r.state='active' AND r.schedule_revision=o.schedule_revision
        AND (o.state='pending' OR (o.state IN ('notified','missed') AND COALESCE(o.snoozed_until_utc,o.due_utc)=r.next_due_utc))
        AND COALESCE(o.snoozed_until_utc,o.due_utc)<?
        AND NOT EXISTS(SELECT 1 FROM reminder_deliveries d WHERE d.occurrence_key=o.key AND d.state='claimed' AND d.claimed_at>?)
        ORDER BY o.due_utc,o.key LIMIT 100`).all(nowUtc, new Date(parseUtc(nowUtc) - 60_000).toISOString())
      for (const row of rows) {
        const item = this.getIn(tx, String(row.reminder_id))!
        if (row.state === 'pending') {
          tx.prepare("UPDATE reminder_occurrences SET state='missed' WHERE key=?").run(String(row.key))
          tx.prepare("INSERT INTO reminder_deliveries(occurrence_key,epoch,state,claimed_at) VALUES(?,'recovery','missed',?) ON CONFLICT(occurrence_key) DO UPDATE SET state='uncertain' WHERE state='claimed'").run(String(row.key), nowUtc)
        }
        this.ensureNext(tx, item, String(row.due_utc))
        this.refreshNext(tx, item); this.write(tx, item)
      }
      const count = this.collectMissedIn(tx, nowUtc)
      return Math.max(rows.length, count)
    })
  }
  public collectMissed(nowUtc: string): number {
    nowUtc = new Date(parseUtc(nowUtc)).toISOString()
    return this.database.transaction(tx => this.collectMissedIn(tx, nowUtc))
  }
  private collectMissedIn(tx: StateTransaction, nowUtc: string): number {
      const missing = tx.prepare(`SELECT o.key FROM reminder_occurrences o JOIN reminders r ON r.id=o.reminder_id
        WHERE o.state='missed' AND r.state='active' AND r.schedule_revision=o.schedule_revision
        AND NOT EXISTS(SELECT 1 FROM reminder_overdue_members m WHERE m.occurrence_key=o.key)
        ORDER BY o.due_utc,o.key LIMIT 100`).all()
      if (missing.length) {
        const existing = tx.prepare('SELECT id FROM reminder_overdue_batches WHERE acknowledged_at IS NULL ORDER BY created_at,id LIMIT 1').get()
        const id = existing ? String(existing.id) : randomUUID()
        if (!existing) tx.prepare('INSERT INTO reminder_overdue_batches(id,created_at) VALUES(?,?)').run(id, nowUtc)
        for (const row of missing) tx.prepare('INSERT INTO reminder_overdue_members(batch_id,occurrence_key) VALUES(?,?)').run(id, String(row.key))
      }
      return missing.length
  }
  public pendingBatch(cursor?: string, batchId?: string) {
    if (cursor !== undefined && !/^[a-f0-9]{64}$/.test(cursor)) throw new Error('invalid_overdue_cursor')
    if (batchId !== undefined && !uuid(batchId)) throw new Error('invalid_overdue_batch')
    return this.database.transaction(tx => {
      const batch = batchId ? tx.prepare('SELECT id FROM reminder_overdue_batches WHERE id=?').get(batchId)
        : tx.prepare('SELECT id FROM reminder_overdue_batches WHERE acknowledged_at IS NULL ORDER BY created_at,id LIMIT 1').get()
      if (!batch) return null
      const rows = tx.prepare(`SELECT o.* FROM reminder_overdue_members m JOIN reminder_occurrences o ON o.key=m.occurrence_key
        WHERE m.batch_id=? AND (? IS NULL OR o.key>?) ORDER BY o.key LIMIT 101`).all(String(batch.id), cursor ?? null, cursor ?? null)
      const total = Number(tx.prepare('SELECT COUNT(*) AS total FROM reminder_overdue_members WHERE batch_id=?').get(String(batch.id))!.total)
      const page = rows.slice(0, 100)
      return { batchId: String(batch.id), total, preview: page.map(occurrence), cursor: rows.length > 100 ? String(page.at(-1)!.key) : null }
    })
  }
  public acknowledgeBatch(batchId: string, nowUtc: string, expectedTotal?: number): boolean {
    if (!uuid(batchId)) throw new Error('invalid_overdue_batch')
    nowUtc = new Date(parseUtc(nowUtc)).toISOString()
    return this.database.transaction(tx => {
      if (expectedTotal !== undefined && Number(tx.prepare('SELECT COUNT(*) AS total FROM reminder_overdue_members WHERE batch_id=?').get(batchId)!.total) !== expectedTotal) return false
      const batch = tx.prepare('SELECT id FROM reminder_overdue_batches WHERE id=?').get(batchId)
      if (!batch) return false
      tx.prepare('UPDATE reminder_overdue_batches SET acknowledged_at=COALESCE(acknowledged_at,?) WHERE id=?').run(nowUtc, batchId)
      return true
    })
  }
  public updatePreferences(patch: Partial<Omit<ReminderPreferences, 'revision'>>, expectedRevision: number): ReminderPreferences {
    exactFields(patch, [], ['timeZone', 'allDayTime', 'notificationsEnabled'])
    if (!Object.keys(patch).length || !revision(expectedRevision)) throw new Error('invalid_reminder_preferences')
    if (Object.hasOwn(patch, 'timeZone')) this.calendar.validateTimeZone(patch.timeZone)
    if (Object.hasOwn(patch, 'allDayTime') && (typeof patch.allDayTime !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(patch.allDayTime))) throw new Error('invalid_all_day_time')
    if (Object.hasOwn(patch, 'notificationsEnabled') && typeof patch.notificationsEnabled !== 'boolean') throw new Error('invalid_reminder_preferences')
    this.database.transaction(tx => {
      const row = tx.prepare('SELECT * FROM reminder_preferences WHERE singleton=1').get()!
      if (row.revision !== expectedRevision) throw new Error('stale_preferences')
      tx.prepare('UPDATE reminder_preferences SET time_zone=?,all_day_time=?,notifications_enabled=?,revision=revision+1 WHERE singleton=1 AND revision=?')
        .run(patch.timeZone ?? String(row.time_zone), patch.allDayTime ?? String(row.all_day_time), patch.notificationsEnabled === undefined ? Number(row.notifications_enabled) : Number(patch.notificationsEnabled), expectedRevision)
    })
    return this.getPreferences()
  }
  private validate(request: MutationRequest): number {
    if (!request || typeof request !== 'object') throw new Error('invalid_reminder_mutation')
    switch (request.type) {
      case 'create':
        exactFields(request, ['type', 'title', 'description', 'schedule']); this.text(request.title, request.description); this.nativeSchedule(request.schedule); return 1
      case 'update':
        exactFields(request, ['type', 'id', 'expectedRevision', 'patch']); this.ref(request)
        exactFields(request.patch, [], ['title', 'description', 'schedule'])
        if (!Object.keys(request.patch).length) throw new Error('empty_reminder_patch')
        if (Object.hasOwn(request.patch, 'title')) this.text(request.patch.title, '')
        if (Object.hasOwn(request.patch, 'description')) this.text('valid', request.patch.description)
        if (Object.hasOwn(request.patch, 'schedule')) this.nativeSchedule(request.patch.schedule!)
        return 1
      case 'delete':
        exactFields(request, ['type', 'items'])
        if (!Array.isArray(request.items) || !request.items.length || request.items.length > 100) throw new Error('reminder_batch_limit')
        for (const item of request.items) { exactFields(item, ['id', 'expectedRevision']); this.ref(item) }
        if (new Set(request.items.map(item => item.id)).size !== request.items.length) throw new Error('duplicate_reminder_target')
        return request.items.length
      case 'complete': case 'snooze':
        exactFields(request, ['type', 'id', 'expectedRevision', 'occurrenceKey', ...(request.type === 'snooze' ? ['untilUtc'] : [])]); this.ref(request)
        if (typeof request.occurrenceKey !== 'string' || !/^[a-f0-9]{64}$/.test(request.occurrenceKey)) throw new Error('invalid_occurrence')
        if (request.type === 'snooze') parseUtc(request.untilUtc)
        return 1
      default: throw new Error('invalid_reminder_mutation')
    }
  }
  private text(title: unknown, description: unknown): void {
    if (typeof title !== 'string' || !title.trim() || title.length > 200 || typeof description !== 'string' || description.length > 4000) throw new Error('invalid_reminder_text')
  }
  private nativeSchedule(schedule: NativeSchedule): void {
    this.calendar.validate(schedule)
    if (schedule.policy !== 'jasper') throw new Error('imported_schedule_requires_codec')
  }
  private ref(value: { id: string; expectedRevision: number }): void {
    if (!uuid(value.id) || !revision(value.expectedRevision)) throw new Error('invalid_reminder_reference')
  }
  public mutate(request: MutationRequest, context: MutationContext) { return this.run([request], context, false) }
  public applyImportBatch(candidates: ImportCandidate[], context: MutationContext): ImportReport {
    exactFields(context, ['invocationId', 'nowUtc'])
    if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(context.invocationId)) throw new Error('invalid_reminder_invocation')
    const nowUtc = new Date(parseUtc(context.nowUtc)).toISOString()
    if (!Array.isArray(candidates) || candidates.length > 100 || new Set(candidates.map(item => item.uid)).size !== candidates.length) throw new Error('reminder_batch_limit')
    for (const item of candidates) {
      exactFields(item, ['uid', 'title', 'description', 'schedule', 'sourceHash', 'icalSource'])
      this.text(item.title, item.description); this.calendar.validate(item.schedule)
      if (item.schedule.policy !== 'ical' || typeof item.uid !== 'string' || !item.uid || item.uid.length > 512 || /[\0\r\n]/.test(item.uid)
        || typeof item.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(item.sourceHash)) throw new Error('invalid_import_candidate')
      exactFields(item.icalSource, ['component', 'allDay', 'sequence', 'dtstamp', 'canonicalComponent'])
      const source = item.icalSource
      if (!['vevent', 'vtodo'].includes(source.component) || typeof source.allDay !== 'boolean'
        || (source.sequence !== null && (!Number.isSafeInteger(source.sequence) || source.sequence < 0))
        || (source.dtstamp !== null && (typeof source.dtstamp !== 'string' || source.dtstamp.length > 32))
        || typeof source.canonicalComponent !== 'string' || source.canonicalComponent.length > 2 * 1024 * 1024) throw new Error('invalid_import_candidate')
    }
    const argsHash = hash(candidates)
    return this.database.transaction(tx => {
      const prior = tx.prepare('SELECT args_hash,report FROM reminder_import_receipts WHERE invocation_id=?').get(context.invocationId)
      if (prior) {
        if (prior.args_hash !== argsHash) throw new Error('invocation_conflict')
        return JSON.parse(String(prior.report)) as ImportReport
      }
      const report: ImportReport = { created: 0, updated: 0, unchanged: 0, conflicts: [], rejected: [], warnings: [] }
      for (const candidate of candidates) {
        const row = tx.prepare("SELECT * FROM reminders WHERE source='ical' AND uid=?").get(candidate.uid)
        const existing = row ? record(row) : null
        if (existing?.sourceHash === candidate.sourceHash) { report.unchanged++; continue }
        if (existing && (existing.localEdited || existing.state !== 'active')) { report.conflicts.push({ uid: candidate.uid, reason: 'local-edited' }); continue }
        if (existing?.icalSource?.sequence !== null && existing?.icalSource?.sequence !== undefined && candidate.icalSource.sequence !== null
          && candidate.icalSource.sequence < existing.icalSource.sequence) { report.conflicts.push({ uid: candidate.uid, reason: 'stale-source' }); continue }
        const id = existing?.id ?? randomUUID()
        const item: Reminder = existing ?? { id, revision: 0, scheduleRevision: 0, title: '', description: '', schedule: candidate.schedule, nextDueUtc: null,
          state: 'active', source: 'ical', uid: candidate.uid, sourceHash: null, localEdited: false, icalSource: null, createdAt: nowUtc, updatedAt: nowUtc }
        const changedSchedule = !existing || hash(existing.schedule) !== hash(candidate.schedule)
        if (existing) { item.revision++; report.updated++ } else report.created++
        if (existing && changedSchedule) {
          item.scheduleRevision++
          tx.prepare("UPDATE reminder_occurrences SET state='cancelled' WHERE reminder_id=? AND state='pending'").run(id)
        }
        item.title = candidate.title.trim(); item.description = candidate.description; item.schedule = structuredClone(candidate.schedule)
        item.sourceHash = candidate.sourceHash; item.icalSource = structuredClone(candidate.icalSource); item.updatedAt = nowUtc
        ;(report.affected ??= []).push({ id, revision: item.revision })
        this.write(tx, item)
        if (changedSchedule) {
          const first = this.calendar.resolve(item.schedule).utc
          this.ensureNext(tx, item, new Date(parseUtc(first) - 1).toISOString())
          this.refreshNext(tx, item); this.write(tx, item)
        }
      }
      tx.prepare('INSERT INTO reminder_import_receipts(invocation_id,args_hash,report,committed_at) VALUES(?,?,?,?)').run(context.invocationId, argsHash, JSON.stringify(report), nowUtc)
      return report
    })
  }
  public mutateBatch(requests: MutationRequest[], context: MutationContext) { return this.run(requests, context, true) }
  private run(requests: MutationRequest[], context: MutationContext, batch: boolean): { items: Reminder[]; receipt: ReminderReceipt } {
    exactFields(context, ['invocationId', 'nowUtc'])
    if (typeof context.invocationId !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(context.invocationId)) throw new Error('invalid_reminder_invocation')
    const nowUtc = new Date(parseUtc(context.nowUtc)).toISOString()
    if (!Array.isArray(requests) || !requests.length || requests.length > 100) throw new Error('reminder_batch_limit')
    if (requests.reduce((count, request) => count + this.validate(request), 0) > 100) throw new Error('reminder_batch_limit')
    const argsHash = hash({ batch, requests }), capabilityId = batch ? 'reminder_batch' : `reminder_${requests[0].type}`
    return this.database.transaction(tx => {
      const stored = tx.prepare('SELECT * FROM reminder_receipts WHERE invocation_id=?').get(context.invocationId)
      if (stored) {
        const proof = receipt(stored)
        if (proof.argsHash !== argsHash || proof.capabilityId !== capabilityId) throw new Error('invocation_conflict')
        return { items: proof.affected.map(item => this.getIn(tx, item.id)!).filter(Boolean), receipt: proof }
      }
      const affected = new Map<string, Reminder>()
      for (const request of requests) for (const item of this.apply(tx, request, nowUtc)) affected.set(item.id, item)
      const items = [...affected.values()]
      const proof: ReminderReceipt = { invocationId: context.invocationId, capabilityId, argsHash, affected: items.map(item => ({ id: item.id, revision: item.revision })), committedAt: nowUtc }
      tx.prepare('INSERT INTO reminder_receipts(invocation_id,capability_id,args_hash,affected,committed_at) VALUES(?,?,?,?,?)')
        .run(proof.invocationId, proof.capabilityId, proof.argsHash, JSON.stringify(proof.affected), nowUtc)
      return { items, receipt: proof }
    })
  }
  private write(tx: StateTransaction, item: Reminder): void {
    tx.prepare(`INSERT INTO reminders(id,revision,schedule_revision,title,description,schedule,next_due_utc,state,source,uid,source_hash,local_edited,ical_source,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,schedule_revision=excluded.schedule_revision,
      title=excluded.title,description=excluded.description,schedule=excluded.schedule,next_due_utc=excluded.next_due_utc,state=excluded.state,
      source_hash=excluded.source_hash,ical_source=excluded.ical_source,local_edited=excluded.local_edited,updated_at=excluded.updated_at`)
      .run(item.id, item.revision, item.scheduleRevision, item.title, item.description, JSON.stringify(item.schedule), item.nextDueUtc, item.state, item.source, item.uid, item.sourceHash, Number(item.localEdited), item.icalSource === null ? null : JSON.stringify(item.icalSource), item.createdAt, item.updatedAt)
  }
  private ensureNext(tx: StateTransaction, item: Reminder, afterUtc: string): void {
    const next = this.calendar.nextAfter(item.schedule, afterUtc)
    if (!next) return
    const key = hash([item.id, item.scheduleRevision, next.nominalLocalTime])
    tx.prepare("INSERT OR IGNORE INTO reminder_occurrences(key,reminder_id,schedule_revision,nominal_local_time,due_utc,state) VALUES(?,?,?,?,?,'pending')")
      .run(key, item.id, item.scheduleRevision, next.nominalLocalTime, next.utc)
  }
  private refreshNext(tx: StateTransaction, item: Reminder): void {
    const value = tx.prepare("SELECT MIN(COALESCE(snoozed_until_utc,due_utc)) AS due FROM reminder_occurrences WHERE reminder_id=? AND schedule_revision=? AND state='pending'").get(item.id, item.scheduleRevision)!.due
    item.nextDueUtc = value === null ? null : String(value)
  }
  private require(tx: StateTransaction, id: string, expectedRevision: number): Reminder {
    const item = this.getIn(tx, id)
    if (!item) throw new Error('reminder_not_found')
    if (item.revision !== expectedRevision) throw new Error('stale_reminder')
    if (item.state === 'deleted') throw new Error('reminder_deleted')
    return item
  }
  private apply(tx: StateTransaction, request: MutationRequest, nowUtc: string): Reminder[] {
    if (request.type === 'create') {
      const id = randomUUID()
      const item: Reminder = { id, revision: 0, scheduleRevision: 0, title: request.title.trim(), description: request.description, schedule: structuredClone(request.schedule), nextDueUtc: null,
        state: 'active', source: 'jasper', uid: `${id}@jasper.local`, sourceHash: null, localEdited: false, icalSource: null, createdAt: nowUtc, updatedAt: nowUtc }
      this.write(tx, item)
      this.ensureNext(tx, item, new Date(parseUtc(nowUtc) - 1).toISOString())
      this.refreshNext(tx, item)
      if (item.nextDueUtc === null) throw new Error('reminder_date_not_future')
      this.write(tx, item); return [item]
    }
    if (request.type === 'delete') return request.items.map(ref => {
      const item = this.require(tx, ref.id, ref.expectedRevision)
      item.state = 'deleted'; item.revision++; item.updatedAt = nowUtc; item.nextDueUtc = null
      tx.prepare("UPDATE reminder_occurrences SET state='cancelled' WHERE reminder_id=? AND state='pending'").run(item.id)
      this.write(tx, item); return item
    })
    const item = this.require(tx, request.id, request.expectedRevision)
    if (request.type === 'update') {
      if (request.patch.title !== undefined) item.title = request.patch.title.trim()
      if (request.patch.description !== undefined) item.description = request.patch.description
      if (request.patch.schedule !== undefined && hash(request.patch.schedule) !== hash(item.schedule)) {
        if (item.state !== 'active') throw new Error('reminder_not_active')
        item.schedule = structuredClone(request.patch.schedule); item.scheduleRevision++
        tx.prepare("UPDATE reminder_occurrences SET state='cancelled' WHERE reminder_id=? AND state='pending'").run(item.id)
        this.ensureNext(tx, item, new Date(parseUtc(nowUtc) - 1).toISOString())
        this.refreshNext(tx, item)
        if (item.nextDueUtc === null) throw new Error('reminder_date_not_future')
      }
    } else {
      if (item.state !== 'active') throw new Error('reminder_not_active')
      const row = tx.prepare('SELECT * FROM reminder_occurrences WHERE key=? AND reminder_id=? AND schedule_revision=?').get(request.occurrenceKey, item.id, item.scheduleRevision)
      if (!row || !['pending', 'notified', 'missed'].includes(String(row.state))) throw new Error('occurrence_not_actionable')
      const current = occurrence(row)
      if (request.type === 'snooze') {
        const until = parseUtc(request.untilUtc)
        if (until <= parseUtc(nowUtc) || until <= parseUtc(current.snoozedUntilUtc ?? current.dueUtc)) throw new Error('snooze_must_postpone')
        tx.prepare("UPDATE reminder_occurrences SET state='pending',snoozed_until_utc=? WHERE key=?").run(new Date(until).toISOString(), current.key)
      } else {
        tx.prepare("UPDATE reminder_occurrences SET state='completed' WHERE key=?").run(current.key)
        if (item.schedule.recurrence === 'none') item.state = 'completed'
      }
      if (item.schedule.recurrence !== 'none') this.ensureNext(tx, item, current.dueUtc)
      this.refreshNext(tx, item)
    }
    item.revision++; item.updatedAt = nowUtc
    if (item.source === 'ical') item.localEdited = true
    this.write(tx, item); return [item]
  }
}
