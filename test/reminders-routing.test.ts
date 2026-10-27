import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { StateDatabase } from '../src/main/storage/state-database'
import { ModuleRegistry } from '../src/main/modules/registry'
import { ModulePolicy } from '../src/main/modules/policy'
import { InvocationStore } from '../src/main/modules/invocation-store'
import { ModuleRuntimeBridge } from '../src/main/modules/runtime-bridge'
import type { BackendEnvelope } from '../src/shared/types/backend-protocol'

test('host routing uses each module revision and a reminder update preserves a running computer worker', async () => {
  const entries = JSON.parse(fs.readFileSync('resources/modules/native-capabilities.json', 'utf8'))
  entries.push({ ...entries[0], id: 'reminder_fixture', moduleId: 'reminders', permissions: ['reminders.read'], inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false }, outputSchema: { type: 'object' } })
  const registry = new ModuleRegistry(entries)
  const sql = ['001-module-state.sql', '002-capability-invocations.sql'].map(name => fs.readFileSync(`src/main/storage/migrations/${name}`, 'utf8'))
  const db = new StateDatabase(':memory:', sql[0], sql.slice(1))
  let computerEnabled = true, remindersEnabled = true, reminderRevision = 7, hostCalls = 0, sidecarCalls = 0, release!: () => void
  const responses: any[] = [], snapshots: any[] = []
  const policy = new ModulePolicy(registry, { requireAgentAccess() {}, getSessionId: () => 1,
    getSnapshot: id => ({ id, enabled: id === 'computer' ? computerEnabled : remindersEnabled, configured: true, authorized: true, health: 'healthy', lifecycle: 'running', revision: id === 'reminders' ? reminderRevision : 2 }),
    getPermissions: id => registry.list().filter(cap => cap.moduleId === id).flatMap(cap => cap.permissions) })
  const bridge = new ModuleRuntimeBridge(registry, policy, new InvocationStore(db), {
    getSessionId: () => 1, notify: (type, payload) => responses.push({ type, payload }),
    request: async (type, payload: any) => {
      if (type === 'module_snapshot') { snapshots.push(payload); return { moduleRuntimeVersion: 1, snapshotVersion: payload.snapshotVersion } }
      sidecarCalls++
      await new Promise<void>(resolve => { release = resolve })
      return { context: payload.context, result: { status: 'unknown', data: 'fixture-computer', evidence: [] } }
    }
  }, id => id === 'reminders' ? reminderRevision : 2, undefined, { reminders: async (_id, _args, context) => { hostCalls++; assert.equal(context.moduleRevision, reminderRevision); return { id: 'fixture-reminder' } } })
  const frame = (version: number, id: string, capabilityId: string, args = {}): BackendEnvelope => ({ version: 1, id, type: 'capability_request', payload: { requestId: id, snapshotVersion: version, capabilityId, args } })
  try {
    const version = await bridge.negotiate({ moduleRuntimeVersion: 1 }, 1)
    assert.ok(snapshots[0].capabilities.some((cap: any) => cap.id === 'reminder_fixture'))
    await bridge.handle(frame(version, 'host', 'reminder_fixture'), 1)
    assert.equal(hostCalls, 1); assert.equal(sidecarCalls, 0)
    const work = bridge.handle(frame(version, 'computer', 'run_powershell', { command: 'fixture' }), 1)
    assert.equal(sidecarCalls, 1)
    remindersEnabled = false; reminderRevision++
    const updated = await bridge.synchronize()
    assert.equal(responses.filter(entry => entry.type === 'invocation_cancel').length, 0)
    release(); await work
    assert.equal(responses.at(-1).payload.result.data, 'fixture-computer')
    await bridge.handle(frame(updated, 'disabled', 'reminder_fixture'), 1)
    assert.equal(hostCalls, 1)
    await bridge.handle(frame(version, 'stale', 'reminder_fixture'), 1)
    assert.equal(hostCalls, 1)
    computerEnabled = false; remindersEnabled = true; reminderRevision++
    const independent = await bridge.synchronize()
    await bridge.handle(frame(independent, 'host-without-computer', 'reminder_fixture'), 1)
    assert.equal(hostCalls, 2); assert.equal(sidecarCalls, 1)
    await bridge.close()
  } finally { release?.(); db.close() }
})

test('non-computer capability without a Main executor never falls back to Python', async () => {
  const original = JSON.parse(fs.readFileSync('resources/modules/native-capabilities.json', 'utf8'))[0]
  const registry = new ModuleRegistry([{ ...original, id: 'reminder_fixture', moduleId: 'reminders' }])
  const sql = ['001-module-state.sql', '002-capability-invocations.sql'].map(name => fs.readFileSync(`src/main/storage/migrations/${name}`, 'utf8'))
  const db = new StateDatabase(':memory:', sql[0], sql.slice(1))
  let executions = 0
  const replies: any[] = []
  const policy = new ModulePolicy(registry, { requireAgentAccess() {}, getSessionId: () => 1, getPermissions: () => ['computer.shell'], getSnapshot: id => ({ id, enabled: true, configured: true, authorized: true, health: 'healthy', lifecycle: 'running', revision: 0 }) })
  const bridge = new ModuleRuntimeBridge(registry, policy, new InvocationStore(db), { getSessionId: () => 1, notify: (_type, payload) => replies.push(payload), request: async (type, payload: any) => {
    if (type === 'module_snapshot') return { moduleRuntimeVersion: 1, snapshotVersion: payload.snapshotVersion }
    executions++; return { context: payload.context, result: { status: 'unknown', data: 'wrong', evidence: [] } }
  } }, () => 0)
  try {
    const snapshotVersion = await bridge.negotiate({ moduleRuntimeVersion: 1 }, 1)
    await bridge.handle({ version: 1, id: 'missing', type: 'capability_request', payload: { requestId: 'missing', snapshotVersion, capabilityId: 'reminder_fixture', args: { command: 'fixture' } } }, 1)
    assert.equal(executions, 0); assert.equal(replies.at(-1).result.status, 'failed')
    await bridge.close()
  } finally { db.close() }
})
