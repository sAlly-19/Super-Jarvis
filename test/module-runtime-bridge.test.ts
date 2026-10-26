import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ModuleRuntimeBridge } from '../src/main/modules/runtime-bridge'
import { ModuleRegistry } from '../src/main/modules/registry'
import { ModulePolicy } from '../src/main/modules/policy'
import { InvocationStore } from '../src/main/modules/invocation-store'
import { StateDatabase } from '../src/main/storage/state-database'
import type { BackendEnvelope } from '../src/shared/types/backend-protocol'

test('runtime bridge requires negotiated snapshot and blocks tools after module disable or stale session', async () => {
  const sql = (name: string) => fs.readFileSync(path.join(process.cwd(), 'src/main/storage/migrations', name), 'utf8')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-bridge-'))
  const db = new StateDatabase(path.join(root, 'state.sqlite'), sql('001-module-state.sql'), [sql('002-capability-invocations.sql')])
  try {
    const registry = new ModuleRegistry(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'resources/modules/native-capabilities.json'), 'utf8')))
    let enabled = true
    let session = 2
    let executions = 0
    const responses: Array<{ type: string; payload: any }> = []
    const policy = new ModulePolicy(registry, { requireAgentAccess() {}, getSessionId: () => session,
      getSnapshot: () => ({ id: 'computer', enabled, configured: true, authorized: true, health: 'healthy', lifecycle: 'running', revision: 0 }),
      getPermissions: () => ['computer.shell'] })
    const bridge = new ModuleRuntimeBridge(registry, policy, new InvocationStore(db), {
      getSessionId: () => session,
      notify: (type, payload) => responses.push({ type, payload }),
      request: async (type, payload: any) => {
        if (type === 'module_snapshot') return { moduleRuntimeVersion: 1, snapshotVersion: payload.snapshotVersion }
        executions++
        return { context: payload.context, result: { status: 'unknown', data: 'done', evidence: [] } }
      }
    }, () => 0)
    const request = (snapshotVersion: number): BackendEnvelope => ({ version: 1, id: 'frame', type: 'capability_request', payload: {
      requestId: `request-${responses.length}`, snapshotVersion, capabilityId: 'run_powershell', args: { command: 'Get-Date' }
    } })
    await bridge.handle(request(0), session)
    assert.equal(executions, 0)
    await assert.rejects(bridge.negotiate({}, session), /incompatible/)
    const snapshotVersion = await bridge.negotiate({ moduleRuntimeVersion: 1 }, session)
    await bridge.handle(request(snapshotVersion), session)
    assert.equal(executions, 1)
    assert.equal(responses.at(-1)!.payload.result.data, 'done')
    enabled = false
    await bridge.handle(request(snapshotVersion), session)
    assert.equal(executions, 1)
    session++
    await bridge.handle(request(snapshotVersion), session - 1)
    assert.equal(executions, 1)
    assert.equal(responses.at(-1)!.payload.result.data, undefined)
    await bridge.close()
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }) }
})
