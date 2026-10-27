import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { StateDatabase } from '../src/main/storage/state-database'
import { RemindersStore } from '../src/main/modules/reminders/store'
import { ReminderCalendar } from '../src/main/modules/reminders/calendar'
import { ReminderScheduler } from '../src/main/modules/reminders/scheduler'

test('delivery claims survive reopening and two connections cannot claim the same occurrence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-delivery-'))
  const scripts = ['001-module-state.sql', '002-capability-invocations.sql', '003-tasks.sql', '004-task-evidence.sql', '005-reminders.sql'].map(n => fs.readFileSync(`src/main/storage/migrations/${n}`, 'utf8'))
  const open = () => new StateDatabase(path.join(dir, 'state.db'), scripts[0], scripts.slice(1))
  let a = open(), b = open()
  try {
    const first = new RemindersStore(a, new ReminderCalendar(), 'UTC')
    const second = new RemindersStore(b, new ReminderCalendar(), 'UTC')
    const item = first.mutate({ type: 'create', title: 'Synthetic', description: '', schedule: { policy: 'jasper', localDateTime: '2027-01-01T09:00:00', timeZone: 'UTC', recurrence: 'daily', anchorDay: 1 } }, { invocationId: 'create', nowUtc: '2027-01-01T00:00:00.000Z' }).items[0]
    const due = '2027-01-01T09:00:00.000Z'
    assert.equal(first.claimDue(due, 'first').length, 1)
    assert.equal(second.claimDue(due, 'second').length, 0)
    const key = first.occurrences(item.id)[0].key
    second.recoverDue('2027-01-01T09:00:01.000Z')
    assert.equal(first.canDeliver(key, 'first'), true, 'recovery cannot steal a live claim')
    assert.equal(second.pendingBatch(), null)
    assert.equal(first.markDelivery(key, 'wrong', 'shown'), false)
    assert.equal(first.markDelivery(key, 'first', 'shown'), true)
    assert.equal(first.getOccurrence(key, item.id)!.state, 'notified')
    assert.equal(first.get(item.id)!.nextDueUtc, '2027-01-02T09:00:00.000Z')
    first.mutate({ type: 'update', id: item.id, expectedRevision: 0, patch: { title: 'Edited synthetic' } }, { invocationId: 'title-edit', nowUtc: due })
    assert.equal(second.claimDue(due, 'after-title-edit').length, 0)
    first.mutate({ type: 'snooze', id: item.id, expectedRevision: 1, occurrenceKey: key, untilUtc: '2027-01-01T10:00:00.000Z' }, { invocationId: 'snooze', nowUtc: due })
    assert.equal(second.claimDue('2027-01-01T10:00:00.000Z', 'snoozed').length, 1)
    assert.equal(second.markDelivery(key, 'snoozed', 'shown'), true)
    a.close(); a = open()
    assert.equal(new RemindersStore(a, new ReminderCalendar(), 'UTC').claimDue(due, 'restart').length, 0)
    assert.equal(second.claimDue('2027-01-02T09:00:00.000Z', 'next').length, 1)
    assert.equal(second.expireClaims('2027-01-02T09:01:01.000Z'), 1)
    assert.equal(second.claimDue('2027-01-02T09:01:01.000Z', 'after-crash').length, 0)
    assert.equal(second.get(item.id)!.nextDueUtc, '2027-01-03T09:00:00.000Z')
  } finally { a.close(); b.close(); fs.rmSync(dir, { recursive: true, force: true }) }
})

test('authorization and schedule changes invalidate deferred notification callbacks', () => {
  const scripts = ['001-module-state.sql', '002-capability-invocations.sql', '003-tasks.sql', '004-task-evidence.sql', '005-reminders.sql'].map(n => fs.readFileSync(`src/main/storage/migrations/${n}`, 'utf8'))
  const db = new StateDatabase(':memory:', scripts[0], scripts.slice(1))
  const store = new RemindersStore(db, new ReminderCalendar(), 'UTC')
  let allowed = true, shows = 0, cancelled = 0
  const callbacks: Array<{ beforeShow(): boolean; shown(): void }> = []
  const scheduler = new ReminderScheduler(store, {
    allowed: () => allowed, nowUtc: () => '2027-01-01T09:00:00.000Z',
    notifier: { supported: () => true, prepare: (_item, hooks) => { callbacks.push(hooks); return { show: () => { if (hooks.beforeShow()) { shows++; hooks.shown() } }, cancel: () => { cancelled++ } } } },
    defer: fn => { queued.push(fn) }
  })
  const queued: Array<() => void> = []
  try {
    const item = store.mutate({ type: 'create', title: 'Synthetic', description: '', schedule: { policy: 'jasper', localDateTime: '2027-01-01T09:00:00', timeZone: 'UTC', recurrence: 'daily', anchorDay: 1 } }, { invocationId: 'create', nowUtc: '2027-01-01T00:00:00.000Z' }).items[0]
    scheduler.tick('2027-01-01T09:00:00.000Z')
    allowed = false
    queued.shift()!()
    assert.equal(shows, 0)
    allowed = true
    scheduler.tick('2027-01-02T09:00:00.000Z')
    store.mutate({ type: 'update', id: item.id, expectedRevision: 0, patch: { schedule: { ...item.schedule, policy: 'jasper', localDateTime: '2027-02-01T09:00:00', anchorDay: 1 } as any } }, { invocationId: 'edit', nowUtc: '2027-01-02T08:00:00.000Z' })
    queued.shift()!()
    assert.equal(shows, 0)
    scheduler.stop()
    assert.equal(callbacks.every(hooks => !hooks.beforeShow()), true)
    assert.ok(cancelled >= 2)
  } finally { scheduler.stop(); db.close() }
})

test('unsupported notifications and late OS callbacks never claim a successful delivery', () => {
  const scripts = ['001-module-state.sql', '002-capability-invocations.sql', '003-tasks.sql', '004-task-evidence.sql', '005-reminders.sql'].map(n => fs.readFileSync(`src/main/storage/migrations/${n}`, 'utf8'))
  const db = new StateDatabase(':memory:', scripts[0], scripts.slice(1))
  const store = new RemindersStore(db, new ReminderCalendar(), 'UTC')
  let supported = false, hooks: any, shows = 0, allowed = true
  const scheduler = new ReminderScheduler(store, { allowed: () => allowed, nowUtc: () => '2027-01-01T09:00:00.000Z', defer: fn => fn(), notifier: {
    supported: () => supported, prepare: (_item, value) => { hooks = value; return { show: () => { shows++ }, cancel: () => {} } }
  } })
  try {
    const create = (id: string) => store.mutate({ type: 'create', title: 'Synthetic', description: '', schedule: { policy: 'jasper', localDateTime: '2027-01-01T09:00:00', timeZone: 'UTC', recurrence: 'none', anchorDay: 1 } }, { invocationId: id, nowUtc: '2027-01-01T00:00:00.000Z' }).items[0]
    const unsupported = create('unsupported')
    scheduler.tick('2027-01-01T09:00:00.000Z')
    assert.equal(shows, 0)
    assert.equal(store.occurrences(unsupported.id)[0].state, 'missed')
    assert.equal(store.pendingBatch()!.total, 1, 'blocked delivery is summarized without restarting')
    supported = true
    const pending = create('pending')
    scheduler.tick('2027-01-01T09:00:00.000Z')
    assert.equal(shows, 1)
    allowed = false
    hooks.shown()
    assert.equal(store.occurrences(pending.id)[0].state, 'missed', 'late show after revocation is uncertain')
    scheduler.stop()
    hooks.shown()
    assert.equal(store.occurrences(pending.id)[0].state, 'missed')
    allowed = true
    scheduler.tick('2027-01-01T09:00:01.000Z')
    assert.equal(shows, 1)
  } finally { scheduler.stop(); db.close() }
})
