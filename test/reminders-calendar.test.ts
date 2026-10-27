import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ReminderCalendar } from '../src/main/modules/reminders/calendar'
const calendar = new ReminderCalendar()
const schedule = (localDateTime = '2027-01-31T09:00:00', timeZone = 'America/Sao_Paulo', recurrence = 'monthly'): any => ({ localDateTime, timeZone, recurrence, anchorDay: 31, policy: 'jasper' })

test('monthly calendar clamps short months without moving the anchor permanently', () => {
  const first = calendar.resolve(schedule())
  assert.equal(first.utc, '2027-01-31T12:00:00.000Z')
  const feb = calendar.nextAfter(schedule(), first.utc)!
  assert.equal(feb.nominalLocalTime, '2027-02-28T09:00:00')
  assert.equal(calendar.nextAfter(schedule(), feb.utc)!.nominalLocalTime, '2027-03-31T09:00:00')
  assert.equal(calendar.nextAfter(schedule('2028-01-31T09:00:00'), '2028-01-31T12:00:00.000Z')!.nominalLocalTime, '2028-02-29T09:00:00')
})

test('calendar resolves DST gap to first valid instant and fold to first occurrence', () => {
  const gap = calendar.resolve(schedule('2027-03-14T02:30:00', 'America/New_York', 'daily'))
  assert.deepEqual(gap, { utc: '2027-03-14T07:00:00.000Z', adjusted: true })
  assert.equal(calendar.nextAfter(schedule('2027-03-14T02:30:00', 'America/New_York', 'daily'), gap.utc)!.utc, '2027-03-15T06:30:00.000Z')
  const fold = calendar.resolve(schedule('2027-11-07T01:30:00', 'America/New_York', 'daily'))
  assert.equal(fold.utc, '2027-11-07T05:30:00.000Z')
  assert.equal(calendar.nextAfter(schedule('2027-11-07T01:30:00', 'America/New_York', 'daily'), fold.utc)!.utc, '2027-11-08T06:30:00.000Z')
})

test('calendar is independent of Windows TZ, accepts fractional offsets and rejects invalid civil input', () => {
  const original = process.env.TZ
  try {
    process.env.TZ = 'Pacific/Honolulu'
    assert.equal(calendar.resolve(schedule('2027-01-01T09:00:00', 'Asia/Kathmandu', 'none')).utc, '2027-01-01T03:15:00.000Z')
    process.env.TZ = 'Europe/Berlin'
    assert.equal(calendar.resolve(schedule()).utc, '2027-01-31T12:00:00.000Z')
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original }
  for (const value of [schedule('2027-02-30T09:00:00'), schedule('2027-01-31T25:00:00'), schedule(undefined, 'invalid/zone'), { ...schedule(), authorized: true }]) assert.throws(() => calendar.resolve(value))
})

test('imported RFC rule skips invalid month days instead of using native clamp', () => {
  const imported = { ...schedule(), policy: 'ical', icalRule: { rrule: 'FREQ=MONTHLY;BYMONTHDAY=31', exdates: [] } }
  assert.equal(calendar.nextAfter(imported, '2027-01-31T12:00:00.000Z')!.nominalLocalTime, '2027-03-31T09:00:00')
  imported.icalRule.exdates = ['2027-03-31T09:00:00']
  assert.equal(calendar.nextAfter(imported, '2027-01-31T12:00:00.000Z')!.nominalLocalTime, '2027-05-31T09:00:00')
})

test('imported UNTIL UTC is enforced after timezone conversion', () => {
  const imported = { ...schedule('2027-01-01T09:00:00', 'America/New_York', 'daily'), policy: 'ical', icalRule: { rrule: 'FREQ=DAILY;UNTIL=20270102T120000Z', exdates: [] } }
  assert.equal(calendar.nextAfter(imported as any, '2027-01-01T14:00:00.000Z'), null)
})

test('RFC COUNT excludes nonexistent DST times but still counts EXDATE exclusions', () => {
  const imported = { ...schedule('2027-03-13T02:30:00', 'America/New_York', 'daily'), policy: 'ical', icalRule: { rrule: 'FREQ=DAILY;COUNT=2', exdates: [] as string[] } }
  assert.equal(calendar.nextAfter(imported as any, '2027-03-13T07:30:00.000Z')!.utc, '2027-03-15T06:30:00.000Z')
  imported.icalRule.exdates = ['2027-03-15T02:30:00']
  assert.equal(calendar.nextAfter(imported as any, '2027-03-13T07:30:00.000Z'), null)
})
