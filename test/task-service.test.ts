import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { StateDatabase } from '../src/main/storage/state-database'
import { TaskStore } from '../src/main/tasks/task-store'
import { TaskService } from '../src/main/tasks/task-service'

test('task service binds stable invocations and only host-observed telemetry can verify a step', () => {
  const sql = ['001-module-state.sql', '002-capability-invocations.sql', '003-tasks.sql'].map(name => fs.readFileSync(path.join(process.cwd(), 'src/main/storage/migrations', name), 'utf8'))
  const db = new StateDatabase(':memory:', sql[0], sql.slice(1))
  try {
    let access = true
    const changed: any[] = []
    const service = new TaskService(new TaskStore(db), { requireAccess() { if (!access) throw new Error('locked') }, sessionId: () => 1, sendCancel() {}, changed: task => changed.push(task) })
    const task = service.open('chat', 1)
    service.event(task.taskId, 0, { type: 'planning', sequence: 1 }, 1)
    service.event(task.taskId, 1, { type: 'plan_ready', sequence: 2, stepIds: ['a'] }, 1)
    service.event(task.taskId, 2, { type: 'step_started', sequence: 3, stepId: 'a' }, 1)
    const context = service.contextFor(task.taskId, 'a', 1)
    assert.equal(service.contextFor(task.taskId, 'a', 1).invocationId, context.invocationId)
    assert.throws(() => service.contextFor(task.taskId, 'a', 2), /stale_task_session/)
    assert.throws(() => service.event(task.taskId, 3, { type: 'step_finished', sequence: 4, stepId: 'a', status: 'succeeded' } as any, 1), /unverified_step/)
    service.observe(task.taskId, 'a', 'run_powershell', { status: 'unknown', evidence: [], data: 'exit 0' })
    assert.throws(() => service.event(task.taskId, 3, { type: 'step_finished', sequence: 4, stepId: 'a', status: 'succeeded' } as any, 1), /unverified_step/)
    const observation = service.observe(task.taskId, 'a', 'get_system_telemetry', { status: 'unknown', evidence: [], data: JSON.stringify({ status: 'ok', cpu_percent: 15, ram: { percent: 50 }, disk_c: { percent: 25 } }) })
    assert.equal(observation.status, 'succeeded')
    service.event(task.taskId, 3, { type: 'step_finished', sequence: 4, stepId: 'a', status: 'succeeded' } as any, 1)
    const done = service.event(task.taskId, 4, { type: 'finished', sequence: 5, status: 'succeeded' }, 1)
    assert.equal(done.status, 'succeeded')
    const interrupted = service.open('chat', 1)
    service.interruptSession(1)
    assert.equal(changed.at(-1).taskId, interrupted.taskId)
    assert.equal(changed.at(-1).status, 'interrupted')
    access = false
    assert.throws(() => service.list(), /locked/)
  } finally { db.close() }
})
