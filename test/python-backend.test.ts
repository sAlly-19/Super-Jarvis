import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { encodeFrame, FrameDecoder } from '../src/main/services/backend-framing'
import type { BackendEnvelope } from '../src/shared/types/backend-protocol'

function resolveTestPythonExe(): string {
  if (process.env.JASPER_PYTHON_EXECUTABLE && fs.existsSync(process.env.JASPER_PYTHON_EXECUTABLE)) {
    return process.env.JASPER_PYTHON_EXECUTABLE
  }
  const uvCandidate = 'C:\\Users\\aliss\\AppData\\Roaming\\uv\\python\\cpython-3.11.15-windows-x86_64-none\\python.exe'
  if (fs.existsSync(uvCandidate)) {
    return uvCandidate
  }
  return 'python'
}

describe('Python Backend Stdio Runtime & Clean Architecture', () => {
  const backendDir = path.resolve(process.cwd(), 'jasper-backend')
  const mainPyPath = path.join(backendDir, 'main.py')
  const runtimePyPath = path.join(backendDir, 'runtime.py')
  const toolsOsPath = path.join(backendDir, 'tools_os.py')
  const reqsPath = path.join(backendDir, 'requirements.txt')

  test('source hygiene: contains NO legacy server, uvicorn, WebSocket, /health, /config or port 8765', () => {
    assert.ok(fs.existsSync(mainPyPath), 'main.py must exist')
    const mainPyContent = fs.readFileSync(mainPyPath, 'utf-8')
    assert.doesNotMatch(mainPyContent, new RegExp(['Fast', 'API'].join(''), 'i'), 'main.py must not reference legacy server')
    assert.doesNotMatch(mainPyContent, /uvicorn/i, 'main.py must not reference uvicorn')
    assert.doesNotMatch(mainPyContent, /WebSocket/i, 'main.py must not reference WebSocket')
    assert.doesNotMatch(mainPyContent, /\/health/i, 'main.py must not define /health endpoint')
    assert.doesNotMatch(mainPyContent, /\/config/i, 'main.py must not define /config endpoint')
    assert.doesNotMatch(mainPyContent, /8765/, 'main.py must not bind to port 8765')
  })

  test('dependency hygiene: requirements.txt contains NO fastapi, uvicorn, or websockets', () => {
    assert.ok(fs.existsSync(reqsPath), 'requirements.txt must exist')
    const reqsContent = fs.readFileSync(reqsPath, 'utf-8').toLowerCase()
    assert.ok(!reqsContent.includes('fastapi'), 'requirements.txt must not contain fastapi')
    assert.ok(!reqsContent.includes('uvicorn'), 'requirements.txt must not contain uvicorn')
    assert.ok(!reqsContent.includes('websockets'), 'requirements.txt must not contain websockets')
  })

  test('total-control policy: tools_os.py has NO _is_destructive_command filter', () => {
    assert.ok(fs.existsSync(toolsOsPath), 'tools_os.py must exist')
    const toolsOsContent = fs.readFileSync(toolsOsPath, 'utf-8')
    assert.doesNotMatch(toolsOsContent, /_is_destructive_command/, 'destructive command filter must be removed')
    assert.doesNotMatch(toolsOsContent, /_DESTRUCTIVE_PATTERNS/, 'destructive patterns list must be removed')
  })

  test('modular architecture: runtime.py exists for agent orchestration', () => {
    assert.ok(fs.existsSync(runtimePyPath), 'runtime.py must exist as extracted runtime')
  })

  test('stdio handshake: echoes correlation ID and protocol version 1, shuts down cleanly', async () => {
    const pyExe = resolveTestPythonExe()
    const proc = spawn(pyExe, ['-u', mainPyPath], {
      cwd: backendDir,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8'
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })

    const decoder = new FrameDecoder()
    const receivedFrames: BackendEnvelope[] = []

    proc.stdout.on('data', (chunk: Buffer) => {
      const frames = decoder.push(chunk)
      receivedFrames.push(...frames)
    })

    let procStderr = ''
    proc.stderr.on('data', (chunk: Buffer) => {
      procStderr += chunk.toString('utf-8')
    })

    const exitPromise = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      proc.on('exit', (code, signal) => resolve({ code, signal }))
    })

    // Send hello handshake
    const helloReq: BackendEnvelope = {
      version: 1,
      id: 'test-req-hello-001',
      type: 'hello',
      payload: { client: 'super-jarvis-test', protocolVersion: 1 }
    }
    proc.stdin.write(encodeFrame(helloReq))

    // Wait up to 5 seconds for hello_ack
    const deadline = Date.now() + 5000
    while (receivedFrames.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50))
    }

    assert.ok(receivedFrames.length >= 1, `Expected hello_ack frame, got nothing. Stderr: ${procStderr}`)
    const ack = receivedFrames[0]
    assert.equal(ack.version, 1)
    assert.equal(ack.type, 'hello_ack')
    assert.equal(ack.replyTo, 'test-req-hello-001')
    assert.equal((ack.payload as any).protocolVersion, 1)
    assert.ok(Array.isArray((ack.payload as any).tools))

    // Send shutdown
    const shutReq: BackendEnvelope = {
      version: 1,
      id: 'test-req-shut-001',
      type: 'shutdown',
      payload: {}
    }
    proc.stdin.write(encodeFrame(shutReq))

    const exit = await Promise.race([
      exitPromise,
      new Promise<{ code: number | null; signal: string | null }>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout waiting for Python process shutdown')), 5000)
      )
    ])

    assert.equal(exit.code, 0, `Process should exit cleanly with code 0. Stderr: ${procStderr}`)
  })

  test('stdio malformed frame triggers nonzero exit and termination', async () => {
    const pyExe = resolveTestPythonExe()
    const proc = spawn(pyExe, ['-u', mainPyPath], {
      cwd: backendDir,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8'
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })

    const exitPromise = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      proc.on('exit', (code, signal) => resolve({ code, signal }))
    })

    // Send malformed 4-byte frame header declaring 0 length (invalid per protocol)
    proc.stdin.write(Buffer.from([0, 0, 0, 0]))

    const exit = await Promise.race([
      exitPromise,
      new Promise<{ code: number | null; signal: string | null }>((_, reject) =>
        setTimeout(() => {
          proc.kill()
          reject(new Error('Process did not exit on malformed frame'))
        }, 5000)
      )
    ])

    assert.notEqual(exit.code, 0, 'Process must exit with non-zero code on malformed frame')
  })
})
