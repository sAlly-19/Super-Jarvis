import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { FrameDecoder, encodeFrame } from '../src/main/services/backend-framing'
import { ModuleRuntimeBridge } from '../src/main/modules/runtime-bridge'
import { ModuleRegistry } from '../src/main/modules/registry'
import { ModulePolicy } from '../src/main/modules/policy'
import { InvocationStore } from '../src/main/modules/invocation-store'
import { StateDatabase } from '../src/main/storage/state-database'
import { TaskStore } from '../src/main/tasks/task-store'
import { TaskService } from '../src/main/tasks/task-service'
import { TaskEventRouter } from '../src/main/tasks/task-event-router'
import type { BackendEnvelope, HostToSidecarMessageType } from '../src/shared/types/backend-protocol'

for (const mode of ['legacy', 'orchestrated', 'cancel', 'diagnostics'] as const) test(`real stdio bridge ${mode}, then blocks the disabled module`, { timeout: 30000 }, async () => {
  const orchestrated = mode !== 'legacy'
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-module-stdio-'))
  const marker = path.join(root, 'powershell.pid')
  const sql = (name: string) => fs.readFileSync(path.join(process.cwd(), 'src/main/storage/migrations', name), 'utf8')
  const db = new StateDatabase(path.join(root, 'state.sqlite'), sql('001-module-state.sql'), [sql('002-capability-invocations.sql'), sql('003-tasks.sql'), sql('004-task-evidence.sql')])
  const child = spawn(process.env.JASPER_PYTHON_EXECUTABLE || 'python', [path.join(process.cwd(), 'test/fixtures/module-sidecar.py')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, JASPER_TEST_ORCHESTRATOR: orchestrated ? '1' : '0', JASPER_TEST_CANCEL_TASK: mode === 'cancel' ? '1' : '0', JASPER_TEST_CANCEL_MARKER: marker, JASPER_TEST_DIAGNOSTICS: mode === 'diagnostics' ? '1' : '0' } })
  const frames: BackendEnvelope[] = []
  const pending = new Map<string, { type: string; resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  let bridge: ModuleRuntimeBridge | undefined
  let router: TaskEventRouter | undefined
  let tasks: TaskService | undefined
  let cancellation: Promise<void> | undefined
  const decoder = new FrameDecoder()
  const fail = (error: Error) => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error) }; pending.clear() }
  child.on('error', fail)
  child.on('exit', () => fail(new Error('Test sidecar exited')))
  child.stderr.resume()
  child.stdout.on('data', chunk => {
    try {
      for (const frame of decoder.push(chunk)) {
        frames.push(frame)
        if (frame.type === 'task_event' && router) transport.notify('task_event_ack', router.handle(frame, 1))
        if (frame.type === 'capability_request' || frame.type === 'capability_cancel_request') void bridge?.handle(frame, 1).catch(fail)
        const item = frame.replyTo ? pending.get(frame.replyTo) : undefined
        if (item && (item.type !== 'chat' || frame.type === 'turn_complete')) {
          pending.delete(frame.replyTo!)
          clearTimeout(item.timer)
          frame.type === 'error' ? item.reject(new Error('Sidecar returned error')) : item.resolve(frame.payload)
        }
      }
    } catch (error) { fail(error as Error) }
  })
  const transport = {
    getSessionId: () => 1,
    notify(type: HostToSidecarMessageType, payload: unknown) { child.stdin.write(encodeFrame({ version: 1, id: randomUUID(), type, payload })) },
    request(type: HostToSidecarMessageType, payload: unknown, timeoutMs = 10000): Promise<any> {
      const id = randomUUID()
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${type}`)) }, timeoutMs)
        pending.set(id, { type, resolve, reject, timer })
        child.stdin.write(encodeFrame({ version: 1, id, type, payload }))
        if (mode === 'cancel' && type === 'capability_execute') {
          const taskId = (payload as { context: { taskId: string } }).context.taskId
          cancellation = (async () => {
            const deadline = Date.now() + 8000
            while (!fs.existsSync(marker) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
            assert.equal(fs.existsSync(marker), true, 'PowerShell must be running before cancellation')
            await tasks!.cancel(taskId)
          })()
          void cancellation.catch(fail)
        }
      })
    }
  }
  try {
    const registry = new ModuleRegistry(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'resources/modules/native-capabilities.json'), 'utf8')))
    let enabled = true
    let revision = 0
    const policy = new ModulePolicy(registry, { requireAgentAccess() {}, getSessionId: () => 1,
      getSnapshot: () => ({ id: 'computer', enabled, configured: true, authorized: true, health: 'healthy', lifecycle: 'running', revision }),
      getPermissions: () => ['computer.telemetry', 'computer.shell'] })
    tasks = new TaskService(new TaskStore(db), { requireAccess() {}, sessionId: () => 1, sendCancel: taskId => transport.notify('task_cancel', { taskId }) })
    router = new TaskEventRouter(tasks)
    bridge = new ModuleRuntimeBridge(registry, policy, new InvocationStore(db), transport, () => revision, tasks)
    const ack = await transport.request('hello', { client: 'module-test', protocolVersion: 1 })
    await bridge.negotiate(ack, 1)
    if (orchestrated) await transport.request('task_runtime', { taskRuntimeVersion: 1, sessionId: 1 })
    await transport.request('chat', { text: 'Consultar telemetria' }, 15000)
    const expectedCalls = mode === 'orchestrated' ? 2 : 1
    assert.equal(frames.filter(frame => frame.type === 'capability_request').length, expectedCalls)
    if (mode === 'cancel') {
      await cancellation
      const pid = Number(fs.readFileSync(marker, 'utf8'))
      assert.ok(Number.isSafeInteger(pid) && pid > 0)
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, 'PowerShell child survived cancellation')
      const task = tasks.list()[0]
      assert.equal(task.status, 'unknown')
      assert.deepEqual(task.stepStates, { a: 'unknown', b: 'skipped' })
    } else if (mode === 'diagnostics') {
      assert.equal(tasks.list()[0].status, 'unknown')
      const response = frames.find(frame => frame.type === 'response')!.payload as { text: string }
      assert.match(response.text, /PLAN_B_NATIVE_OUTPUT/)
      assert.match(response.text, /PLAN_B_NATIVE_STDERR/)
      assert.match(response.text, /código 7/)
      assert.doesNotMatch(response.text, /Tarefa verificada\./)
    } else if (orchestrated) {
      const task = tasks.list()[0]
      assert.equal(task.status, 'succeeded')
      assert.deepEqual(task.stepStates, { a: 'succeeded', b: 'succeeded' })
    } else {
      const first = frames.find(frame => frame.type === 'tool_result')!.payload as { result: string }
      assert.equal(JSON.parse(first.result).status, 'unknown')
      assert.ok(JSON.parse(first.result).data)
    }
    assert.equal(db.transaction(tx => tx.prepare('SELECT COUNT(*) AS n FROM capability_invocations').get()!.n), expectedCalls)
    enabled = false
    revision++
    await bridge.synchronize()
    await transport.request('chat', { text: 'Tentar novamente' })
    assert.equal(frames.filter(frame => frame.type === 'capability_request').length, expectedCalls)
    if (orchestrated) assert.equal(tasks.list()[0].status, 'failed')
    else {
      const last = frames.filter(frame => frame.type === 'tool_result').at(-1)!.payload as { result: string }
      assert.equal(JSON.parse(last.result).error, 'module_unavailable')
    }
    await bridge.close()
    await transport.request('shutdown', { reason: 'test' })
  } finally {
    fail(new Error('Test cleanup'))
    if (child.exitCode === null && child.pid) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      else child.kill('SIGKILL')
    }
    child.stdin.destroy()
    db.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
})
