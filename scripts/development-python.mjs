import { existsSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const REQUIRED_PYTHON_VERSION = /^3\.11(?:\.|$)/

function inspectPythonExecutable(candidate) {
  if (!candidate || !path.isAbsolute(candidate) || !existsSync(candidate)) return null

  try {
    if (!statSync(candidate).isFile()) return null
    const canonicalPath = realpathSync(candidate)
    const probe = spawnSync(
      canonicalPath,
      ['-c', 'import sys; print(".".join(map(str, sys.version_info[:3])))'],
      { encoding: 'utf8', windowsHide: true, timeout: 10_000 }
    )
    if (probe.status !== 0) return null
    return { canonicalPath, version: probe.stdout.trim() }
  } catch {
    return null
  }
}

function defaultCandidates(projectRoot, env, platform) {
  const candidates = []
  if (platform === 'win32') {
    candidates.push(path.join(projectRoot, 'build', 'python-backend', '.venv', 'Scripts', 'python.exe'))
    if (env.LOCALAPPDATA) {
      candidates.push(path.join(env.LOCALAPPDATA, 'Programs', 'Python', 'Python311', 'python.exe'))
    }
    if (env.APPDATA) {
      candidates.push(path.join(env.APPDATA, 'uv', 'python', 'cpython-3.11.15-windows-x86_64-none', 'python.exe'))
    }
  } else {
    candidates.push(path.join(projectRoot, 'build', 'python-backend', '.venv', 'bin', 'python3.11'))
  }
  return candidates
}

function assertPython311(inspection, source) {
  if (!inspection || !REQUIRED_PYTHON_VERSION.test(inspection.version)) {
    const version = inspection?.version || 'unavailable'
    throw new Error(`Python 3.11 is required for development (${source}; detected: ${version}).`)
  }
  return inspection.canonicalPath
}

export function resolveDevelopmentPython(options = {}) {
  const env = options.env || process.env
  const projectRoot = options.projectRoot || process.cwd()
  const inspectPython = options.inspectPython || inspectPythonExecutable
  const rawConfiguredPath = options.configuredPath !== undefined
    ? options.configuredPath
    : env.JASPER_PYTHON_EXECUTABLE

  if (rawConfiguredPath !== undefined) {
    const configuredPath = rawConfiguredPath.trim()
    if (!configuredPath) {
      throw new Error('JASPER_PYTHON_EXECUTABLE must be a non-empty absolute path to Python 3.11.')
    }
    return assertPython311(inspectPython(configuredPath), 'JASPER_PYTHON_EXECUTABLE')
  }

  const candidates = options.candidates || defaultCandidates(projectRoot, env, options.platform || process.platform)
  for (const candidate of candidates) {
    const inspection = inspectPython(candidate)
    if (inspection && REQUIRED_PYTHON_VERSION.test(inspection.version)) {
      return inspection.canonicalPath
    }
  }

  throw new Error(
    'Python 3.11 was not found in the deterministic development locations. ' +
    'Run npm.cmd run build:python or set JASPER_PYTHON_EXECUTABLE to an absolute Python 3.11 executable.'
  )
}

export function createDevelopmentLaunch(pythonExecutable, options = {}) {
  const projectRoot = options.projectRoot || process.cwd()
  const baseEnv = options.baseEnv || process.env
  const nodeExecutable = options.nodeExecutable || process.execPath
  const extraArgs = options.extraArgs || []

  return {
    command: nodeExecutable,
    args: [
      path.join(projectRoot, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js'),
      'dev',
      ...extraArgs
    ],
    cwd: projectRoot,
    env: {
      ...baseEnv,
      JASPER_PYTHON_EXECUTABLE: pythonExecutable
    },
    shell: false
  }
}

const SIGNAL_EXIT_CODES = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143
}

export function superviseDevelopmentChild(child, host = process, options = {}) {
  const signals = options.signals || ['SIGHUP', 'SIGINT', 'SIGTERM']
  const logError = options.logError || ((message) => console.error(message))
  const signalHandlers = new Map()

  const cleanup = () => {
    for (const [signal, handler] of signalHandlers) {
      host.removeListener(signal, handler)
    }
    signalHandlers.clear()
  }

  for (const signal of signals) {
    const handler = () => {
      if (!child.killed) {
        try {
          child.kill(signal)
        } catch (error) {
          logError(`[dev] Failed to forward ${signal}: ${error instanceof Error ? error.message : String(error)}`)
          host.exitCode = 1
        }
      }
    }
    signalHandlers.set(signal, handler)
    host.on(signal, handler)
  }

  child.once('error', (error) => {
    cleanup()
    logError(`[dev] Failed to start Electron Vite: ${error.message}`)
    host.exitCode = 1
  })
  child.once('exit', (code, signal) => {
    cleanup()
    host.exitCode = typeof code === 'number'
      ? code
      : (SIGNAL_EXIT_CODES[signal] || 1)
  })

  return cleanup
}
