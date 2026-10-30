import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { webDatabase } from './fixtures/web/database'
import { startWebResearchApplication } from '../src/main/modules/web-research/application'
import { ModuleRegistry } from '../src/main/modules/registry'
import { ModulePolicy } from '../src/main/modules/policy'
import { InvocationStore } from '../src/main/modules/invocation-store'
import { TaskService } from '../src/main/tasks/task-service'
import { TaskStore } from '../src/main/tasks/task-store'
import { ModuleRuntimeBridge } from '../src/main/modules/runtime-bridge'
import { FrameDecoder, encodeFrame } from '../src/main/services/backend-framing'
import type { BackendEnvelope, HostToSidecarMessageType } from '../src/shared/types/backend-protocol'
test('web stdio: direct search/read and private summary, then historical recovery without network', { timeout: 20000 }, async () => {
  const database = webDatabase(), registry = new ModuleRegistry(JSON.parse(fs.readFileSync('resources/modules/native-capabilities.json', 'utf8')))
  let requests = 0
  const app = startWebResearchApplication({ database, registry,
    crypto: { available: () => true, encrypt: text => Buffer.from(text).reverse(), decrypt: bytes => Buffer.from(bytes).reverse().toString() },
    transport: { async fetch(url) { requests++; return { url, status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from(url.includes('duckduckgo') ? '<div class="result"><a class="result__a" href="https://example.org/article">Older source</a></div>' : '<meta property="article:published_time" content="2024-01-01"><article>Untrusted synthetic source data.</article>') } } },
    authorizeAgent() {}, authorizeManagement() {}, moduleRevision: () => 0, sessionId: () => 1, changed() {}, sources() {} })
  const python = createRequire(path.resolve('package.json'))('./scripts/development-python.mjs').resolveDevelopmentPython({ projectRoot: process.cwd() })
  const env: NodeJS.ProcessEnv = { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
  for (const key of ['PATH', 'SystemRoot', 'SystemDrive', 'WINDIR', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA']) if (process.env[key]) env[key] = process.env[key]
  const child = spawn(python, [path.resolve('test/fixtures/web/deterministic-sidecar.py')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env })
  const pending = new Map<string, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>; type: string }>()
  const frames: BackendEnvelope[] = [], results: any[] = []
  const send = (type: HostToSidecarMessageType, payload: unknown, id = randomUUID()) => child.stdin.write(encodeFrame({ version: 1, id, type, payload }))
  const transport = { getSessionId: () => 1,
    notify(type: HostToSidecarMessageType, payload: any) { if (type === 'capability_response') results.push(payload.result); send(type, payload) },
    request(type: HostToSidecarMessageType, payload: unknown): Promise<any> {
      const id = randomUUID()
      return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(Error(`timeout_${type}`)) }, 12000); pending.set(id, { resolve, reject, timer, type }); send(type, payload, id) })
    } }
  const policy = new ModulePolicy(registry, { requireAgentAccess() {}, getSessionId: () => 1,
    getSnapshot: id => ({ id, enabled: id === 'web-research', configured: true, authorized: true, health: 'healthy', lifecycle: 'running', revision: 0 }),
    getPermissions: id => registry.list().filter(c => c.moduleId === id).flatMap(c => c.permissions) })
  const tasks = new TaskService(new TaskStore(database), { requireAccess() {}, sessionId: () => 1, sendCancel() {},
    verifyCapability: (context, id, result) => app.service.verify(context, id, result), releaseObservation: id => app.service.releaseObservation(id) })
  const bridge = new ModuleRuntimeBridge(registry, policy, new InvocationStore(database), transport, () => 0, tasks,
    { 'web-research': (id, args, context, signal) => app.service.execute(id, args, context, signal) })
  const fail = (error: Error) => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error) } pending.clear() }
  child.stderr.resume(); child.on('error', fail); child.on('exit', () => fail(Error('sidecar_exited')))
  const decoder = new FrameDecoder()
  child.stdout.on('data', chunk => {
    try { for (const frame of decoder.push(chunk)) {
      frames.push(frame)
      if (frame.type === 'capability_request' || frame.type === 'capability_cancel_request') void bridge.handle(frame, 1).catch(fail)
      if (frame.type === 'web_research_note') assert.equal(app.acceptNote(frame.payload as any, 1), true)
      const entry = frame.replyTo ? pending.get(frame.replyTo) : undefined
      if (entry && (entry.type !== 'chat' || frame.type === 'turn_complete')) { clearTimeout(entry.timer); pending.delete(frame.replyTo!); entry.resolve(frame.payload) }
    } } catch (error) { fail(error as Error) }
  })
  try {
    const features = await transport.request('hello', { client: 'web-test', protocolVersion: 1 })
    await bridge.negotiate(features, 1); await transport.request('task_runtime', { taskRuntimeVersion: 1, sessionId: 1 })
    await transport.request('chat', { text: 'Research a public question then read its source.' })
    assert.equal(requests, 2); assert.equal(results.length, 2)
    assert.ok(results.every(r => r.status === 'succeeded' && r.evidence.length > 0))
    const item = app.history.list().items[0]
    assert.equal(item.pageCount, 1); assert.equal(item.summaryState, 'available')
    assert.match(item.summary!, /older article/)
    const receipt = results[1].data._historyReceipt.ticket
    assert.equal(JSON.stringify(frames.filter(f => ['tool_result', 'response'].includes(f.type))).includes(receipt), false)
    assert.equal(frames.some(f => f.type === 'task_event'), false); assert.equal(tasks.list().length, 0)
    await transport.request('chat', { text: 'Recover that research from history.' })
    assert.equal(requests, 2); assert.equal(results.at(-1).data.kind, 'history_get')
    await transport.request('shutdown', { reason: 'test' })
  } finally {
    fail(Error('cleanup')); await bridge.close(); await app.stop()
    if (child.exitCode === null && child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    child.stdin.destroy(); database.close()
  }
})
