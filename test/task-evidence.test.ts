import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { StateDatabase } from '../src/main/storage/state-database'
import { TaskStore } from '../src/main/tasks/task-store'

test('evidence and step transition commit atomically, redact raw data and survive reload', () => {
  const sql = ['001-module-state.sql', '002-capability-invocations.sql', '003-tasks.sql', '004-task-evidence.sql'].map(name => fs.readFileSync(`src/main/storage/migrations/${name}`, 'utf8'))
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-evidence-'))
  const filename = path.join(root, 'state.sqlite')
  const db = new StateDatabase(filename, sql[0], sql.slice(1))
  try {
    const store = new TaskStore(db), task = store.create('chat', 1)
    store.appendEvent(task.taskId, 0, { type: 'planning', sequence: 1 })
    store.appendEvent(task.taskId, 1, { type: 'plan_ready', sequence: 2, stepIds: ['a'] })
    store.appendEvent(task.taskId, 2, { type: 'step_started', sequence: 3, stepId: 'a' })
    const evidence = { stepId: 'a', invocationId: 'host-invocation', kind: 'path_observed', reference: 'opaque', observedAt: new Date().toISOString(), verified: true }
    db.transaction(tx => tx.exec("CREATE TRIGGER fail_proof BEFORE INSERT ON task_evidence BEGIN SELECT RAISE(ABORT, 'fixture_failure'); END"))
    assert.throws(() => store.appendEvent(task.taskId, 3, { type: 'step_finished', sequence: 4, stepId: 'a', status: 'succeeded' }, true, [evidence]))
    assert.equal(store.get(task.taskId)!.revision, 3)
    db.transaction(tx => tx.exec('DROP TRIGGER fail_proof'))
    store.appendEvent(task.taskId, 3, { type: 'step_finished', sequence: 4, stepId: 'a', status: 'succeeded' }, true, [evidence])
    assert.deepEqual(new TaskStore(db).get(task.taskId)!.evidence, [evidence])
    assert.throws(() => store.appendEvent(task.taskId, 4, { type: 'finished', sequence: 5, status: 'succeeded' }, true, [{ ...evidence, path: 'PRIVATE' } as any]))
    const columns = db.transaction(tx => tx.prepare('PRAGMA table_info(task_evidence)').all()).map(row => row.name)
    assert.ok(!columns.includes('path') && !columns.includes('args') && !columns.includes('data'))
    db.close()
    const reopened = new StateDatabase(filename, sql[0], sql.slice(1))
    try {
      const recovered = new TaskStore(reopened)
      recovered.markInterrupted()
      assert.deepEqual(recovered.get(task.taskId)!.evidence, [evidence])
      assert.equal(recovered.get(task.taskId)!.status, 'interrupted')
    } finally { reopened.close() }
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }) }
})
