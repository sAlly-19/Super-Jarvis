export type ReminderRecurrence = 'none' | 'daily' | 'weekly' | 'monthly'
interface ScheduleFields { localDateTime: string; timeZone: string; recurrence: ReminderRecurrence; anchorDay: number }
export interface NativeSchedule extends ScheduleFields { policy: 'jasper' }
export interface ImportedSchedule extends ScheduleFields { policy: 'ical'; icalRule: { rrule: string | null; exdates: string[] } }
export type CivilSchedule = NativeSchedule | ImportedSchedule
export interface IcalSource { component: 'vevent' | 'vtodo'; allDay: boolean; sequence: number | null; dtstamp: string | null; canonicalComponent: string }
export interface Reminder {
  id: string; revision: number; scheduleRevision: number; title: string; description: string
  schedule: CivilSchedule; nextDueUtc: string | null; state: 'active' | 'completed' | 'deleted'
  source: 'jasper' | 'ical'; uid: string; sourceHash: string | null; localEdited: boolean
  icalSource: IcalSource | null; createdAt: string; updatedAt: string
}
export interface Occurrence {
  key: string; reminderId: string; scheduleRevision: number; nominalLocalTime: string; dueUtc: string
  state: 'pending' | 'notified' | 'completed' | 'missed' | 'cancelled'; snoozedUntilUtc: string | null
}
export interface MutationContext { invocationId: string; nowUtc: string }
export interface ReminderReceipt { invocationId: string; capabilityId: string; argsHash: string; affected: Array<{ id: string; revision: number }>; committedAt: string }
export interface ReminderPreferences { timeZone: string; allDayTime: string; notificationsEnabled: boolean; revision: number }
export interface ReminderListQuery { state?: 'active' | 'completed'; fromUtc?: string; toUtc?: string; cursor?: string; limit: number }
export type MutationRequest =
  | { type: 'create'; title: string; description: string; schedule: NativeSchedule }
  | { type: 'update'; id: string; expectedRevision: number; patch: { title?: string; description?: string; schedule?: NativeSchedule } }
  | { type: 'delete'; items: Array<{ id: string; expectedRevision: number }> }
  | { type: 'complete'; id: string; expectedRevision: number; occurrenceKey: string }
  | { type: 'snooze'; id: string; expectedRevision: number; occurrenceKey: string; untilUtc: string }
export interface ImportCandidate { uid: string; sourceHash: string; icalSource: IcalSource; title: string; description: string; schedule: ImportedSchedule }
export interface ImportReport { created: number; updated: number; unchanged: number; conflicts: Array<{ uid: string; reason: string }>; rejected: Array<{ uid?: string; reason: string }>; warnings: string[]; interrupted?: boolean; affected?: Array<{ id: string; revision: number }> }
export interface OverdueBatch { id: string; occurrenceKeys: string[]; createdAt: string; acknowledgedAt: string | null }
export type ReminderView = Reminder & { occurrenceKey: string | null }
export interface ReminderPage { items: ReminderView[]; nextCursor: string | null }
export interface ReminderOverdueSummary { batchId: string; total: number; preview: Occurrence[]; cursor: string | null }
export type ReminderImportAction = { type: 'preview' } | { type: 'apply'; token: string } | { type: 'cancel' }
export interface ReminderImportResult { status: 'cancelled' | 'preview' | 'applied'; token?: string; count?: number; report: ImportReport }
export interface ReminderExportRequest { items: Array<{ id: string; expectedRevision: number }> }
export type ReminderPreferencesRequest = { type: 'get' } | { type: 'update'; patch: Partial<Omit<ReminderPreferences, 'revision'>>; expectedRevision: number }
