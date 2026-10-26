import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { StateDatabase } from '../src/main/storage/state-database'
import { TaskStore } from '../src/main/tasks/task-store'

const migrations = () => ['001-module-state.sql', '002-capability-invocations.sql', '003-tasks.sql'].map(name => fs.readFileSync(path.join(process.cwd(), 'src/main/storage/migrations', name), 'utf8'))
function database(filename: string) { const [first, ...rest] = migrations(); return new StateDatabase(filename, first, rest) }

test('task events use CAS, reject replay and persist only host-generated metadata', () => {
  const db = database(':memory:')
  try {
    const store = new TaskStore(db)
    const task = store.create('chat', 7)
    assert.equal(task.status, 'queued')
    const planning = store.appendEvent(task.taskId, 0, { type: 'planning', sequence: 1 })
    assert.equal(planning.status, 'planning')
    assert.equal(planning.revision, 1)
    assert.throws(() => store.appendEvent(task.taskId, 0, { type: 'planning', sequence: 1 }), /stale_task/)
    assert.throws(() => store.appendEvent(task.taskId, 1, { type: 'plan_ready', sequence: 3, stepIds: ['a'] }), /event_order/)
    const ready = store.appendEvent(task.taskId, 1, { type: 'plan_ready', sequence: 2, stepIds: ['a', 'b'] })
    assert.deepEqual(ready.stepStates, { a: 'pending', b: 'pending' })
    assert.throws(() => store.appendEvent(task.taskId, 2, { type: 'finished', sequence: 3, status: 'succeeded' }), /unverified_task/)
    assert.throws(() => store.appendEvent(task.taskId, 2, { type: 'planning', sequence: 3, summary: 'secret command' } as any), /invalid_task_event/)
    assert.equal(store.get(task.taskId)!.revision, 2)
    assert.equal(store.listActive().length, 1)
    assert.equal(JSON.stringify(db.transaction(tx => tx.prepare('SELECT * FROM task_events').all())).includes('secret command'), false)
  } finally { db.close() }
})

test('restart never replays tasks and conservatively preserves uncertain effects', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-tasks-'))
  const filename = path.join(root, 'state.sqlite')
  let db = database(filename)
  try {
    let store = new TaskStore(db)
    const before = store.create('chat', 9)
    const during = store.create('live', 9)
    store.appendEvent(during.taskId, 0, { type: 'planning', sequence: 1 })
    store.appendEvent(during.taskId, 1, { type: 'plan_ready', sequence: 2, stepIds: ['step'] })
    store.appendEvent(during.taskId, 2, { type: 'step_started', sequence: 3, stepId: 'step' })
    db.close()
    db = database(filename)
    store = new TaskStore(db)
    store.markInterrupted(9)
    assert.equal(store.get(before.taskId)!.status, 'interrupted')
    assert.equal(store.get(during.taskId)!.status, 'unknown')
    assert.equal(store.get(during.taskId)!.stepStates.step, 'unknown')
    assert.equal(store.listActive().length, 0)
    const revision = store.get(during.taskId)!.revision
    store.markInterrupted(9)
    assert.equal(store.get(during.taskId)!.revision, revision)
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }) }
})
