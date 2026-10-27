import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { StateDatabase } from '../src/main/storage/state-database'
import { RemindersStore } from '../src/main/modules/reminders/store'
import { ReminderCalendar } from '../src/main/modules/reminders/calendar'
import { ReminderScheduler } from '../src/main/modules/reminders/scheduler'

test('missed occurrences form a persistent batch; acknowledgement does not complete reminders', () => {
  const scripts = ['001-module-state.sql', '002-capability-invocations.sql', '003-tasks.sql', '004-task-evidence.sql', '005-reminders.sql'].map(n => fs.readFileSync(`src/main/storage/migrations/${n}`, 'utf8'))
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-recovery-'))
  const open = () => new StateDatabase(path.join(dir, 'state.db'), scripts[0], scripts.slice(1))
  let db = open(), store = new RemindersStore(db, new ReminderCalendar(), 'UTC')
  try {
    const item = store.mutate({ type: 'create', title: 'Synthetic', description: '', schedule: { policy: 'jasper', localDateTime: '2027-01-01T09:00:00', timeZone: 'UTC', recurrence: 'daily', anchorDay: 1 } }, { invocationId: 'create', nowUtc: '2027-01-01T00:00:00.000Z' }).items[0]
    const now = '2027-06-01T10:00:00.000Z'
    store.claimDue('2027-01-01T09:00:00.000Z', 'crashed-process')
    while (store.recoverDue(now)) { /* bounded transactions, no notifications */ }
    const batch = store.pendingBatch()!
    assert.equal(batch.total, 152)
    assert.equal(batch.preview[0].reminderId, item.id)
    assert.equal(store.get(item.id)!.nextDueUtc, '2027-06-02T09:00:00.000Z')
    store.recoverDue(now)
    assert.equal(store.pendingBatch()!.batchId, batch.batchId)
    db.close(); db = open(); store = new RemindersStore(db, new ReminderCalendar(), 'UTC')
    assert.equal(store.pendingBatch()!.batchId, batch.batchId)
    store.acknowledgeBatch(batch.batchId, now)
    store.acknowledgeBatch(batch.batchId, now)
    assert.equal(store.pendingBatch(), null)
    assert.equal(store.get(item.id)!.state, 'active')
    assert.equal(store.occurrences(item.id)[0].state, 'missed')
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }) }
})

test('summary acknowledgement requires delivery to the current window and repeated recovery is serialized', async () => {
  const scripts = ['001-module-state.sql', '002-capability-invocations.sql', '003-tasks.sql', '004-task-evidence.sql', '005-reminders.sql'].map(n => fs.readFileSync(`src/main/storage/migrations/${n}`, 'utf8'))
  const db = new StateDatabase(':memory:', scripts[0], scripts.slice(1))
  const store = new RemindersStore(db, new ReminderCalendar(), 'UTC')
  let session: string | null = null, presented = 0, batchId = ''
  const scheduler = new ReminderScheduler(store, { allowed: () => true, nowUtc: () => '2027-01-01T10:00:00.000Z', notifier: { supported: () => false, prepare: () => { throw new Error('no real notifications') } }, presenter: {
    sessionId: () => session, present: batch => { presented++; batchId = batch.batchId; return true }
  } })
  try {
    store.mutate({ type: 'create', title: 'Synthetic', description: '', schedule: { policy: 'jasper', localDateTime: '2027-01-01T09:00:00', timeZone: 'UTC', recurrence: 'none', anchorDay: 1 } }, { invocationId: 'create', nowUtc: '2027-01-01T00:00:00.000Z' })
    await scheduler.recover('2027-01-01T10:00:00.000Z')
    const id = store.pendingBatch()!.batchId
    assert.equal(scheduler.acknowledgeBatch(id), false)
    session = 'window-1'
    await Promise.all([scheduler.recover('2027-01-01T10:00:00.000Z'), scheduler.recover('2027-01-01T10:00:00.000Z')])
    assert.equal(presented, 1)
    assert.equal(batchId, id)
    store.mutate({ type: 'create', title: 'Another synthetic', description: '', schedule: { policy: 'jasper', localDateTime: '2027-01-01T09:30:00', timeZone: 'UTC', recurrence: 'none', anchorDay: 1 } }, { invocationId: 'another', nowUtc: '2027-01-01T00:00:00.000Z' })
    await scheduler.recover('2027-01-01T10:00:00.000Z')
    assert.equal(presented, 2, 'changed summary is presented again in the same window')
    assert.equal(scheduler.acknowledgeBatch(id, 1), false, 'an older renderer version cannot acknowledge the latest batch')
    assert.equal(store.acknowledgeBatch(id, '2027-01-01T10:00:00.000Z', 1), false, 'stale total cannot acknowledge new members')
    scheduler.stop() // simulate loss before renderer acknowledgement
    session = 'window-2'
    assert.equal(scheduler.acknowledgeBatch(id), false)
    await scheduler.recover('2027-01-01T10:00:00.000Z')
    assert.equal(batchId, id)
    assert.equal(presented, 3)
    assert.equal(scheduler.acknowledgeBatch(id), true)
    assert.equal(scheduler.acknowledgeBatch(id), false)
    assert.equal(store.pendingBatch(), null)
  } finally { scheduler.stop(); db.close() }
})
