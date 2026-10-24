import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

describe('Reproducible Python Packaging & Build Verification (Artifact Test)', () => {
  const root = process.cwd()
  const backendDir = path.join(root, 'jasper-backend')

  test('requirements.in contains exact pinned direct dependencies and no web server packages', () => {
    const reqInPath = path.join(backendDir, 'requirements.in')
    assert.ok(fs.existsSync(reqInPath), 'requirements.in must exist')
    const content = fs.readFileSync(reqInPath, 'utf-8')

    // Must contain exact required pins
    assert.ok(content.includes('litellm==1.106.2'), 'must pin litellm==1.106.2')
    assert.ok(content.includes('edge-tts==7.3.1'), 'must pin edge-tts==7.3.1')
    assert.ok(content.includes('psutil==7.2.2'), 'must pin psutil==7.2.2')
    assert.ok(content.includes('PyAutoGUI==0.9.54'), 'must pin PyAutoGUI==0.9.54')
    assert.ok(content.includes('mss==10.2.0'), 'must pin mss==10.2.0')
    assert.ok(content.includes('Pillow==13.0.0'), 'must pin Pillow==13.0.0')
    assert.ok(content.includes('pycaw==20260927'), 'must pin pycaw==20260927')
    assert.ok(content.includes('comtypes==1.4.17'), 'must pin comtypes==1.4.17')
    assert.ok(content.includes('SpeechRecognition==3.17.0'), 'must pin SpeechRecognition==3.17.0')

    // Must NOT contain removed dependencies
    assert.ok(!content.toLowerCase().includes('fastapi'), 'must not contain fastapi')
    assert.ok(!content.toLowerCase().includes('uvicorn'), 'must not contain uvicorn')
    assert.ok(!content.toLowerCase().includes('websockets'), 'must not contain websockets')
  })

  test('requirements.lock exists and contains cryptographic SHA-256 hashes', () => {
    const lockPath = path.join(backendDir, 'requirements.lock')
    assert.ok(fs.existsSync(lockPath), 'requirements.lock must exist')
    const content = fs.readFileSync(lockPath, 'utf-8')
    assert.ok(content.includes('--hash=sha256:'), 'requirements.lock must contain SHA-256 hashes')
  })

  test('requirements-build.lock exists and locks PyInstaller and pip-tools with hashes', () => {
    const buildLockPath = path.join(backendDir, 'requirements-build.lock')
    assert.ok(fs.existsSync(buildLockPath), 'requirements-build.lock must exist')
    const content = fs.readFileSync(buildLockPath, 'utf-8')
    assert.ok(content.includes('pyinstaller'), 'must contain pyinstaller')
    assert.ok(content.includes('pip-tools'), 'must contain pip-tools')
    assert.ok(content.includes('--hash=sha256:'), 'requirements-build.lock must contain hashes')
  })

  test('jasper-backend.spec targets main.py and specifies onedir COLLECT output', () => {
    const specPath = path.join(backendDir, 'jasper-backend.spec')
    assert.ok(fs.existsSync(specPath), 'jasper-backend.spec must exist')
    const content = fs.readFileSync(specPath, 'utf-8')
    assert.ok(content.includes('main.py'), 'spec must target main.py')
    assert.ok(content.includes('COLLECT'), 'spec must specify COLLECT for onedir layout')
  })

  test('scripts/build-python-backend.ps1 validates Python 3.11 and outputs onedir sidecar', () => {
    const scriptPath = path.join(root, 'scripts/build-python-backend.ps1')
    assert.ok(fs.existsSync(scriptPath), 'scripts/build-python-backend.ps1 must exist')
    const content = fs.readFileSync(scriptPath, 'utf-8')
    assert.ok(content.includes('3.11'), 'script must validate Python 3.11')
    assert.ok(content.includes('requirements.lock'), 'script must reference requirements.lock')
    assert.ok(content.includes('requirements-build.lock'), 'script must reference requirements-build.lock')
  })

  test('package.json defines build:python and test:package commands', () => {
    const pkgPath = path.join(root, 'package.json')
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
    assert.ok(pkg.scripts && pkg.scripts['build:python'], 'package.json must define build:python')
    assert.ok(pkg.scripts && pkg.scripts['test:package'], 'package.json must define test:package')
  })

  test('compiled onedir executable exists and completes stdio handshake', async () => {
    const exePath = path.join(root, 'build', 'python-backend', 'jasper-backend', 'jasper-backend.exe')
    if (!fs.existsSync(exePath)) {
      assert.fail(`Sidecar executable not found at ${exePath}. Compiled artifact is required for test:package.`)
    }

    const { spawn } = await import('node:child_process')
    const proc = spawn(exePath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })

    const handshakePayload = JSON.stringify({
      version: 1,
      id: 'test-handshake-1',
      type: 'hello',
      payload: { client: 'super-jarvis-electron', protocolVersion: 1 }
    })
    const payloadBytes = Buffer.from(handshakePayload, 'utf-8')
    const frameHeader = Buffer.alloc(4)
    frameHeader.writeUInt32BE(payloadBytes.length, 0)
    proc.stdin.write(Buffer.concat([frameHeader, payloadBytes]))

    const response = await new Promise<any>((resolve, reject) => {
      let buffer = Buffer.alloc(0)
      const timeout = setTimeout(() => {
        proc.kill()
        reject(new Error('Timeout waiting for sidecar handshake response'))
      }, 15000)

      proc.stdout.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk])
        if (buffer.length >= 4) {
          const length = buffer.readUInt32BE(0)
          if (buffer.length >= 4 + length) {
            clearTimeout(timeout)
            const frameBody = buffer.subarray(4, 4 + length).toString('utf-8')
            proc.kill()
            resolve(JSON.parse(frameBody))
          }
        }
      })

      proc.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })

    assert.equal(response.version, 1)
    assert.equal(response.type, 'hello_ack')
    assert.equal(response.replyTo, 'test-handshake-1')
  })
})

