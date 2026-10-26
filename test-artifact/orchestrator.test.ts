import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { FrameDecoder, encodeFrame } from '../src/main/services/backend-framing'
import type { HostToSidecarMessageType } from '../src/shared/types/backend-protocol'

test('compiled orchestrator negotiates, handles cancellation control and shuts down without a provider', { timeout: 30000 }, async () => {
  const child = spawn(path.resolve('build/python-backend/jasper-backend/jasper-backend.exe'), [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  const decoder = new FrameDecoder()
  const pending = new Map<string, { resolve: (value: any) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  child.stderr.resume()
  child.stdout.on('data', chunk => {
    try {
      for (const frame of decoder.push(chunk)) {
        const request = pending.get(frame.replyTo ?? '')
        if (!request) continue
        pending.delete(frame.replyTo!); clearTimeout(request.timer)
        if (frame.type === 'error') request.reject(new Error('Compiled sidecar rejected request'))
        else request.resolve(frame)
      }
    } catch (error) { for (const entry of pending.values()) entry.reject(error as Error) }
  })
  const request = (id: string, type: HostToSidecarMessageType, payload: unknown): Promise<any> => new Promise((resolve, reject) => {
    // Match the existing artifact handshake allowance: cold Windows/AV startup can exceed 5 s.
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Compiled task timeout: ${type}`)) }, type === 'hello' ? 15000 : 5000)
    pending.set(id, { resolve, reject, timer })
    child.stdin.write(encodeFrame({ version: 1, id, type, payload }))
  })
  try {
    assert.equal((await request('hello', 'hello', { client: 'task-artifact-test', protocolVersion: 1 })).type, 'hello_ack')
    const ack = await request('tasks', 'task_runtime', { taskRuntimeVersion: 1, sessionId: 2 })
    assert.equal(ack.type, 'task_runtime_ack')
    assert.equal(ack.payload.sessionId, 2)
    child.stdin.write(encodeFrame({ version: 1, id: 'cancel', type: 'task_cancel', payload: { taskId: 'absent-task' } }))
    assert.equal((await request('snapshot', 'module_snapshot', { moduleRuntimeVersion: 1, snapshotVersion: 1, sessionId: 2, capabilities: [] })).type, 'module_snapshot_ack')
    assert.equal((await request('shutdown', 'shutdown', { reason: 'artifact_test' })).payload.status, 'shutting_down')
  } finally {
    for (const entry of pending.values()) clearTimeout(entry.timer)
    child.stdin.end()
    if (child.exitCode === null && child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  }
})
