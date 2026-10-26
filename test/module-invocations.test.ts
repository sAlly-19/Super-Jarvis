import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { StateDatabase } from '../src/main/storage/state-database'
import { InvocationStore } from '../src/main/modules/invocation-store'
import { ExecutionBroker } from '../src/main/modules/execution-broker'
import { ModuleRegistry } from '../src/main/modules/registry'
import { ModulePolicy } from '../src/main/modules/policy'

const sql = (name: string) => fs.readFileSync(path.join(process.cwd(), 'src/main/storage/migrations', name), 'utf8')
const context = { taskId: 'task', stepId: 'step', invocationId: 'stable-id', sessionId: 1, moduleRevision: 0 }

test('durable reservation survives reopen and session change without repeating an effect', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-invocations-'))
  const filename = path.join(root, 'state.sqlite')
  let db: StateDatabase | undefined
  try {
    // Start from the existing v1 schema with data, then migrate without erasing it.
    db = new StateDatabase(filename, sql('001-module-state.sql'))
    db.transaction(tx => tx.exec("INSERT INTO module_events(module_id, revision, outcome) VALUES ('computer', 0, 'started')"))
    db.close()
    db = new StateDatabase(filename, sql('001-module-state.sql'), [sql('002-capability-invocations.sql')])
    assert.equal(db.transaction(tx => tx.prepare('SELECT COUNT(*) AS n FROM module_events').get()!.n), 1)
    assert.ok(fs.readdirSync(root).some(name => name.startsWith('state.sqlite.pre-v2.')))
    let session = 1
    let effects = 0
    const registry = new ModuleRegistry(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'resources/modules/native-capabilities.json'), 'utf8')))
    const policy = new ModulePolicy(registry, { requireAgentAccess() {},
      getSnapshot: () => ({ id: 'computer', enabled: true, configured: true, authorized: true, health: 'healthy', lifecycle: 'running', revision: 0 }),
      getSessionId: () => session, getPermissions: () => ['computer.shell'] })
    let store = new InvocationStore(db)
    let broker = new ExecutionBroker(registry, policy, async () => { effects++; return 'done' }, store)
    await broker.invoke('run_powershell', { command: 'test' }, context)
    db.close()
    db = new StateDatabase(filename, sql('001-module-state.sql'), [sql('002-capability-invocations.sql')])
    store = new InvocationStore(db)
    session = 2
    broker = new ExecutionBroker(registry, policy, async () => { effects++; return 'done' }, store)
    assert.equal((await broker.invoke('run_powershell', { command: 'test' }, { ...context, sessionId: 2 })).errorCode, 'duplicate_invocation')
    assert.equal(effects, 1)
    assert.equal(store.reserve('run_powershell', { ...context, invocationId: 'crash-after-reserve' }), true)
    db.close()
    db = new StateDatabase(filename, sql('001-module-state.sql'), [sql('002-capability-invocations.sql')])
    store = new InvocationStore(db)
    assert.equal(store.reserve('run_powershell', { ...context, invocationId: 'crash-after-reserve', sessionId: 2 }), false)
  } finally { db?.close(); fs.rmSync(root, { recursive: true, force: true }) }
})

test('independent connections cannot reserve the same ID and failed migration preserves v1 data', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-invocation-connections-'))
  const filename = path.join(root, 'state.sqlite')
  let one: StateDatabase | undefined
  let two: StateDatabase | undefined
  try {
    one = new StateDatabase(filename, sql('001-module-state.sql'))
    one.transaction(tx => tx.exec("INSERT INTO module_events(module_id, revision, outcome) VALUES ('computer', 4, 'stopped')"))
    one.close()
    assert.throws(() => new StateDatabase(filename, sql('001-module-state.sql'), ['CREATE TABLE partial_migration(id INTEGER); INVALID SQL;']))
    one = new StateDatabase(filename, sql('001-module-state.sql'))
    assert.equal(one.transaction(tx => tx.prepare('SELECT revision FROM module_events').get()!.revision), 4)
    assert.equal(one.transaction(tx => tx.prepare("SELECT name FROM sqlite_master WHERE name='partial_migration'").get()), undefined)
    one.close()
    one = new StateDatabase(filename, sql('001-module-state.sql'), [sql('002-capability-invocations.sql')])
    two = new StateDatabase(filename, sql('001-module-state.sql'), [sql('002-capability-invocations.sql')])
    assert.equal(new InvocationStore(one).reserve('run_powershell', context), true)
    assert.equal(new InvocationStore(two).reserve('run_powershell', context), false)
    const row = two.transaction(tx => tx.prepare('SELECT * FROM capability_invocations').get()!)
    assert.deepEqual(Object.keys(row).sort(), ['capability_id', 'invocation_id', 'module_revision', 'reserved_at', 'session_id', 'step_id', 'task_id'])
    assert.throws(() => new StateDatabase(filename, sql('001-module-state.sql')), /unsupported_database_version/)
  } finally { one?.close(); two?.close(); fs.rmSync(root, { recursive: true, force: true }) }
})

test('brokers share atomic reservation and accept more than 10000 distinct invocation IDs', async () => {
  const db = new StateDatabase(':memory:', sql('001-module-state.sql'), [sql('002-capability-invocations.sql')])
  try {
    const registry = new ModuleRegistry(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'resources/modules/native-capabilities.json'), 'utf8')))
    const policy = new ModulePolicy(registry, { requireAgentAccess() {},
      getSnapshot: () => ({ id: 'computer', enabled: true, configured: true, authorized: true, health: 'healthy', lifecycle: 'running', revision: 0 }),
      getSessionId: () => 1, getPermissions: () => ['computer.shell'] })
    let effects = 0
    const executor = async () => { effects++; return 'done' }
    const one = new ExecutionBroker(registry, policy, executor, new InvocationStore(db))
    const two = new ExecutionBroker(registry, policy, executor, new InvocationStore(db))
    const results = await Promise.all([one.invoke('run_powershell', { command: 'test' }, context), two.invoke('run_powershell', { command: 'test' }, context)])
    assert.equal(results.filter(result => result.errorCode === 'duplicate_invocation').length, 1)
    assert.equal(effects, 1)
    for (let i = 0; i < 10001; i++) {
      const result = await one.invoke('run_powershell', { command: 'test' }, { ...context, invocationId: `unique-${i}` })
      assert.notEqual(result.status, 'failed')
    }
    assert.equal(effects, 10002)
    db.close()
    const failed = await one.invoke('run_powershell', { command: 'test' }, { ...context, invocationId: 'storage-unavailable' })
    assert.equal(failed.errorCode, 'invocation_store_unavailable')
    assert.equal(effects, 10002)
  } finally { db.close() }
})
