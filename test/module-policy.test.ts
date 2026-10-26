import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ModulePolicy } from '../src/main/modules/policy'
import { ModuleRegistry } from '../src/main/modules/registry'
import fs from 'node:fs'
import path from 'node:path'

test('policy checks current license, consent, module, permission, session and revision on every invocation', () => {
  const registry = new ModuleRegistry(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'resources/modules/native-capabilities.json'), 'utf8')))
  let access = true
  let session = 3
  const state = { id: 'computer' as const, enabled: true, configured: true, authorized: true,
    health: 'healthy' as const, lifecycle: 'running' as const, revision: 1 }
  let permissions = ['computer.shell']
  const policy = new ModulePolicy(registry, {
    requireAgentAccess() { if (!access) throw new Error('private detail') },
    getSnapshot: () => state, getSessionId: () => session, getPermissions: () => permissions
  })
  const context = { taskId: 't1', stepId: 's1', invocationId: 'i1', sessionId: 3, moduleRevision: 1 }
  assert.deepEqual(policy.authorize('run_powershell', context), { allowed: true })
  for (const key of ['enabled', 'configured', 'authorized'] as const) {
    state[key] = false
    assert.equal(policy.authorize('run_powershell', context).allowed, false)
    state[key] = true
  }
  permissions = []
  assert.equal(policy.authorize('run_powershell', context).allowed, false)
  permissions = ['computer.shell']
  session = 4
  assert.equal(policy.authorize('run_powershell', context).allowed, false)
  session = 3
  state.revision++
  assert.equal(policy.authorize('run_powershell', context).allowed, false)
  state.revision--
  access = false
  assert.equal(policy.authorize('run_powershell', context).allowed, false)
  assert.equal(policy.authorize('missing', context).allowed, false)
})
