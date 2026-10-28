import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCalendar, serializeCalendar } from '../src/main/modules/reminders/ical-codec'
import { ReminderCalendar } from '../src/main/modules/reminders/calendar'

const prefs = { timeZone: 'America/Sao_Paulo', allDayTime: '09:00', notificationsEnabled: true, revision: 0 }
const bytes = (components: string) => new TextEncoder().encode(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${components}\r\nEND:VCALENDAR\r\n`)
const event = (props: string, uid = 'fixture') => `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:Reunião\\, equipe\r\n${props}\r\nEND:VEVENT`

test('ical reads events/tasks, civil zones, date-only preference and canonical content hashes', () => {
  const data = bytes(`${event('DTSTART;TZID=America/Sao_Paulo:20271101T100000\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nEXDATE;TZID=America/Sao_Paulo:20271108T100000')}\r\nBEGIN:VTODO\r\nUID:task\r\nSUMMARY:Tarefa\r\nDUE;VALUE=DATE:20271102\r\nEND:VTODO`)
  const result = parseCalendar(data, prefs)
  assert.equal(result.report.rejected.length, 0)
  assert.equal(result.candidates.length, 2)
  assert.equal(result.candidates[0].title, 'Reunião, equipe')
  assert.deepEqual(result.candidates[0].schedule.icalRule.exdates, ['2027-11-08T10:00:00'])
  assert.equal(result.candidates[1].schedule.localDateTime, '2027-11-02T09:00:00')
  assert.equal(result.candidates[1].icalSource.allDay, true)
  const hash = parseCalendar(bytes(event('DTSTART:20271101T100000Z\r\nDTSTAMP:20270101T000000Z')), prefs).candidates[0].sourceHash
  assert.equal(parseCalendar(bytes(event('DTSTART:20271101T100000Z\r\nDTSTAMP:20270201T000000Z')), prefs).candidates[0].sourceHash, hash)
})

test('ical rejects unsupported semantics and conflicting UIDs without silent conversion', () => {
  const result = parseCalendar(bytes([
    event('DTSTART:20271101T100000Z\r\nRDATE:20271102T100000Z', 'rdate'),
    event('DTSTART;TZID=Custom/Zone:20271101T100000', 'zone'),
    event('DTSTART:20271101T100000Z', 'duplicate'),
    event('DTSTART:20271102T100000Z', 'duplicate')
  ].join('\r\n')), prefs)
  assert.equal(result.candidates.length, 0)
  assert.equal(result.report.rejected.length, 3)
  assert.throws(() => parseCalendar(new Uint8Array(2 * 1024 * 1024 + 1), prefs), /limit/)
  assert.throws(() => parseCalendar(bytes(Array(1001).fill(event('DTSTART:20271101T100000Z')).join('\r\n')), prefs), /limit/)
})

test('ical round-trip preserves imported rules and native monthly clamp has equivalent RFC dates', async () => {
  const original = parseCalendar(bytes(event('DTSTART:20270131T090000Z\r\nRRULE:FREQ=MONTHLY;COUNT=4')), prefs).candidates[0]
  const item: any = { id: 'fixture', uid: original.uid, title: original.title, description: original.description, schedule: original.schedule,
    source: 'ical', icalSource: original.icalSource, state: 'active' }
  const round = parseCalendar(serializeCalendar([item]), prefs).candidates[0]
  assert.deepEqual(round.schedule, original.schedule)
  const native: any = { ...item, uid: 'native', source: 'jasper', icalSource: null, schedule: { policy: 'jasper', localDateTime: '2027-01-31T09:00:00', timeZone: 'UTC', recurrence: 'monthly', anchorDay: 31 } }
  const imported = parseCalendar(serializeCalendar([native]), prefs).candidates[0]
  const calendar = new ReminderCalendar()
  const next = async (after: string) => {
    for (;;) {
      try { return calendar.nextAfter(imported.schedule, after) }
      catch (error) {
        assert.equal((error as Error).message, 'recurrence_checkpoint_pending')
        await new Promise<void>(resolve => setImmediate(resolve))
      }
    }
  }
  assert.equal((await next('2027-02-01T00:00:00.000Z'))!.utc, '2027-02-28T09:00:00.000Z')
  assert.equal((await next('2027-03-01T00:00:00.000Z'))!.utc, '2027-03-31T09:00:00.000Z')
  assert.equal((await next('2028-02-01T00:00:00.000Z'))!.utc, '2028-02-29T09:00:00.000Z')
  assert.throws(() => serializeCalendar([{ ...native, schedule: { ...native.schedule, timeZone: 'America/New_York' } }]), /export/)
  assert.throws(() => serializeCalendar([{ ...native, state: 'completed' }]), /export/)
})

test('date UNTIL works for all-day recurrences and new defaults do not change source identity', () => {
  const data = bytes(event('DTSTART;VALUE=DATE:20271101\r\nRRULE:FREQ=DAILY;UNTIL=20271103'))
  const original = parseCalendar(data, prefs).candidates[0]
  const round = parseCalendar(serializeCalendar([{ ...original, id: 'fixture', source: 'ical', state: 'active' } as any]), prefs).candidates[0]
  assert.equal(round.icalSource.allDay, true)
  assert.deepEqual(round.schedule, original.schedule)
  const changedDefaults = parseCalendar(data, { ...prefs, allDayTime: '10:00', timeZone: 'Europe/Paris' }).candidates[0]
  assert.equal(original.sourceHash, changedDefaults.sourceHash)
  const calendar = new ReminderCalendar()
  assert.equal(calendar.nextAfter(original.schedule, '2027-11-03T00:00:00.000Z')!.utc, '2027-11-03T12:00:00.000Z')
  assert.equal(calendar.nextAfter(original.schedule, '2027-11-04T00:00:00.000Z'), null)
})

test('long recurrence expansion yields checkpoints instead of monopolizing Main and resumes deterministically', async () => {
  const calendar = new ReminderCalendar(1)
  const schedule: any = { policy: 'ical', localDateTime: '2020-01-01T09:00:00', timeZone: 'UTC', recurrence: 'daily', anchorDay: 1, icalRule: { rrule: 'FREQ=DAILY', exdates: [] } }
  let checkpoints = 0, result
  for (;;) {
    try { result = calendar.nextAfter(schedule, '2027-01-01T10:00:00.000Z'); break }
    catch (error) { assert.match(String(error), /recurrence_checkpoint_pending/); checkpoints++; await new Promise<void>(resolve => setImmediate(resolve)) }
  }
  assert.ok(checkpoints > 0)
  assert.equal(result!.utc, '2027-01-02T09:00:00.000Z')
  assert.deepEqual(calendar.nextAfter(schedule, '2027-01-01T10:00:00.000Z'), result)
})
