import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { StateDatabase } from '../src/main/storage/state-database'
import { FrameDecoder, encodeFrame } from '../src/main/services/backend-framing'
import { ModuleRegistry } from '../src/main/modules/registry'
import { ModulePolicy } from '../src/main/modules/policy'
import { ModuleRuntimeBridge } from '../src/main/modules/runtime-bridge'
import { InvocationStore } from '../src/main/modules/invocation-store'
import { TaskService } from '../src/main/tasks/task-service'
import { TaskStore } from '../src/main/tasks/task-store'
import { TaskEventRouter } from '../src/main/tasks/task-event-router'
import { RemindersStore } from '../src/main/modules/reminders/store'
import { ReminderCalendar } from '../src/main/modules/reminders/calendar'
import { RemindersService } from '../src/main/modules/reminders/service'
import { RemindersImportService } from '../src/main/modules/reminders/import-service'
import { parseCalendar } from '../src/main/modules/reminders/ical-codec'
import type { BackendEnvelope, HostToSidecarMessageType } from '../src/shared/types/backend-protocol'

test('real stdio composes create to get with Main proof, bound ID and contextual reply without a Python reminder worker', { timeout: 45000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-reminder-stdio-'))
  const scripts = ['001-module-state.sql', '002-capability-invocations.sql', '003-tasks.sql', '004-task-evidence.sql', '005-reminders.sql', '006-reminder-imports.sql'].map(name => fs.readFileSync(`src/main/storage/migrations/${name}`, 'utf8'))
  const db = new StateDatabase(path.join(root, 'state.db'), scripts[0], scripts.slice(1))
  const child = spawn(process.env.JASPER_PYTHON_EXECUTABLE || 'python', [path.resolve('test/fixtures/module-sidecar.py')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, JASPER_TEST_ORCHESTRATOR: '1', JASPER_TEST_REMINDERS: '1' } })
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
  const store = new RemindersStore(db, new ReminderCalendar(), 'UTC')
  const reminders = new RemindersService(store, registry, { nowUtc: () => '2027-01-01T00:00:00.000Z', authorize: (id, context) => { if (!policy.authorize(id, context).allowed) throw new Error('denied') } })
  const tasks = new TaskService(new TaskStore(db), { requireAccess() {}, sessionId: () => 1, sendCancel() {}, verifyCapability: (context, id, result) => reminders.verify(context, id, result), releaseObservation: id => reminders.releaseObservation(id) })
  const router = new TaskEventRouter(tasks)
  const bridge = new ModuleRuntimeBridge(registry, policy, new InvocationStore(db), transport, () => 0, tasks, { reminders: (id, args, context, signal) => reminders.execute(id, args, context, signal) })
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
    const hello = await transport.request('hello', { client: 'reminders-test', protocolVersion: 1 })
    await bridge.negotiate(hello, 1)
    await transport.request('task_runtime', { taskRuntimeVersion: 1, sessionId: 1 })
    await transport.request('chat', { text: 'Criar lembrete de teste e consultar.' })
    assert.deepEqual(tasks.list(), [])
    assert.equal(hostResults.length, 2)
    assert.ok(hostResults.every(item => item.result.status === 'succeeded' && item.result.evidence.length > 0))
    assert.equal(frames.some(frame => frame.type === 'task_event'), false)
    assert.equal(outgoing.includes('capability_execute'), false)
    const item = store.list({ limit: 100 }).items[0]
    assert.equal(item.title, 'FIXTURE_REMINDER'); assert.equal(item.nextDueUtc, '2027-01-31T09:00:00.000Z')
    const get = frames.filter(frame => frame.type === 'capability_request').at(-1)!.payload as any
    assert.equal(get.args.id, item.id)
    const reply = frames.find(frame => frame.type === 'response')!.payload as any
    assert.match(reply.text, /FIXTURE_REMINDER.*2027-01-31.*UTC/)
    await transport.request('chat', { text: 'Listar, editar por revisão e consultar novamente.' })
    assert.equal(store.get(item.id)!.title, 'FIXTURE_REMINDER_UPDATED')
    assert.equal(store.get(item.id)!.revision, 1)
    assert.equal(store.list({ limit: 100 }).items.length, 1)
    const parsed = parseCalendar(Uint8Array.from(fs.readFileSync('test/fixtures/reminders/sample-calendar.ics')), store.getPreferences())
    const imported = await new RemindersImportService(store, () => {}).apply(parsed.candidates, { invocationId: 'stdio-import', nowUtc: '2027-01-01T00:00:00.000Z' }, new AbortController().signal)
    assert.equal(imported.created, 2)
    await transport.request('chat', { text: 'Listar calendário importado.' })
    assert.equal(hostResults.at(-1).result.status, 'succeeded')
    assert.equal(hostResults.at(-1).result.data.items.length, 3)
    assert.equal(outgoing.includes('capability_execute'), false)
    assert.deepEqual(tasks.list(), [])
    const history = db.transaction(tx => [tx.prepare('SELECT * FROM task_events').all(), tx.prepare('SELECT * FROM task_evidence').all()])
    assert.equal(JSON.stringify(history).includes('FIXTURE_REMINDER'), false)
    await bridge.close(); await transport.request('shutdown', { reason: 'test' })
  } finally {
    fail(new Error('cleanup'))
    if (child.exitCode === null && child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    child.stdin.destroy(); db.close(); fs.rmSync(root, { recursive: true, force: true })
  }
})
