import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { StateDatabase } from '../src/main/storage/state-database'
import { TaskStore } from '../src/main/tasks/task-store'
import { TaskService } from '../src/main/tasks/task-service'
import { RemindersStore } from '../src/main/modules/reminders/store'
import { ReminderCalendar } from '../src/main/modules/reminders/calendar'
import { RemindersService } from '../src/main/modules/reminders/service'
import { ModuleRegistry } from '../src/main/modules/registry'

test('host reminder proof permits a dependent step and persists metadata without its title', async () => {
  const sql = ['001-module-state.sql', '002-capability-invocations.sql', '003-tasks.sql', '004-task-evidence.sql', '005-reminders.sql'].map(name => fs.readFileSync(`src/main/storage/migrations/${name}`, 'utf8'))
  const db = new StateDatabase(':memory:', sql[0], sql.slice(1))
  const registry = new ModuleRegistry(JSON.parse(fs.readFileSync('resources/modules/native-capabilities.json', 'utf8')))
  const reminderService = new RemindersService(new RemindersStore(db, new ReminderCalendar(), 'UTC'), registry, { authorize() {}, nowUtc: () => '2027-01-01T00:00:00.000Z' })
  const tasks = new TaskService(new TaskStore(db), { requireAccess() {}, sessionId: () => 1, sendCancel() {}, verifyCapability: (ctx, id, result) => reminderService.verify(ctx, id, result) })
  try {
    const task = tasks.open('chat', 1)
    tasks.event(task.taskId, 0, { type: 'planning', sequence: 1 }, 1)
    tasks.event(task.taskId, 1, { type: 'plan_ready', sequence: 2, stepIds: ['create', 'get'] }, 1)
    tasks.event(task.taskId, 2, { type: 'step_started', sequence: 3, stepId: 'create' }, 1)
    const ctx = { ...tasks.contextFor(task.taskId, 'create', 1), sessionId: 1, moduleRevision: 3 }
    const data: any = await reminderService.execute('reminder_create', { title: 'PRIVATE_FIXTURE_TITLE', schedule: { policy: 'jasper', localDateTime: '2027-01-31T09:00:00', timeZone: 'UTC', recurrence: 'none', anchorDay: 31 } }, ctx, new AbortController().signal)
    assert.equal(tasks.observe(task.taskId, 'create', 'reminder_create', { status: 'unknown', data, evidence: [] }, ctx).status, 'succeeded')
    tasks.event(task.taskId, 3, { type: 'step_finished', sequence: 4, stepId: 'create', status: 'succeeded' }, 1)
    tasks.event(task.taskId, 4, { type: 'step_started', sequence: 5, stepId: 'get' }, 1)
    const getCtx = { ...tasks.contextFor(task.taskId, 'get', 1), sessionId: 1, moduleRevision: 3 }
    const read = await reminderService.execute('reminder_get', { id: data.id }, getCtx, new AbortController().signal)
    tasks.observe(task.taskId, 'get', 'reminder_get', { status: 'unknown', data: read, evidence: [] }, getCtx)
    tasks.event(task.taskId, 5, { type: 'step_finished', sequence: 6, stepId: 'get', status: 'succeeded' }, 1)
    const done = tasks.event(task.taskId, 6, { type: 'finished', sequence: 7, status: 'succeeded' }, 1)
    assert.equal(done.status, 'succeeded'); assert.equal(done.evidence.length, 2)
    const history = db.transaction(tx => [tx.prepare('SELECT * FROM task_events').all(), tx.prepare('SELECT * FROM task_evidence').all()])
    assert.ok(!JSON.stringify(history).includes('PRIVATE_FIXTURE_TITLE'))
  } finally { db.close() }
})
