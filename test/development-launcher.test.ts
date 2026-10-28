import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { EventEmitter } from 'node:events'

interface PythonInspection {
  canonicalPath: string
  version: string
}

interface DevelopmentPythonModule {
  resolveDevelopmentPython(options: {
    env?: NodeJS.ProcessEnv
    configuredPath?: string
    candidates?: string[]
    inspectPython?: (candidate: string) => PythonInspection | null
  }): string
  createDevelopmentLaunch(pythonExecutable: string, options: {
    projectRoot: string
    baseEnv: NodeJS.ProcessEnv
    nodeExecutable: string
    extraArgs?: string[]
  }): {
    command: string
    args: string[]
    cwd: string
    env: NodeJS.ProcessEnv
    shell: boolean
  }
  superviseDevelopmentChild(child: EventEmitter & { killed: boolean; kill(signal: string): boolean }, host: EventEmitter & {
    exitCode?: number
  }): () => void
}

async function loadDevelopmentPythonModule(): Promise<DevelopmentPythonModule> {
  const modulePath = path.join(process.cwd(), 'scripts', 'development-python.mjs')
  assert.equal(existsSync(modulePath), true, 'secure development Python resolver must exist')
  return import(pathToFileURL(modulePath).href) as Promise<DevelopmentPythonModule>
}

describe('secure development Python bootstrap', () => {
  test('prefers and canonicalizes an explicit validated Python 3.11 executable', async () => {
    const { resolveDevelopmentPython } = await loadDevelopmentPythonModule()
    const inspected: string[] = []
    const resolved = resolveDevelopmentPython({
      configuredPath: 'C:\\configured\\python.exe',
      candidates: ['C:\\fallback\\python.exe'],
      inspectPython: (candidate) => {
        inspected.push(candidate)
        return { canonicalPath: 'C:\\canonical\\python.exe', version: '3.11.9' }
      }
    })

    assert.equal(resolved, 'C:\\canonical\\python.exe')
    assert.deepEqual(inspected, ['C:\\configured\\python.exe'])
  })

  test('selects a deterministic Python 3.11 candidate when no override is configured', async () => {
    const { resolveDevelopmentPython } = await loadDevelopmentPythonModule()
    const resolved = resolveDevelopmentPython({
      env: {},
      candidates: ['C:\\missing\\python.exe', 'C:\\trusted\\python.exe'],
      inspectPython: (candidate) => candidate.includes('trusted')
        ? { canonicalPath: 'C:\\trusted\\python.exe', version: '3.11.9' }
        : null
    })

    assert.equal(resolved, 'C:\\trusted\\python.exe')
  })

  test('rejects an explicit executable that is not Python 3.11 without falling back', async () => {
    const { resolveDevelopmentPython } = await loadDevelopmentPythonModule()

    assert.throws(() => resolveDevelopmentPython({
      configuredPath: 'C:\\configured\\python.exe',
      candidates: ['C:\\fallback\\python.exe'],
      inspectPython: () => ({ canonicalPath: 'C:\\configured\\python.exe', version: '3.12.1' })
    }), /Python 3\.11.*required/i)
  })

  test('rejects a whitespace-only explicit override without inspecting fallback candidates', async () => {
    const { resolveDevelopmentPython } = await loadDevelopmentPythonModule()
    const inspected: string[] = []

    assert.throws(() => resolveDevelopmentPython({
      configuredPath: '   ',
      candidates: ['C:\\fallback\\python.exe'],
      inspectPython: (candidate) => {
        inspected.push(candidate)
        return { canonicalPath: candidate, version: '3.11.9' }
      }
    }), /JASPER_PYTHON_EXECUTABLE.*non-empty/i)
    assert.deepEqual(inspected, [])
  })

  test('creates a shell-free local Electron Vite launch with the canonical Python path', async () => {
    const { createDevelopmentLaunch } = await loadDevelopmentPythonModule()
    const projectRoot = path.resolve('C:\\repo')
    const launch = createDevelopmentLaunch('C:\\canonical\\python.exe', {
      projectRoot,
      baseEnv: { EXISTING: 'preserved' },
      nodeExecutable: 'C:\\node\\node.exe',
      extraArgs: ['--host', '127.0.0.1']
    })

    assert.equal(launch.command, 'C:\\node\\node.exe')
    assert.deepEqual(launch.args, [
      path.join(projectRoot, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js'),
      'dev',
      '--host',
      '127.0.0.1'
    ])
    assert.equal(launch.cwd, projectRoot)
    assert.equal(launch.env.JASPER_PYTHON_EXECUTABLE, 'C:\\canonical\\python.exe')
    assert.equal(launch.env.EXISTING, 'preserved')
    assert.equal(launch.shell, false)
  })

  test('npm development command uses the secure launcher', () => {
    const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'))
    assert.equal(packageJson.scripts.dev, 'node scripts/run-development.mjs')
  })

  test('forwards termination to the child and preserves signal exit semantics', async () => {
    const { superviseDevelopmentChild } = await loadDevelopmentPythonModule()
    assert.equal(typeof superviseDevelopmentChild, 'function')

    const host = new EventEmitter() as EventEmitter & { exitCode?: number }
    const signals: string[] = []
    const child = new EventEmitter() as EventEmitter & {
      killed: boolean
      kill(signal: string): boolean
    }
    child.killed = false
    child.kill = (signal) => {
      signals.push(signal)
      child.killed = true
      return true
    }

    superviseDevelopmentChild(child, host)
    host.emit('SIGTERM')
    assert.deepEqual(signals, ['SIGTERM'])

    child.emit('exit', null, 'SIGTERM')
    assert.equal(host.exitCode, 143)
    assert.equal(host.listenerCount('SIGTERM'), 0)
  })
})
