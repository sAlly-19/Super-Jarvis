import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { StateDatabase } from '../src/main/storage/state-database'
import { ModuleRegistry } from '../src/main/modules/registry'
import { ModulePolicy } from '../src/main/modules/policy'
import { ModuleRuntimeBridge } from '../src/main/modules/runtime-bridge'
import { InvocationStore } from '../src/main/modules/invocation-store'
import { TaskStore } from '../src/main/tasks/task-store'
import { TaskService } from '../src/main/tasks/task-service'
import { TaskEventRouter } from '../src/main/tasks/task-event-router'
import { PcHealthStore } from '../src/main/modules/pc-health/store'
import { PcHealthService } from '../src/main/modules/pc-health/service'
import { FrameDecoder, encodeFrame } from '../src/main/services/backend-framing'
import type { HostToSidecarMessageType } from '../src/shared/types/backend-protocol'

test('real Python composes two verified Main health reads without a Python worker, then obeys module disable', { timeout: 30000 }, async () => {
  const names = ['001-module-state.sql','002-capability-invocations.sql','003-tasks.sql','004-task-evidence.sql','005-reminders.sql','006-reminder-imports.sql','007-pc-health.sql']
  const sql = names.map(name => fs.readFileSync(`src/main/storage/migrations/${name}`, 'utf8'))
  const db = new StateDatabase(':memory:', sql[0], sql.slice(1)), registry = new ModuleRegistry(JSON.parse(fs.readFileSync('resources/modules/native-capabilities.json', 'utf8')))
  const child = spawn(process.env.JASPER_PYTHON_EXECUTABLE!, [path.resolve('test/fixtures/module-sidecar.py')], { windowsHide: true, stdio: ['pipe','pipe','pipe'], env: { ...process.env, JASPER_TEST_ORCHESTRATOR: '1', JASPER_TEST_HEALTH: '1' } })
  let enabled = true, reads = 0
  const pending = new Map<string, { type: string; resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>(), outgoing: string[] = []
  const fail = (error: Error) => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error) }; pending.clear() }
  const transport = {
    getSessionId: () => 1,
    notify(type: HostToSidecarMessageType, payload: unknown) { outgoing.push(type); child.stdin.write(encodeFrame({ version: 1, id: randomUUID(), type, payload })) },
    request(type: HostToSidecarMessageType, payload: unknown): Promise<any> {
      const id = randomUUID()
      return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(new Error('health stdio timeout')) }, 15000); pending.set(id, { type, resolve, reject, timer }); child.stdin.write(encodeFrame({ version: 1, id, type, payload })) })
    }
  }
  const policy = new ModulePolicy(registry, { requireAgentAccess() {}, getSessionId: () => 1,
    getSnapshot: id => ({ id, enabled: id === 'pc-health' && enabled, configured: true, authorized: true, health: 'healthy', lifecycle: 'running', revision: 0 }),
    getPermissions: id => registry.list().filter(cap => cap.moduleId === id).flatMap(cap => cap.permissions) })
  const health = new PcHealthService(new PcHealthStore(db), { collect: async () => { reads++; return {
    status: 'partial', observedAt: new Date().toISOString(), cpuPercent: 25, memory: null, disks: null, gpu: null, battery: null, processes: null, network: null, temperatureC: null, uptimeSeconds: 10,
    unavailable: ['memory','disks','gpu','battery','processes','network','temperature']
  } } }, { allowed: () => enabled, authorize: context => { if (!policy.authorize('pc_health_read', context).allowed) throw new Error('denied') }, now: Date.now, changed() {}, notify() {}, closeNotices() {} })
  const tasks = new TaskService(new TaskStore(db), { requireAccess() {}, sessionId: () => 1, sendCancel() {}, verifyCapability: (context, id, result) => health.verify(context, id, result), releaseObservation: id => health.releaseObservation(id) })
  const router = new TaskEventRouter(tasks)
  const bridge = new ModuleRuntimeBridge(registry, policy, new InvocationStore(db), transport, () => 0, tasks, { 'pc-health': (id, args, context, signal) => health.execute(id, args, context, signal) })
  const decoder = new FrameDecoder()
  child.stderr.resume(); child.on('error', fail); child.on('exit', () => fail(new Error('sidecar exited')))
  child.stdout.on('data', chunk => { try { for (const frame of decoder.push(chunk)) {
    if (frame.type === 'task_event') transport.notify('task_event_ack', router.handle(frame, 1))
    if (frame.type === 'capability_request') void bridge.handle(frame, 1).catch(fail)
    const entry = frame.replyTo ? pending.get(frame.replyTo) : null
    if (entry && (entry.type !== 'chat' || frame.type === 'turn_complete')) { pending.delete(frame.replyTo!); clearTimeout(entry.timer); frame.type === 'error' ? entry.reject(new Error('sidecar error')) : entry.resolve(frame.payload) }
  } } catch (error) { fail(error as Error) } })
  try {
    const hello = await transport.request('hello', { client: 'health-test', protocolVersion: 1 })
    await bridge.negotiate(hello, 1); await transport.request('task_runtime', { taskRuntimeVersion: 1, sessionId: 1 })
    await transport.request('chat', { text: 'Consultar saúde duas vezes.' })
    assert.equal(reads, 2); assert.equal(tasks.list()[0].status, 'succeeded')
    assert.equal(tasks.list()[0].evidence.length, 2)
    assert.doesNotMatch(JSON.stringify(tasks.list()), /cpuPercent|snapshot|processes/)
    assert.equal(outgoing.includes('capability_execute'), false)
    enabled = false; await health.stop(); await bridge.synchronize()
    await transport.request('chat', { text: 'Consultar novamente.' })
    assert.equal(reads, 2)
    await transport.request('shutdown', { reason: 'health_test' })
  } finally {
    for (const entry of pending.values()) clearTimeout(entry.timer)
    await bridge.close(); await health.stop(); child.stdin.end()
    if (child.pid && child.exitCode === null) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    db.close()
  }
})
