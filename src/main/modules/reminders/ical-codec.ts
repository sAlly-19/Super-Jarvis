import ICAL from 'ical.js'
import { createHash } from 'node:crypto'
import type { ImportCandidate, ImportReport, Reminder, ReminderPreferences, ImportedSchedule } from '../../../shared/types/reminders'
import { ReminderCalendar, parseCivil } from './calendar'

export const emptyImportReport = (): ImportReport => ({ created: 0, updated: 0, unchanged: 0, conflicts: [], rejected: [], warnings: [] })
const fail = (reason: string): never => { throw new Error(reason) }
const calendar: ReminderCalendar = new ReminderCalendar(Infinity)
const canonicalValue = (value: any): any => Array.isArray(value) ? value.map(canonicalValue) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])])) : value
function dateValue(property: ICAL.Property, prefs: ReminderPreferences) {
  const raw = String(property.jCal[3]), allDay = property.type === 'date'
  const localDateTime = allDay ? `${raw}T${prefs.allDayTime}:00` : raw.replace(/Z$/, '')
  parseCivil(localDateTime)
  const timeZone = raw.endsWith('Z') ? 'UTC' : String(property.getParameter('tzid') || prefs.timeZone)
  calendar.validateTimeZone(timeZone)
  return { localDateTime, timeZone, allDay }
}
function supportedRule(text: string | null): ImportedSchedule['recurrence'] {
  if (!text) return 'none'
  const fields: Record<string, string> = Object.fromEntries(text.split(';').map(field => field.split('=')))
  if (!['DAILY', 'WEEKLY', 'MONTHLY'].includes(fields.FREQ)) fail('unsupported_recurrence')
  if (Object.keys(fields).some(key => !['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'BYMONTHDAY', 'BYSETPOS', 'WKST'].includes(key))) fail('unsupported_recurrence')
  for (const key of ['COUNT', 'INTERVAL']) if (fields[key] && !/^[1-9]\d{0,5}$/.test(fields[key])) fail('unsupported_recurrence')
  if (fields.COUNT && fields.UNTIL) fail('unsupported_recurrence')
  if (fields.BYDAY && (fields.FREQ !== 'WEEKLY' || !/^(MO|TU|WE|TH|FR|SA|SU)(,(MO|TU|WE|TH|FR|SA|SU))*$/.test(fields.BYDAY))) fail('unsupported_recurrence')
  if (fields.BYMONTHDAY && (fields.FREQ !== 'MONTHLY' || !fields.BYMONTHDAY.split(',').every(day => /^(?:[1-9]|[12]\d|3[01])$/.test(day)))) fail('unsupported_recurrence')
  // Precisely the equivalent clamp rules emitted by Jasper, not arbitrary BYSETPOS.
  if (fields.BYSETPOS && (fields.BYSETPOS !== '-1' || fields.FREQ !== 'MONTHLY' || !['28,29', '28,29,30', '28,29,30,31'].includes(fields.BYMONTHDAY))) fail('unsupported_recurrence')
  if (fields.WKST && !/^(MO|TU|WE|TH|FR|SA|SU)$/.test(fields.WKST)) fail('unsupported_recurrence')
  return fields.FREQ.toLowerCase() as ImportedSchedule['recurrence']
}

/** Worker-only in production. No filesystem, database, network or command execution. */
export function parseCalendar(bytes: Uint8Array, prefs: ReminderPreferences): { candidates: ImportCandidate[]; report: ImportReport } {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > 2 * 1024 * 1024) fail('ical_size_limit')
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(prefs.allDayTime)) fail('invalid_all_day_time')
  calendar.validateTimeZone(prefs.timeZone)
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  let depth = 0, count = 0
  for (const line of text.split(/\r?\n/)) {
    if (/^BEGIN:/i.test(line)) { if (++depth > 16 || ++count > 1001) fail('ical_component_limit') }
    if (/^END:/i.test(line) && --depth < 0) fail('invalid_calendar')
  }
  if (depth !== 0) fail('invalid_calendar')
  const root = new ICAL.Component(ICAL.parse(text))
  if (root.name !== 'vcalendar') fail('invalid_calendar')
  const report = emptyImportReport(), candidates = new Map<string, ImportCandidate>(), conflicted = new Set<string>()
  const customZones = new Set(root.getAllSubcomponents('vtimezone').map(zone => String(zone.getFirstPropertyValue('tzid'))))
  for (const component of root.getAllSubcomponents()) {
    if (!['vevent', 'vtodo'].includes(component.name)) continue
    let uid: string | undefined
    try {
      uid = String(component.getFirstPropertyValue('uid') || '')
      if (!uid || uid.length > 512 || /[\0\r\n]/.test(uid)) fail('invalid_uid')
      if (component.hasProperty('rdate') || component.hasProperty('recurrence-id') || component.hasProperty('exrule')) fail('unsupported_recurrence')
      for (const name of ['uid', 'summary', 'description', 'dtstart', 'due', 'rrule', 'sequence', 'dtstamp']) if (component.getAllProperties(name).length > 1) fail('duplicate_property')
      const property = component.getFirstProperty(component.name === 'vevent' ? 'dtstart' : 'due')
      if (!property) fail('missing_date')
      if (customZones.has(String(property!.getParameter('tzid')))) fail('unsupported_vtimezone_definition')
      const date = dateValue(property!, prefs)
      const title = String(component.getFirstPropertyValue('summary') || ''), description = String(component.getFirstPropertyValue('description') || '')
      const status = component.getFirstPropertyValue('status')
      if (status && !['NEEDS-ACTION', 'IN-PROCESS', 'CONFIRMED', 'TENTATIVE'].includes(String(status))) fail('unsupported_source_status')
      if (!title.trim() || title.length > 200 || description.length > 4000) fail('invalid_reminder_text')
      const rawRule = component.getFirstProperty('rrule')?.jCal[3]
      if (rawRule && (Object.keys(rawRule).some(key => !['freq', 'interval', 'count', 'until', 'byday', 'bymonthday', 'bysetpos', 'wkst'].includes(key))
        || ['interval', 'count'].some(key => rawRule[key] !== undefined && (!Number.isSafeInteger(rawRule[key]) || rawRule[key] < 1)))) fail('unsupported_recurrence')
      const rule = component.getFirstPropertyValue('rrule')?.toString() ?? null
      const recurrence = supportedRule(rule)
      if (recurrence !== 'none' && component.name === 'vtodo') {
        const start = component.getFirstProperty('dtstart')
        if (!start || JSON.stringify(dateValue(start, prefs)) !== JSON.stringify(date)) fail('unsupported_task_due_relation')
      }
      const exdates: string[] = []
      for (const property of component.getAllProperties('exdate')) {
        for (const value of property.jCal.slice(3)) {
          const clone = new ICAL.Property(structuredClone(property.jCal)); clone.jCal.splice(3, Infinity, value)
          const excluded = dateValue(clone, prefs)
          if (excluded.timeZone !== date.timeZone || excluded.allDay !== date.allDay) fail('unsupported_exdate_zone')
          exdates.push(excluded.localDateTime)
        }
      }
      const schedule: ImportedSchedule = { policy: 'ical', localDateTime: date.localDateTime, timeZone: date.timeZone, anchorDay: Number(date.localDateTime.slice(8, 10)), recurrence, icalRule: { rrule: rule, exdates: [...new Set(exdates)].sort() } }
      calendar.validate(schedule); calendar.resolve(schedule)
      calendar.nextAfter(schedule, new Date(parseCivil(date.localDateTime) - 2 * 86400000).toISOString())
      const sequenceValue = component.getFirstPropertyValue('sequence')
      const sequence = sequenceValue === null ? null : Number(sequenceValue)
      if (sequence !== null && (!Number.isSafeInteger(sequence) || sequence < 0)) fail('invalid_sequence')
      if (component.getAllSubcomponents().length) report.warnings.push('Subcomponentes e alarmes externos ignorados.')
      component.removeAllSubcomponents()
      const canonical = structuredClone(component.jCal)
      canonical[1] = canonical[1].filter((property: any[]) => property[0] !== 'dtstamp').sort((a: any[], b: any[]) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      const candidate: ImportCandidate = { uid, title: title.trim(), description, schedule,
        sourceHash: createHash('sha256').update(JSON.stringify(canonicalValue(canonical))).digest('hex'),
        icalSource: { component: component.name as 'vevent' | 'vtodo', allDay: date.allDay, sequence, dtstamp: component.getFirstPropertyValue('dtstamp')?.toString() ?? null, canonicalComponent: component.toString() } }
      if (conflicted.has(uid)) continue
      const previous = candidates.get(uid)
      if (previous && previous.sourceHash !== candidate.sourceHash) {
        candidates.delete(uid); conflicted.add(uid); report.rejected.push({ uid, reason: 'conflicting_duplicate_uid' })
      } else candidates.set(uid, candidate)
    } catch (error) {
      report.rejected.push({ ...(uid ? { uid } : {}), reason: error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : 'unsupported_or_invalid_component' })
    }
  }
  return { candidates: [...candidates.values()], report }
}

export function serializeCalendar(items: Reminder[]): Uint8Array {
  if (!Array.isArray(items) || items.length > 1000) fail('ical_component_limit')
  const root = new ICAL.Component('vcalendar')
  root.addPropertyWithValue('version', '2.0'); root.addPropertyWithValue('prodid', '-//Jasper//Reminders//PT-BR')
  for (const item of items) {
    if (item.state !== 'active') fail('unsupported_export_state')
    const schedule = item.schedule; calendar.validate(schedule)
    if (item.source === 'ical' && schedule.policy !== 'ical') fail('unsupported_export_modified_import_schedule')
    if (schedule.policy === 'jasper' && schedule.recurrence !== 'none' && schedule.timeZone !== 'UTC') fail('unsupported_export_dst_policy')
    if (calendar.resolve(schedule).adjusted) fail('unsupported_export_adjusted_time')
    const component = item.icalSource ? ICAL.Component.fromString(item.icalSource.canonicalComponent) : new ICAL.Component('vtodo')
    component.updatePropertyWithValue('uid', item.uid)
    component.updatePropertyWithValue('summary', item.title)
    component.updatePropertyWithValue('description', item.description)
    const allDay = item.icalSource?.allDay === true
    const value = allDay ? schedule.localDateTime.slice(0, 10) : schedule.localDateTime + (schedule.timeZone === 'UTC' ? 'Z' : '')
    const date = new ICAL.Property(component.name === 'vevent' ? 'dtstart' : 'due')
    date.setValue(allDay ? ICAL.Time.fromDateString(value) : ICAL.Time.fromDateTimeString(value))
    if (schedule.timeZone !== 'UTC' && !allDay) date.setParameter('tzid', schedule.timeZone)
    component.removeAllProperties(date.name); component.addProperty(date)
    component.removeAllProperties('rrule'); component.removeAllProperties('exdate')
    let rule = schedule.policy === 'ical' ? schedule.icalRule.rrule : schedule.recurrence === 'none' ? null : `FREQ=${schedule.recurrence.toUpperCase()}`
    if (schedule.policy === 'jasper' && schedule.recurrence === 'monthly' && schedule.anchorDay > 28) rule += `;BYMONTHDAY=${Array.from({ length: schedule.anchorDay - 27 }, (_, index) => 28 + index).join(',')};BYSETPOS=-1`
    if (rule) {
      component.addPropertyWithValue('rrule', ICAL.Recur.fromString(rule))
      if (component.name === 'vtodo') { component.removeAllProperties('dtstart'); const start = new ICAL.Property(structuredClone(date.jCal)); start.jCal[0] = 'dtstart'; component.addProperty(start) }
    }
    if (schedule.policy === 'ical') for (const excluded of schedule.icalRule.exdates) {
      const property = new ICAL.Property('exdate')
      property.setValue(allDay ? ICAL.Time.fromDateString(excluded.slice(0, 10)) : ICAL.Time.fromDateTimeString(excluded + (schedule.timeZone === 'UTC' ? 'Z' : '')))
      if (schedule.timeZone !== 'UTC' && !allDay) property.setParameter('tzid', schedule.timeZone)
      component.addProperty(property)
    }
    root.addSubcomponent(component)
  }
  const bytes = new TextEncoder().encode(root.toString() + '\r\n')
  if (bytes.byteLength > 2 * 1024 * 1024) fail('ical_size_limit')
  return bytes
}
