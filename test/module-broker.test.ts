import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { ExecutionBroker } from '../src/main/modules/execution-broker'
import { ModuleRegistry } from '../src/main/modules/registry'
import { ModulePolicy } from '../src/main/modules/policy'
import { StateDatabase } from '../src/main/storage/state-database'
import { InvocationStore } from '../src/main/modules/invocation-store'

function invocations(t: TestContext): InvocationStore {
  const sql = (name: string) => fs.readFileSync(path.join(process.cwd(), 'src/main/storage/migrations', name), 'utf8')
  const db = new StateDatabase(':memory:', sql('001-module-state.sql'), [sql('002-capability-invocations.sql')])
  t.after(() => db.close())
  return new InvocationStore(db)
}

test('disabling computer blocks every computer capability before worker dispatch', async t => {
  const registry = new ModuleRegistry(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'resources/modules/native-capabilities.json'), 'utf8')))
  let calls = 0
  const policy = new ModulePolicy(registry, {
    requireAgentAccess() {}, getSessionId: () => 1,
    getSnapshot: () => ({ id: 'computer', enabled: false, configured: true, authorized: true, health: 'healthy', lifecycle: 'running', revision: 1 }),
    getPermissions: () => registry.list().flatMap(capability => capability.permissions)
  })
  const broker = new ExecutionBroker(registry, policy, async () => { calls++; return 'unexpected' }, invocations(t))
  const args: Record<string, unknown> = {
    run_powershell: { command: 'Get-Date' }, get_system_telemetry: {},
    gui_action: { action: 'move', x: 0, y: 0 }, control_system_volume: { action: 'mute' }, capture_screen_base64: {}
  }
  for (const capability of registry.list().filter(capability => capability.moduleId === 'computer')) {
    const result = await broker.invoke(capability.id, args[capability.id], {
      taskId: 'acceptance', stepId: capability.id, invocationId: capability.id, sessionId: 1, moduleRevision: 1
    })
    assert.equal(result.status, 'failed', capability.id)
    assert.equal(result.errorCode, 'module_unavailable', capability.id)
  }
  assert.equal(calls, 0)
})

test('broker rejects invalid and denied calls, suppresses duplicate effects and stale results', async t => {
  const registry = new ModuleRegistry(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'resources/modules/native-capabilities.json'), 'utf8')))
  let allowed = true
  let revision = 0
  let calls = 0
  const policy = new ModulePolicy(registry, { requireAgentAccess: () => { if (!allowed) throw new Error('locked') },
    getSnapshot: () => ({ id: 'computer', enabled: true, configured: true, authorized: true, health: 'healthy', lifecycle: 'running', revision }),
    getSessionId: () => 1, getPermissions: () => ['computer.shell'] })
  const context = { taskId: 't', stepId: 's', invocationId: 'i', sessionId: 1, moduleRevision: 0 }
  let release!: (value: unknown) => void
  const broker = new ExecutionBroker(registry, policy, async (_id, _args, _context, signal) => {
    calls++
    assert.equal(signal.aborted, false)
    return new Promise(resolve => { release = resolve })
  }, invocations(t))
  allowed = false
  assert.equal((await broker.invoke('run_powershell', { command: 'test' }, context)).status, 'failed')
  allowed = true
  assert.equal((await broker.invoke('run_powershell', { command: 3 }, context)).status, 'failed')
  assert.equal(calls, 0)
  const running = broker.invoke('run_powershell', { command: 'test' }, context)
  assert.equal((await broker.invoke('run_powershell', { command: 'test' }, context)).errorCode, 'duplicate_invocation')
  revision++
  release('possibly completed')
  assert.equal((await running).status, 'unknown')
  assert.equal(calls, 1)
})

test('broker cancellation reaches executor and waits for cleanup', async t => {
  const registry = new ModuleRegistry(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'resources/modules/native-capabilities.json'), 'utf8')))
  const policy = new ModulePolicy(registry, { requireAgentAccess() {}, getSnapshot: () => ({ id: 'computer', enabled: true, configured: true, authorized: true, health: 'healthy', lifecycle: 'running', revision: 0 }), getSessionId: () => 1, getPermissions: () => ['computer.shell'] })
  let cleaned = false
  const broker = new ExecutionBroker(registry, policy, async (_id, _args, _context, signal) => {
    await new Promise<void>(resolve => signal.addEventListener('abort', () => { cleaned = true; resolve() }, { once: true }))
    throw new Error('aborted')
  }, invocations(t))
  const running = broker.invoke('run_powershell', { command: 'test' }, { taskId: 't', stepId: 's', invocationId: 'cancel-me', sessionId: 1, moduleRevision: 0 })
  await broker.stopModule('computer')
  assert.equal(cleaned, true)
  assert.equal((await running).status, 'unknown')
})
