import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { StateDatabase } from '../src/main/storage/state-database'
import { ModuleRegistry } from '../src/main/modules/registry'
import { RemindersStore } from '../src/main/modules/reminders/store'
import { ReminderCalendar } from '../src/main/modules/reminders/calendar'
import { RemindersService } from '../src/main/modules/reminders/service'
import type { ExecutionContext } from '../src/shared/types/modules'

const args = () => ({ title: 'Synthetic task', description: 'Fixture only', schedule: { policy: 'jasper', localDateTime: '2027-01-31T09:00:00', timeZone: 'UTC', recurrence: 'monthly', anchorDay: 31 } })
const context = (id: string): ExecutionContext => ({ invocationId: id, taskId: 'task', stepId: id, sessionId: 1, moduleRevision: 3 })
function fixture() {
  const sql = ['001-module-state.sql', '002-capability-invocations.sql', '003-tasks.sql', '004-task-evidence.sql', '005-reminders.sql'].map(name => fs.readFileSync(`src/main/storage/migrations/${name}`, 'utf8'))
  const db = new StateDatabase(':memory:', sql[0], sql.slice(1))
  const registry = new ModuleRegistry(JSON.parse(fs.readFileSync('resources/modules/native-capabilities.json', 'utf8')))
  const store = new RemindersStore(db, new ReminderCalendar(), 'UTC')
  let access = true
  const service = new RemindersService(store, registry, { nowUtc: () => '2027-01-01T00:00:00.000Z', authorize: (_id, ctx) => { if (!access || ctx.moduleRevision !== 3 || ctx.sessionId !== 1) throw new Error('denied') } })
  return { db, service, store, deny: () => { access = false } }
}
const unknown = (data: unknown): any => ({ status: 'unknown', data, evidence: [] })

test('Main reminders tools perform CRUD with host proofs, explicit occurrence and no forged verification', async () => {
  const { db, service, store } = fixture()
  const signal = new AbortController().signal
  try {
    const created: any = await service.execute('reminder_create', args(), context('create'), signal)
    assert.ok(created.id)
    const forged = structuredClone(created); forged.items[0].title = 'not observed'
    assert.equal(service.verify(context('create'), 'reminder_create', unknown(forged)).status, 'unknown')
    assert.equal(service.verify(context('wrong'), 'reminder_create', unknown(created)).status, 'unknown')
    const proof = service.verify(context('create'), 'reminder_create', unknown(created))
    assert.equal(proof.status, 'succeeded'); assert.equal(proof.evidence[0].kind, 'reminder_write')
    const read: any = await service.execute('reminder_get', { id: created.id }, context('get'), signal)
    assert.equal(read.items[0].title, args().title)
    assert.equal(service.verify(context('get'), 'reminder_get', unknown(read)).evidence[0].kind, 'reminder_read')
    const changed: any = await service.execute('reminder_update', { id: created.id, expectedRevision: 0, patch: { title: 'Edited' } }, context('edit'), signal)
    await assert.rejects(service.execute('reminder_update', { id: created.id, expectedRevision: 0, patch: { title: 'Stale' } }, context('stale'), signal))
    const postponed: any = await service.execute('reminder_snooze', { id: created.id, expectedRevision: changed.revision, occurrenceKey: created.occurrenceKey, untilUtc: '2027-03-02T09:00:00.000Z' }, context('snooze'), signal)
    assert.equal(postponed.occurrenceKey, created.occurrenceKey)
    assert.equal(postponed.affectedOccurrence.snoozedUntilUtc, '2027-03-02T09:00:00.000Z')
    assert.equal(postponed.items[0].nextDueUtc, '2027-02-28T09:00:00.000Z')
    await service.execute('reminder_complete', { id: created.id, expectedRevision: 2, occurrenceKey: created.occurrenceKey }, context('complete'), signal)
    await service.execute('reminder_delete', { items: [{ id: created.id, expectedRevision: 3 }] }, context('delete'), signal)
    const empty: any = await service.execute('reminder_list', { limit: 100 }, context('list'), signal)
    assert.deepEqual(empty.items, [])
    assert.equal(service.verify(context('list'), 'reminder_list', unknown(empty)).status, 'succeeded')
    assert.equal(store.get(created.id)!.state, 'deleted')
    service.releaseObservation('create')
    assert.equal(service.verify(context('create'), 'reminder_create', unknown(created)).status, 'unknown')
  } finally { db.close() }
})

test('cancelled, denied, stale and injected requests cannot commit; invalid delete batch rolls back', async () => {
  const { db, service, store, deny } = fixture()
  const controller = new AbortController()
  try {
    controller.abort()
    await assert.rejects(service.execute('reminder_create', args(), context('cancel'), controller.signal))
    assert.equal(store.list({ limit: 100 }).items.length, 0)
    const signal = new AbortController().signal
    await assert.rejects(service.execute('reminder_create', { ...args(), verified: true }, context('injected'), signal))
    await assert.rejects(service.execute('reminder_create', args(), { ...context('stale'), moduleRevision: 2 }, signal))
    const created: any = await service.execute('reminder_create', args(), context('valid'), signal)
    await assert.rejects(service.execute('reminder_create', { ...args(), title: 'changed' }, context('valid'), signal))
    await assert.rejects(service.execute('reminder_delete', { items: [{ id: created.id, expectedRevision: 0 }, { id: '00000000-0000-0000-0000-000000000001', expectedRevision: 0 }] }, context('batch'), signal))
    assert.equal(store.get(created.id)!.state, 'active')
    deny()
    assert.equal(service.verify(context('valid'), 'reminder_create', unknown(created)).status, 'unknown')
    await assert.rejects(service.execute('reminder_create', args(), context('denied'), signal))
    assert.equal(store.list({ limit: 100 }).items.length, 1)
  } finally { db.close() }
})
