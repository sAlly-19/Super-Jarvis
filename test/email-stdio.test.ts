import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { emailAcceptanceHost } from './fixtures/email/acceptance-host'
import { RemindersStore } from '../src/main/modules/reminders/store'
import { ReminderCalendar } from '../src/main/modules/reminders/calendar'
import { RemindersService } from '../src/main/modules/reminders/service'
import { StateDatabase } from '../src/main/storage/state-database'
import { FrameDecoder, encodeFrame } from '../src/main/services/backend-framing'
import { ModuleRegistry } from '../src/main/modules/registry'
import { ModulePolicy } from '../src/main/modules/policy'
import { ModuleRuntimeBridge } from '../src/main/modules/runtime-bridge'
import { InvocationStore } from '../src/main/modules/invocation-store'
import { TaskService } from '../src/main/tasks/task-service'
import { TaskStore } from '../src/main/tasks/task-store'
import { TaskEventRouter } from '../src/main/tasks/task-event-router'
import type { BackendEnvelope, HostToSidecarMessageType } from '../src/shared/types/backend-protocol'

for (const combined of [false, true]) test(`real email stdio composes search/read/reply${combined ? ' and an explicitly requested reminder' : ''} with Main proof and no file authority`, { timeout: 45000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-email-stdio-'))
  const scripts = ['001-module-state.sql', '002-capability-invocations.sql', '003-tasks.sql', '004-task-evidence.sql', '005-reminders.sql', '006-reminder-imports.sql', '007-pc-health.sql', '008-email.sql'].map(name => fs.readFileSync(`src/main/storage/migrations/${name}`, 'utf8'))
  const db = new StateDatabase(path.join(root, 'state.db'), scripts[0], scripts.slice(1))
  const python = createRequire(path.resolve('package.json'))('./scripts/development-python.mjs').resolveDevelopmentPython({ projectRoot: process.cwd() })
  const child = spawn(python, [path.resolve('test/fixtures/module-sidecar.py')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, JASPER_TEST_ORCHESTRATOR: '1', JASPER_TEST_EMAIL: '1', JASPER_TEST_EMAIL_REMINDERS: combined ? '1' : '0' } })
  const frames: BackendEnvelope[] = [], outgoing: string[] = []
  const hostResults: any[] = []
  const pending = new Map<string, { type: string; resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  const fail = (error: Error) => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error) }; pending.clear() }
  const transport = {
    getSessionId: () => 1,
    notify(type: HostToSidecarMessageType, payload: unknown) { outgoing.push(type); if (type === 'capability_response') hostResults.push(payload); child.stdin.write(encodeFrame({ version: 1, id: randomUUID(), type, payload })) },
    request(type: HostToSidecarMessageType, payload: unknown, timeoutMs = 15000): Promise<any> {
      outgoing.push(type)
      const id = randomUUID()
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout ${type}`)) }, timeoutMs)
        pending.set(id, { type, resolve, reject, timer })
        child.stdin.write(encodeFrame({ version: 1, id, type, payload }))
      })
    }
  }
  const registry = new ModuleRegistry(JSON.parse(fs.readFileSync('resources/modules/native-capabilities.json', 'utf8')))
  const policy = new ModulePolicy(registry, { requireAgentAccess() {}, getSessionId: () => 1,
    getSnapshot: id => ({ id, enabled: true, configured: true, authorized: true, health: 'healthy', lifecycle: 'running', revision: 0 }),
    getPermissions: id => registry.list().filter(capability => capability.moduleId === id).flatMap(capability => capability.permissions) })
  const email = emailAcceptanceHost(db, root, policy)
  const reminderStore = new RemindersStore(db, new ReminderCalendar(), 'UTC')
  const reminders = new RemindersService(reminderStore, registry, { nowUtc: () => '2026-10-28T00:00:00.000Z', authorize: (id, context) => { const decision = policy.authorize(id, context); if (!decision.allowed) throw new Error(decision.code) } })
  const tasks = new TaskService(new TaskStore(db), { requireAccess() {}, sessionId: () => 1, sendCancel() {}, verifyCapability: (context, id, result) => id.startsWith('email_') ? email.service.verify(context, id, result) : reminders.verify(context, id, result), releaseObservation: id => { email.service.releaseObservation(id); reminders.releaseObservation(id) } })
  const router = new TaskEventRouter(tasks)
  const bridge = new ModuleRuntimeBridge(registry, policy, new InvocationStore(db), transport, () => 0, tasks, { email: (id, args, context, signal) => email.service.execute(id, args, context, signal), reminders: (id, args, context, signal) => reminders.execute(id, args, context, signal) })
  const decoder = new FrameDecoder()
  child.stderr.resume(); child.on('error', fail); child.on('exit', () => fail(new Error('sidecar exited')))
  child.stdout.on('data', chunk => {
    try {
      for (const frame of decoder.push(chunk)) {
        frames.push(frame)
        if (frame.type === 'task_event') transport.notify('task_event_ack', router.handle(frame, 1))
        if (frame.type === 'capability_request' || frame.type === 'capability_cancel_request') void bridge.handle(frame, 1).catch(fail)
        const entry = frame.replyTo ? pending.get(frame.replyTo) : undefined
        if (entry && (entry.type !== 'chat' || frame.type === 'turn_complete')) {
          pending.delete(frame.replyTo!); clearTimeout(entry.timer)
          frame.type === 'error' ? entry.reject(new Error('sidecar error')) : entry.resolve(frame.payload)
        }
      }
    } catch (error) { fail(error as Error) }
  })
  try {
    const hello = await transport.request('hello', { client: 'email-test', protocolVersion: 1 })
    await bridge.negotiate(hello, 1)
    await transport.request('task_runtime', { taskRuntimeVersion: 1, sessionId: 1 })
    await transport.request('chat', { text: 'Find my latest synthetic email, read it and reply using its original account.' + (combined ? ' Also create a reminder for tomorrow at nine UTC.' : '') })
    assert.equal(tasks.list()[0].status, 'succeeded', JSON.stringify({ task: tasks.list()[0], results: hostResults }).slice(0, 5000))
    assert.equal(tasks.list()[0].evidence.length, combined ? 4 : 3)
    assert.equal(outgoing.includes('capability_execute'), false)
    assert.equal(email.counters.sends, 1)
    assert.ok(email.counters.requests.some(request => request.startsWith('outlook:GET:')))
    assert.ok(email.counters.requests.some(request => request.startsWith('gmail:POST:')))
    assert.equal(email.counters.requests.some(request => request.startsWith('outlook:POST:')), false)
    const requests = frames.filter(frame => frame.type === 'capability_request').map(frame => frame.payload as any)
    assert.deepEqual(requests.map(request => request.capabilityId), ['email_search', 'email_read', 'email_reply', ...(combined ? ['reminder_create'] : [])])
    assert.equal(reminderStore.list({ limit: 100 }).items.length, combined ? 1 : 0)
    assert.equal(requests[2].args.ref.accountId, email.gmail.id)
    assert.equal(requests[2].args.attachmentHandles.length, 0)
    assert.equal(typeof requests[2].args.expectedVersion, 'string')
    const history = db.transaction(tx => [tx.prepare('SELECT * FROM task_events').all(), tx.prepare('SELECT * FROM task_evidence').all()])
    assert.doesNotMatch(JSON.stringify(history), /FIXTURE_EMAIL|synthetic-access-token|private local file/)
    await bridge.close(); await transport.request('shutdown', { reason: 'test' })
  } finally {
    fail(new Error('cleanup'))
    if (child.exitCode === null && child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    child.stdin.destroy(); await email.service.stop(); db.close(); fs.rmSync(root, { recursive: true, force: true })
  }
})
