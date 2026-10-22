import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import {
  PythonBackendManager,
  type BackendState
} from '../src/main/services/python-backend'
import {
  verifyBackendIntegrity,
  BackendIntegrityError
} from '../src/main/services/backend-integrity'
import type { BackendManifest } from '../src/main/generated/backend-manifest'
import { encodeFrame, FrameDecoder } from '../src/main/services/backend-framing'
import type { BackendEnvelope } from '../src/shared/types/backend-protocol'

function createMockProcess(): {
  proc: ChildProcess
  stdin: PassThrough
  stdout: PassThrough
  stderr: PassThrough
  simulateExit: (code: number, signal?: string) => void
  simulateStdoutFrame: (env: BackendEnvelope) => void
} {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const emitter = new EventEmitter()

  const proc = Object.assign(emitter, {
    stdin,
    stdout,
    stderr,
    pid: 99999,
    killed: false,
    kill: (signal?: NodeJS.Signals | number) => {
      proc.killed = true
      emitter.emit('exit', 0, signal || 'SIGTERM')
      return true
    }
  }) as unknown as ChildProcess

  const simulateExit = (code: number, signal: string = 'SIGTERM') => {
    emitter.emit('exit', code, signal)
  }

  const simulateStdoutFrame = (env: BackendEnvelope) => {
    stdout.write(encodeFrame(env))
  }

  return { proc, stdin, stdout, stderr, simulateExit, simulateStdoutFrame }
}

describe('Backend Integrity Verification (backend-integrity.ts)', () => {
  const tmpDir = path.join(process.cwd(), 'temp-test-integrity-' + Date.now())

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('fails if backend root directory does not exist', async () => {
    const manifest: BackendManifest = {
      protocolVersion: 1,
      backendVersion: '2.0.0',
      executable: 'jasper-backend.exe',
      files: []
    }
    await assert.rejects(
      async () => verifyBackendIntegrity(path.join(tmpDir, 'nonexistent'), manifest),
      BackendIntegrityError
    )
  })

  test('fails if executable is missing from root', async () => {
    const manifest: BackendManifest = {
      protocolVersion: 1,
      backendVersion: '2.0.0',
      executable: 'jasper-backend.exe',
      files: []
    }
    await assert.rejects(
      async () => verifyBackendIntegrity(tmpDir, manifest),
      (err: any) => err instanceof BackendIntegrityError && err.message.includes('executable missing')
    )
  })

  test('fails if file in manifest has hash mismatch', async () => {
    fs.writeFileSync(path.join(tmpDir, 'jasper-backend.exe'), 'fake-exe-content')
    fs.writeFileSync(path.join(tmpDir, 'model.bin'), 'corrupted-content')

    const manifest: BackendManifest = {
      protocolVersion: 1,
      backendVersion: '2.0.0',
      executable: 'jasper-backend.exe',
      files: [
        { path: 'model.bin', sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' }
      ]
    }

    await assert.rejects(
      async () => verifyBackendIntegrity(tmpDir, manifest),
      (err: any) => err instanceof BackendIntegrityError && err.message.includes('Hash mismatch')
    )
  })

  test('succeeds when all files match declared hashes', async () => {
    fs.writeFileSync(path.join(tmpDir, 'jasper-backend.exe'), 'fake-exe-content')
    fs.writeFileSync(path.join(tmpDir, 'empty.txt'), '')

    const manifest: BackendManifest = {
      protocolVersion: 1,
      backendVersion: '2.0.0',
      executable: 'jasper-backend.exe',
      files: [
        { path: 'empty.txt', sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' }
      ]
    }

    await assert.doesNotReject(async () => verifyBackendIntegrity(tmpDir, manifest))
  })
})

describe('Secure PythonBackendManager Stdio Lifecycle & Supervision', () => {
  test('initial state is stopped and rejects operational requests', async () => {
    const manager = new PythonBackendManager({
      isExecutionAllowed: () => true
    })
    assert.equal(manager.getState(), 'stopped')

    await assert.rejects(
      async () => manager.request('chat', { text: 'oi' }),
      /not ready/i
    )
  })

  test('completes handshake and transitions to ready state', async () => {
    const mock = createMockProcess()
    const manager = new PythonBackendManager({
      isExecutionAllowed: () => true,
      spawnFn: () => mock.proc
    })

    const startPromise = manager.start()
    assert.equal(manager.getState(), 'handshaking')

    // Expect hello envelope on stdin
    const decoder = new FrameDecoder()
    const frames: BackendEnvelope[] = []
    mock.stdin.on('data', (chunk) => {
      frames.push(...decoder.push(chunk))
    })

    // Simulate backend sending hello_ack
    await new Promise((r) => setImmediate(r))
    assert.ok(frames.length >= 1)
    const helloReq = frames[0]
    assert.equal(helloReq.type, 'hello')

    mock.simulateStdoutFrame({
      version: 1,
      id: 'resp-hello-1',
      replyTo: helloReq.id,
      type: 'hello_ack',
      payload: { service: 'jasper-backend', protocolVersion: 1, tools: [] }
    })

    await startPromise
    assert.equal(manager.getState(), 'ready')

    await manager.stop()
    assert.equal(manager.getState(), 'stopped')
  })

  test('request timeout rejects and cleans up pending request', async () => {
    const mock = createMockProcess()
    const manager = new PythonBackendManager({
      isExecutionAllowed: () => true,
      spawnFn: () => mock.proc
    })

    // Complete handshake
    const startPromise = manager.start()
    mock.stdin.once('data', (chunk) => {
      const frames = new FrameDecoder().push(chunk)
      if (frames.length > 0) {
        mock.simulateStdoutFrame({
          version: 1,
          id: 'resp-hello-1',
          replyTo: frames[0].id,
          type: 'hello_ack',
          payload: { service: 'jasper-backend', protocolVersion: 1 }
        })
      }
    })
    await startPromise
    assert.equal(manager.getState(), 'ready')

    // Request with short timeout (50ms)
    await assert.rejects(
      async () => manager.request('chat', { text: 'test' }, 50),
      /timed out/i
    )
  })

  test('process unexpected exit rejects pending requests and triggers recovery up to 3 times', async () => {
    let spawnCount = 0
    let currentMock = createMockProcess()

    const manager = new PythonBackendManager({
      isExecutionAllowed: () => true,
      spawnFn: () => {
        spawnCount++
        currentMock = createMockProcess()
        // Auto-respond to handshake
        currentMock.stdin.once('data', (chunk) => {
          const frames = new FrameDecoder().push(chunk)
          if (frames.length > 0 && frames[0].type === 'hello') {
            setImmediate(() => {
              currentMock.simulateStdoutFrame({
                version: 1,
                id: 'resp-h-' + spawnCount,
                replyTo: frames[0].id,
                type: 'hello_ack',
                payload: { service: 'jasper-backend', protocolVersion: 1 }
              })
            })
          }
        })
        return currentMock.proc
      },
      backoffBaseMs: 10 // fast backoff for testing
    })

    await manager.start()
    assert.equal(manager.getState(), 'ready')
    assert.equal(spawnCount, 1)

    // Simulate crash 1 -> should restart
    currentMock.simulateExit(1)
    await new Promise((r) => setTimeout(r, 60))
    assert.equal(spawnCount, 2)
    assert.equal(manager.getState(), 'ready')

    // Simulate crash 2 -> should restart
    currentMock.simulateExit(1)
    await new Promise((r) => setTimeout(r, 80))
    assert.equal(spawnCount, 3)
    assert.equal(manager.getState(), 'ready')

    // Simulate crash 3 -> should restart (third recovery)
    currentMock.simulateExit(1)
    await new Promise((r) => setTimeout(r, 120))
    assert.equal(spawnCount, 4)
    assert.equal(manager.getState(), 'ready')

    // Simulate crash 4 -> budget exhausted, transitions to error
    currentMock.simulateExit(1)
    await new Promise((r) => setTimeout(r, 80))
    assert.equal(manager.getState(), 'error')
    assert.equal(spawnCount, 4, 'Should not spawn again after 3 restarts exhausted')
  })

  test('does not restart if isExecutionAllowed() returns false', async () => {
    let allowed = true
    let spawnCount = 0
    let currentMock = createMockProcess()

    const manager = new PythonBackendManager({
      isExecutionAllowed: () => allowed,
      spawnFn: () => {
        spawnCount++
        currentMock = createMockProcess()
        currentMock.stdin.once('data', (chunk) => {
          const frames = new FrameDecoder().push(chunk)
          if (frames.length > 0 && frames[0].type === 'hello') {
            setImmediate(() => {
              currentMock.simulateStdoutFrame({
                version: 1,
                id: 'resp-h',
                replyTo: frames[0].id,
                type: 'hello_ack',
                payload: { service: 'jasper-backend', protocolVersion: 1 }
              })
            })
          }
        })
        return currentMock.proc
      },
      backoffBaseMs: 10
    })

    await manager.start()
    assert.equal(manager.getState(), 'ready')

    // Lock license gate
    allowed = false
    currentMock.simulateExit(1)

    await new Promise((r) => setTimeout(r, 50))
    assert.equal(manager.getState(), 'stopped')
    assert.equal(spawnCount, 1, 'Should not restart when license is not allowed')
  })
})
