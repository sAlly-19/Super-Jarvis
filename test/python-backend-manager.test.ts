import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
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
import { configStore } from '../src/main/config/config-store'

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

class FakeRestartScheduler {
  private sequence = 0
  private queue: Array<{ id: number; callback: () => void; delay: number; cancelled: boolean }> = []

  public setTimeout = (callback: () => void, delay: number): number => {
    const task = { id: ++this.sequence, callback, delay, cancelled: false }
    this.queue.push(task)
    return task.id
  }

  public clearTimeout = (id: unknown): void => {
    const task = this.queue.find((candidate) => candidate.id === id)
    if (task) task.cancelled = true
  }

  public pendingDelays(): number[] {
    return this.queue.filter((task) => !task.cancelled).map((task) => task.delay)
  }

  public async runNext(expectedDelay: number): Promise<void> {
    const task = this.queue.find((candidate) => !candidate.cancelled)
    assert.ok(task, `Expected a scheduled restart after ${expectedDelay}ms`)
    assert.equal(task.delay, expectedDelay)
    task.cancelled = true
    task.callback()
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))
  }
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

  test('fails if extraneous undeclared file is present in sidecar root', async () => {
    fs.writeFileSync(path.join(tmpDir, 'jasper-backend.exe'), 'fake-exe-content')
    fs.writeFileSync(path.join(tmpDir, 'empty.txt'), '')
    fs.writeFileSync(path.join(tmpDir, 'rogue.dll'), 'bad')

    const manifest: BackendManifest = {
      protocolVersion: 1,
      backendVersion: '2.0.0',
      executable: 'jasper-backend.exe',
      files: [
        { path: 'empty.txt', sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' }
      ]
    }

    await assert.rejects(
      async () => verifyBackendIntegrity(tmpDir, manifest),
      (err: any) => err instanceof BackendIntegrityError && err.message.includes('Extraneous file')
    )
  })

  test('fails if loose .py file is present in sidecar', async () => {
    fs.writeFileSync(path.join(tmpDir, 'jasper-backend.exe'), 'fake-exe-content')
    fs.writeFileSync(path.join(tmpDir, 'empty.txt'), '')
    fs.writeFileSync(path.join(tmpDir, 'script.py'), 'print(1)')

    const manifest: BackendManifest = {
      protocolVersion: 1,
      backendVersion: '2.0.0',
      executable: 'jasper-backend.exe',
      files: [
        { path: 'empty.txt', sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
        { path: 'script.py', sha256: '1e4c76b976bcf64187e1f40d1276a7eb84fd8d5beccde4488db49b1a59cc00a6' }
      ]
    }

    await assert.rejects(
      async () => verifyBackendIntegrity(tmpDir, manifest),
      (err: any) => err instanceof BackendIntegrityError && err.message.includes('Loose .py source file')
    )
  })
})

describe('Secure PythonBackendManager Stdio Lifecycle & Supervision', () => {
  const originalPythonExecutable = process.env.JASPER_PYTHON_EXECUTABLE

  beforeEach(() => {
    process.env.JASPER_PYTHON_EXECUTABLE = process.execPath
  })

  afterEach(() => {
    if (originalPythonExecutable === undefined) {
      delete process.env.JASPER_PYTHON_EXECUTABLE
    } else {
      process.env.JASPER_PYTHON_EXECUTABLE = originalPythonExecutable
    }
  })

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
      spawnFn: () => mock.proc,
      shutdownGraceMs: 1,
      terminateProcessTreeFn: async () => {}
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
          payload: { service: 'jasper-backend', protocolVersion: 1, tools: [] }
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

  test('uses exactly three deterministic restart attempts at 250ms, 1s and 4s', async () => {
    let spawnCount = 0
    let currentMock = createMockProcess()
    const scheduler = new FakeRestartScheduler()

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
                payload: { service: 'jasper-backend', protocolVersion: 1, tools: [] }
              })
            })
          }
        })
        return currentMock.proc
      },
      restartScheduler: scheduler
    })

    await manager.start()
    assert.equal(manager.getState(), 'ready')
    assert.equal(spawnCount, 1)

    currentMock.simulateExit(1)
    assert.deepEqual(scheduler.pendingDelays(), [250])
    await scheduler.runNext(250)
    assert.equal(spawnCount, 2)
    assert.equal(manager.getState(), 'ready')

    currentMock.simulateExit(1)
    assert.deepEqual(scheduler.pendingDelays(), [1000])
    await scheduler.runNext(1000)
    assert.equal(spawnCount, 3)
    assert.equal(manager.getState(), 'ready')

    currentMock.simulateExit(1)
    assert.deepEqual(scheduler.pendingDelays(), [4000])
    await scheduler.runNext(4000)
    assert.equal(spawnCount, 4)
    assert.equal(manager.getState(), 'ready')

    currentMock.simulateExit(1)
    assert.equal(manager.getState(), 'error')
    assert.equal(spawnCount, 4, 'Should not spawn again after 3 restarts exhausted')
    assert.deepEqual(scheduler.pendingDelays(), [])
  })

  test('does not restart if isExecutionAllowed() returns false', async () => {
    let allowed = true
    let spawnCount = 0
    let currentMock = createMockProcess()
    const scheduler = new FakeRestartScheduler()

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
                payload: { service: 'jasper-backend', protocolVersion: 1, tools: [] }
              })
            })
          }
        })
        return currentMock.proc
      },
      restartScheduler: scheduler
    })

    await manager.start()
    assert.equal(manager.getState(), 'ready')

    // Lock license gate
    allowed = false
    currentMock.simulateExit(1)

    assert.equal(manager.getState(), 'stopped')
    assert.equal(spawnCount, 1, 'Should not restart when license is not allowed')
    assert.deepEqual(scheduler.pendingDelays(), [])
  })

  test('treats a wrong-direction backend frame as fatal and rejects pending work', async () => {
    const mock = createMockProcess()
    let terminationCalls = 0
    const manager = new PythonBackendManager({
      isExecutionAllowed: () => true,
      spawnFn: () => mock.proc,
      shutdownGraceMs: 1,
      terminateProcessTreeFn: async () => {
        terminationCalls++
      }
    })

    const startPromise = manager.start()
    mock.stdin.once('data', (chunk) => {
      const [hello] = new FrameDecoder().push(chunk)
      mock.simulateStdoutFrame({
        version: 1,
        id: 'resp-protocol-ready',
        replyTo: hello.id,
        type: 'hello_ack',
        payload: { service: 'jasper-backend', protocolVersion: 1, tools: [] }
      })
    })
    await startPromise

    const pendingOutcome = manager.request('chat', { text: 'pending' }, 10_000).then(
      () => 'resolved',
      (error: Error) => error
    )
    mock.simulateStdoutFrame({
      version: 1,
      id: 'host-only-from-sidecar',
      type: 'chat',
      payload: { text: 'invalid direction' }
    })
    const outcomeBeforeCleanup = await Promise.race([
      pendingOutcome,
      new Promise<'still-pending'>((resolve) => setImmediate(() => resolve('still-pending')))
    ])

    assert.ok(outcomeBeforeCleanup instanceof Error)
    assert.match(outcomeBeforeCleanup.message, /protocol|direction|direção/i)
    assert.equal(terminationCalls, 1)
    await manager.stop('test_cleanup')
  })

  test('treats a second hello acknowledgement as a fatal state violation', async () => {
    const mock = createMockProcess()
    let terminationCalls = 0
    const manager = new PythonBackendManager({
      isExecutionAllowed: () => true,
      spawnFn: () => mock.proc,
      terminateProcessTreeFn: async () => {
        terminationCalls++
      }
    })
    const startPromise = manager.start()
    mock.stdin.once('data', (chunk) => {
      const [hello] = new FrameDecoder().push(chunk)
      mock.simulateStdoutFrame({
        version: 1,
        id: 'first-hello-ack',
        replyTo: hello.id,
        type: 'hello_ack',
        payload: { service: 'jasper-backend', protocolVersion: 1, tools: [] }
      })
    })
    await startPromise

    mock.simulateStdoutFrame({
      version: 1,
      id: 'second-hello-ack',
      type: 'hello_ack',
      payload: { service: 'jasper-backend', protocolVersion: 1, tools: [] }
    })
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(terminationCalls, 1)
    assert.equal(manager.getState(), 'error')
  })

  test('rejects pending requests before process-tree termination completes', async () => {
    const mock = createMockProcess()
    let releaseTermination!: () => void
    let terminationStarted!: () => void
    const started = new Promise<void>((resolve) => {
      terminationStarted = resolve
    })
    const blockedTermination = new Promise<void>((resolve) => {
      releaseTermination = resolve
    })
    const manager = new PythonBackendManager({
      isExecutionAllowed: () => true,
      spawnFn: () => mock.proc,
      shutdownGraceMs: 1,
      terminateProcessTreeFn: async (pid) => {
        assert.equal(pid, 99999)
        terminationStarted()
        await blockedTermination
      }
    })

    const startPromise = manager.start()
    mock.stdin.once('data', (chunk) => {
      const [hello] = new FrameDecoder().push(chunk)
      mock.simulateStdoutFrame({
        version: 1,
        id: 'resp-stop-order',
        replyTo: hello.id,
        type: 'hello_ack',
        payload: { service: 'jasper-backend', protocolVersion: 1, tools: [] }
      })
    })
    await startPromise

    const pending = manager
      .request('chat', { text: 'still running' }, 10_000)
      .then(
        () => null,
        (error: Error) => error
      )
    const stopPromise = manager.stop('license_revoked')
    await started

    const rejection = await pending
    assert.match(rejection?.message || '', /license_revoked/i)
    assert.equal(manager.getState(), 'stopped')

    releaseTermination()
    await stopPromise
  })

  test('does not expose provider or Jasper secrets in the sidecar environment', async () => {
    const mock = createMockProcess()
    let spawnedEnvironment: NodeJS.ProcessEnv | undefined
    process.env.GEMINI_API_KEY = 'gemini-secret'
    process.env.GOOGLE_API_KEY = 'google-secret'
    process.env.GROQ_API_KEY = 'groq-secret'
    process.env.JASPER_LICENSE_KEY = 'license-secret'
    const originalGetConfig = configStore.getConfig
    configStore.getConfig = () => ({
      ...originalGetConfig.call(configStore),
      apiKey: 'gsk_config-store-secret'
    })

    const manager = new PythonBackendManager({
      isExecutionAllowed: () => true,
      spawnFn: (_command, _args, options) => {
        spawnedEnvironment = options.env
        return mock.proc
      },
      shutdownGraceMs: 1,
      terminateProcessTreeFn: async () => {}
    })

    try {
      const startPromise = manager.start()
      mock.stdin.once('data', (chunk) => {
        const [hello] = new FrameDecoder().push(chunk)
        mock.simulateStdoutFrame({
          version: 1,
          id: 'resp-env',
          replyTo: hello.id,
          type: 'hello_ack',
          payload: { service: 'jasper-backend', protocolVersion: 1, tools: [] }
        })
      })
      await startPromise

      assert.ok(spawnedEnvironment)
      assert.equal(spawnedEnvironment.GEMINI_API_KEY, undefined)
      assert.equal(spawnedEnvironment.GOOGLE_API_KEY, undefined)
      assert.equal(spawnedEnvironment.GROQ_API_KEY, undefined)
      assert.equal(spawnedEnvironment.JASPER_LICENSE_KEY, undefined)
      assert.equal(spawnedEnvironment.PYTHONUNBUFFERED, '1')
      await manager.stop()
    } finally {
      configStore.getConfig = originalGetConfig
      delete process.env.GEMINI_API_KEY
      delete process.env.GOOGLE_API_KEY
      delete process.env.GROQ_API_KEY
      delete process.env.JASPER_LICENSE_KEY
    }
  })

  test('requires an explicit valid Python executable in development', async () => {
    delete process.env.JASPER_PYTHON_EXECUTABLE
    const manager = new PythonBackendManager({ isExecutionAllowed: () => true })
    await assert.rejects(() => manager.start(), /JASPER_PYTHON_EXECUTABLE/i)

    process.env.JASPER_PYTHON_EXECUTABLE = path.join(process.cwd(), 'missing-python.exe')
    await assert.rejects(() => manager.start(), /does not exist/i)
  })

  test('refuses development startup when the backend entrypoint is absent from app resources', async () => {
    const isolatedAppRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-untrusted-cwd-'))
    try {
      fs.mkdirSync(path.join(isolatedAppRoot, 'jasper-backend'))
      const manager = new PythonBackendManager({
        isExecutionAllowed: () => true,
        applicationRoot: isolatedAppRoot
      })

      await assert.rejects(() => manager.start(), /backend entrypoint does not exist/i)
    } finally {
      fs.rmSync(isolatedAppRoot, { recursive: true, force: true })
    }
  })
})
