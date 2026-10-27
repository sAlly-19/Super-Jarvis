import ICAL from 'ical.js'
import { createHash } from 'node:crypto'
import type { CivilSchedule } from '../../../shared/types/reminders'

export const plainObject = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object'
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
export function exactFields(value: unknown, required: string[], optional: string[] = []): asserts value is Record<string, any> {
  if (!plainObject(value) || required.some(key => !Object.hasOwn(value, key))
    || Object.keys(value).some(key => ![...required, ...optional].includes(key))) throw new Error('invalid_reminder_fields')
}
function epoch(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  const value = new Date(0); value.setUTCFullYear(year, month - 1, day); value.setUTCHours(hour, minute, second, 0)
  return value.getTime()
}
export function parseCivil(text: unknown): number {
  if (typeof text !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(text)) throw new Error('invalid_civil_time')
  const values = text.match(/\d+/g)!.map(Number)
  if (values[0] < 1) throw new Error('invalid_civil_time')
  const value = epoch(values[0], values[1], values[2], values[3], values[4], values[5])
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 19) !== text) throw new Error('invalid_civil_time')
  return value
}
export function parseUtc(text: unknown): number {
  if (typeof text !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(text)) throw new Error('invalid_utc_time')
  parseCivil(text.slice(0, 19))
  const value = Date.parse(text)
  if (!Number.isFinite(value)) throw new Error('invalid_utc_time')
  return value
}
const civilText = (value: number): string => new Date(value).toISOString().slice(0, 19)

/** Civil-time resolution never uses the machine's implicit timezone. */
export class ReminderCalendar {
  private readonly formatters = new Map<string, Intl.DateTimeFormat>()
  private readonly cursors = new Map<string, { after: number; iterator: ReturnType<ICAL.Recur['iterator']>; validInstances: number; steps: number; result: { nominalLocalTime: string; utc: string } | null; finished: boolean; excluded: Set<string> }>()
  constructor(private readonly workBudgetMs = 16) {}
  public validateTimeZone(zone: unknown): asserts zone is string {
    if (typeof zone !== 'string' || !zone || zone.length > 160) throw new Error('invalid_time_zone')
    this.formatter(zone)
  }
  private formatter(zone: string): Intl.DateTimeFormat {
    let value = this.formatters.get(zone)
    if (!value) {
      value = new Intl.DateTimeFormat('en-GB-u-ca-gregory-nu-latn', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      this.formatters.set(zone, value)
    }
    return value
  }
  private wall(utc: number, zone: string): number {
    const parts = Object.fromEntries(this.formatter(zone).formatToParts(utc).map(part => [part.type, part.value]))
    return epoch(+parts.year, +parts.month, +parts.day, +parts.hour, +parts.minute, +parts.second)
  }
  private offset(utc: number, zone: string): number { return this.wall(utc, zone) - Math.floor(utc / 1000) * 1000 }

  public validate(schedule: CivilSchedule): void {
    exactFields(schedule, ['localDateTime', 'timeZone', 'recurrence', 'anchorDay', 'policy'], schedule?.policy === 'ical' ? ['icalRule'] : [])
    const base = parseCivil(schedule.localDateTime)
    this.validateTimeZone(schedule.timeZone)
    if (!['none', 'daily', 'weekly', 'monthly'].includes(schedule.recurrence)
      || !Number.isInteger(schedule.anchorDay) || schedule.anchorDay < 1 || schedule.anchorDay > 31
      || !['jasper', 'ical'].includes(schedule.policy)) throw new Error('invalid_schedule')
    if (schedule.policy === 'jasper' && schedule.recurrence === 'monthly') {
      const date = new Date(base)
      const last = new Date(epoch(date.getUTCFullYear(), date.getUTCMonth() + 2, 0)).getUTCDate()
      if (date.getUTCDate() !== Math.min(schedule.anchorDay, last)) throw new Error('invalid_monthly_anchor')
    }
    if (schedule.policy === 'ical') {
      exactFields(schedule.icalRule, ['rrule', 'exdates'])
      if ((schedule.icalRule.rrule !== null && typeof schedule.icalRule.rrule !== 'string')
        || !Array.isArray(schedule.icalRule.exdates) || schedule.icalRule.exdates.length > 50000) throw new Error('invalid_ical_rule')
      for (const item of schedule.icalRule.exdates) parseCivil(item)
      if (schedule.icalRule.rrule !== null) {
        const rule = ICAL.Recur.fromString(schedule.icalRule.rrule)
        if (!['DAILY', 'WEEKLY', 'MONTHLY'].includes(rule.freq) || rule.freq.toLowerCase() !== schedule.recurrence) throw new Error('unsupported_ical_rule')
      } else if (schedule.recurrence !== 'none') throw new Error('invalid_ical_rule')
    }
  }

  public resolve(schedule: CivilSchedule): { utc: string; adjusted: boolean } {
    this.validate(schedule)
    return this.resolveWall(parseCivil(schedule.localDateTime), schedule.timeZone, schedule.policy === 'jasper')
  }
  private resolveWall(wall: number, zone: string, repairGap: boolean): { utc: string; adjusted: boolean } {
    const samples: Array<{ utc: number; offset: number }> = []
    for (let hours = -48; hours <= 48; hours += 6) {
      const utc = wall + hours * 3600000
      samples.push({ utc, offset: this.offset(utc, zone) })
    }
    const candidates = [...new Set(samples.map(item => item.offset))].map(offset => wall - offset)
      .filter(utc => this.wall(utc, zone) === wall).sort((a, b) => a - b)
    if (candidates.length) return { utc: new Date(candidates[0]).toISOString(), adjusted: false }
    if (!repairGap) throw new Error('nonexistent_ical_time')
    for (let index = 1; index < samples.length; index++) {
      const before = samples[index - 1], after = samples[index]
      if (before.offset === after.offset) continue
      let lo = Math.floor(before.utc / 1000), hi = Math.floor(after.utc / 1000)
      while (hi - lo > 1) {
        const middle = Math.floor((lo + hi) / 2)
        if (this.offset(middle * 1000, zone) === before.offset) lo = middle; else hi = middle
      }
      const transition = hi * 1000
      if (this.wall(transition - 1000, zone) < wall && this.wall(transition, zone) > wall)
        return { utc: new Date(transition).toISOString(), adjusted: true }
    }
    throw new Error('unresolvable_civil_time')
  }

  public nextAfter(schedule: CivilSchedule, afterUtc: string): { nominalLocalTime: string; utc: string } | null {
    this.validate(schedule)
    const after = parseUtc(afterUtc), base = parseCivil(schedule.localDateTime)
    if (schedule.policy === 'ical' && schedule.icalRule.rrule !== null) {
      const rule = ICAL.Recur.fromString(schedule.icalRule.rrule)
      const position = rule.parts.BYSETPOS
      const monthDays = rule.parts.BYMONTHDAY
      const clampPosition = rule.freq === 'MONTHLY' && position?.length === 1 && position[0] === -1
        && ['28,29', '28,29,30', '28,29,30,31'].includes(monthDays?.join(',') ?? '')
      const count = rule.count
      const until = rule.until?.toString() ?? null
      // The iterator expands civil dates. Apply COUNT/UNTIL only after resolving the actual zone.
      rule.count = null; rule.until = null
      const key = createHash('sha256').update(JSON.stringify(schedule)).digest('hex')
      let cursor = this.cursors.get(key)
      if (!cursor || after < cursor.after) {
        cursor = { after, iterator: rule.iterator(ICAL.Time.fromDateTimeString(schedule.localDateTime)), validInstances: 0, steps: 0, result: null, finished: false, excluded: new Set(schedule.icalRule.exdates) }
        this.cursors.delete(key)
        if (this.cursors.size >= 256) this.cursors.delete(this.cursors.keys().next().value!)
        this.cursors.set(key, cursor)
      }
      cursor.after = after
      if (cursor.finished) return null
      if (cursor.result && parseUtc(cursor.result.utc) > after) return { ...cursor.result }
      cursor.result = null
      const started = performance.now()
      for (; cursor.steps < 50000;) {
        if (performance.now() - started >= this.workBudgetMs) throw new Error('recurrence_checkpoint_pending')
        const value = cursor.iterator.next(); cursor.steps++
        if (!value) { cursor.finished = true; return null }
        const nominalLocalTime = value.toString().replace(/Z$/, '')
        try {
          const resolved = this.resolveWall(parseCivil(nominalLocalTime), schedule.timeZone, false)
          if (until !== null && (until.endsWith('Z') ? parseUtc(resolved.utc) > parseUtc(until)
            : until.length === 10 ? nominalLocalTime.slice(0, 10) > until : parseCivil(nominalLocalTime) > parseCivil(until))) { cursor.finished = true; return null }
          // ical.js2.2.1 ignores BYSETPOS with BYMONTHDAY alone. Apply the supported
          // generated last-candidate selector before COUNT; do not change RFC gap behavior.
          if (clampPosition) {
            const civil = new Date(parseCivil(nominalLocalTime))
            const last = new Date(epoch(civil.getUTCFullYear(), civil.getUTCMonth() + 2, 0)).getUTCDate()
            if (civil.getUTCDate() !== Math.min(Math.max(...(monthDays ?? [])), last)) continue
          }
          cursor.validInstances++
          if (count !== null && cursor.validInstances > count) { cursor.finished = true; return null }
          if (cursor.excluded.has(nominalLocalTime)) continue
          if (parseUtc(resolved.utc) > after) { cursor.result = { nominalLocalTime, utc: resolved.utc }; return { ...cursor.result } }
        } catch (error) { if (!(error instanceof Error) || error.message !== 'nonexistent_ical_time') { this.cursors.delete(key); throw error } }
      }
      throw new Error('recurrence_budget_exceeded')
    }
    if (schedule.recurrence === 'none') {
      if (schedule.policy === 'ical' && schedule.icalRule.exdates.includes(schedule.localDateTime)) return null
      const first = this.resolve(schedule)
      return parseUtc(first.utc) > after ? { nominalLocalTime: schedule.localDateTime, utc: first.utc } : null
    }
    const baseDate = new Date(base), localAfter = this.wall(after, schedule.timeZone), afterDate = new Date(localAfter)
    const days = schedule.recurrence === 'weekly' ? 7 : 1
    let index = schedule.recurrence === 'monthly'
      ? Math.max(0, (afterDate.getUTCFullYear() - baseDate.getUTCFullYear()) * 12 + afterDate.getUTCMonth() - baseDate.getUTCMonth())
      : Math.max(0, Math.floor((localAfter - base) / (days * 86400000)))
    for (let attempt = 0; attempt < 8; attempt++, index++) {
      let candidate: number
      if (schedule.recurrence === 'monthly') {
        const month = new Date(epoch(baseDate.getUTCFullYear(), baseDate.getUTCMonth() + 1 + index, 1))
        const last = new Date(epoch(month.getUTCFullYear(), month.getUTCMonth() + 2, 0)).getUTCDate()
        candidate = epoch(month.getUTCFullYear(), month.getUTCMonth() + 1, Math.min(schedule.anchorDay, last), baseDate.getUTCHours(), baseDate.getUTCMinutes(), baseDate.getUTCSeconds())
      } else candidate = base + index * days * 86400000
      const resolved = this.resolveWall(candidate, schedule.timeZone, true)
      if (parseUtc(resolved.utc) > after) return { nominalLocalTime: civilText(candidate), utc: resolved.utc }
    }
    throw new Error('recurrence_budget_exceeded')
  }
}
