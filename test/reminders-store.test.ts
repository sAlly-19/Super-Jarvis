import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { StateDatabase } from '../src/main/storage/state-database'
import { RemindersStore } from '../src/main/modules/reminders/store'
import { ReminderCalendar } from '../src/main/modules/reminders/calendar'

const names = ['001-module-state.sql', '002-capability-invocations.sql', '003-tasks.sql', '004-task-evidence.sql', '005-reminders.sql']
const sql = () => names.map(name => fs.readFileSync(`src/main/storage/migrations/${name}`, 'utf8'))
const context = (invocationId = 'fixture-create') => ({ invocationId, nowUtc: '2027-01-01T00:00:00.000Z' })
const create = (): any => ({ type: 'create', title: 'Fixture reminder', description: 'Synthetic', schedule: { localDateTime: '2027-01-31T09:00:00', timeZone: 'America/Sao_Paulo', recurrence: 'monthly', anchorDay: 31, policy: 'jasper' } })
function fixture() {
  const scripts = sql(), db = new StateDatabase(':memory:', scripts[0], scripts.slice(1))
  return { db, store: new RemindersStore(db, new ReminderCalendar(), 'UTC') }
}

test('same invocation has one effect and changed arguments cannot reuse its receipt', () => {
  const { db, store } = fixture()
  try {
    const first = store.mutate(create(), context())
    assert.equal(first.items[0].revision, 0)
    assert.deepEqual(store.mutate(create(), context()), first)
    assert.equal(store.list({ limit: 100 }).items.length, 1)
    assert.throws(() => store.mutate({ ...create(), title: 'changed' }, context()), /invocation_conflict/)
    assert.deepEqual(store.getReceipt(context().invocationId), first.receipt)
    assert.throws(() => store.mutate({ ...create(), verified: true }, context('invalid')))
  } finally { db.close() }
})

test('stale CAS and failed batches leave all rows unchanged; total target budget is enforced', () => {
  const { db, store } = fixture()
  try {
    const item = store.mutate(create(), context()).items[0]
    const edit: any = { type: 'update', id: item.id, expectedRevision: 0, patch: { title: 'Edited' } }
    const changed = store.mutate(edit, context('edit')).items[0]
    assert.equal(changed.scheduleRevision, item.scheduleRevision)
    assert.equal(changed.nextDueUtc, item.nextDueUtc)
    assert.throws(() => store.mutate(edit, context('stale')), /stale_reminder/)
    assert.throws(() => store.mutateBatch([create(), edit], context('batch')))
    assert.equal(store.list({ limit: 100 }).items.length, 1)
    assert.equal(store.getReceipt('batch'), null)
    assert.throws(() => store.mutateBatch(Array(101).fill(create()), context('too-many')))
    const many = Array(2).fill({ type: 'delete', items: Array(60).fill({ id: item.id, expectedRevision: 1 }) })
    assert.throws(() => store.mutateBatch(many, context('nested-budget')))
  } finally { db.close() }
})

test('snooze and complete affect one occurrence and keep future series alive', () => {
  const { db, store } = fixture()
  try {
    const item = store.mutate(create(), context()).items[0]
    const occurrence = store.occurrences(item.id)[0]
    const snoozed = store.mutate({ type: 'snooze', id: item.id, expectedRevision: 0, occurrenceKey: occurrence.key, untilUtc: '2027-03-02T12:00:00.000Z' }, context('snooze')).items[0]
    assert.equal(snoozed.scheduleRevision, 0)
    assert.equal(snoozed.nextDueUtc, '2027-02-28T12:00:00.000Z')
    assert.equal(store.occurrences(item.id).length, 2)
    assert.equal(store.nextOccurrence(item.id)!.nominalLocalTime, '2027-02-28T09:00:00')
    assert.equal(store.getOccurrence(occurrence.key, item.id)!.snoozedUntilUtc, '2027-03-02T12:00:00.000Z')
    const completed = store.mutate({ type: 'complete', id: item.id, expectedRevision: 1, occurrenceKey: occurrence.key }, context('complete')).items[0]
    assert.equal(completed.state, 'active')
    assert.equal(completed.nextDueUtc, '2027-02-28T12:00:00.000Z')
    const prefs = store.getPreferences()
    store.updatePreferences({ timeZone: 'Asia/Kathmandu', allDayTime: '10:00' }, prefs.revision)
    assert.equal(store.get(item.id)!.schedule.timeZone, 'America/Sao_Paulo')
  } finally { db.close() }
})

test('v4 upgrade preserves history and reminders survive a real reopen', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-reminders-'))
  const filename = path.join(root, 'state.sqlite'), scripts = sql()
  let db = new StateDatabase(filename, scripts[0], scripts.slice(1, 4))
  try {
    db.transaction(tx => tx.prepare("INSERT INTO tasks(task_id,origin,session_id,status,created_at,updated_at) VALUES('old','chat',1,'failed','2026-01-01','2026-01-01')").run())
    db.close(); db = new StateDatabase(filename, scripts[0], scripts.slice(1))
    const item = new RemindersStore(db, new ReminderCalendar(), 'UTC').mutate(create(), context()).items[0]
    const second = new StateDatabase(filename, scripts[0], scripts.slice(1))
    try {
      const other = new RemindersStore(second, new ReminderCalendar(), 'UTC')
      assert.equal(other.mutate(create(), context()).items[0].id, item.id)
      assert.equal(other.list({ limit: 100 }).items.length, 1)
    } finally { second.close() }
    db.close(); db = new StateDatabase(filename, scripts[0], scripts.slice(1))
    assert.equal(new RemindersStore(db, new ReminderCalendar(), 'UTC').get(item.id)!.title, item.title)
    assert.equal(db.transaction(tx => tx.prepare('SELECT COUNT(*) AS n FROM tasks').get()!.n), 1)
    assert.ok(fs.readdirSync(root).some(name => name.includes('.pre-v5.')))
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }) }
})

test('pagination, nonrecurring completion, deletion and preference CAS preserve domain state', () => {
  const { db, store } = fixture()
  try {
    const once = { ...create(), schedule: { ...create().schedule, recurrence: 'none' } }
    const a = store.mutate(once, context('one')).items[0]
    const b = store.mutate(create(), context('two')).items[0]
    const first = store.list({ limit: 1 })
    assert.ok(first.nextCursor)
    const next = store.list({ limit: 1, cursor: first.nextCursor! })
    assert.notEqual(first.items[0].id, next.items[0].id)
    assert.equal(next.nextCursor, null)
    const completed = store.mutate({ type: 'complete', id: a.id, expectedRevision: 0, occurrenceKey: store.occurrences(a.id)[0].key }, context('done')).items[0]
    assert.equal(completed.state, 'completed'); assert.equal(completed.nextDueUtc, null)
    assert.equal(store.list({ state: 'completed', limit: 100 }).items[0].id, a.id)
    store.mutate({ type: 'delete', items: [{ id: b.id, expectedRevision: 0 }] }, context('delete'))
    assert.equal(store.get(b.id)!.state, 'deleted')
    assert.equal(store.list({ limit: 100 }).items.length, 0)
    const before = store.getPreferences()
    store.updatePreferences({ allDayTime: '10:00', notificationsEnabled: false }, before.revision)
    assert.throws(() => store.updatePreferences({ allDayTime: '11:00' }, before.revision), /stale_preferences/)
    assert.equal(store.getPreferences().allDayTime, '10:00')
    assert.throws(() => store.list({ limit: 101 }))
    assert.throws(() => store.list({ limit: 1, cursor: 'bad' }))
  } finally { db.close() }
})
