import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createDevelopmentLaunch,
  resolveDevelopmentPython,
  superviseDevelopmentChild
} from './development-python.mjs'

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptsDir, '..')

try {
  const pythonExecutable = resolveDevelopmentPython({ projectRoot })

  if (process.argv.includes('--check')) {
    console.log(`[dev] Python 3.11 ready: ${pythonExecutable}`)
  } else {
    console.log(`[dev] Starting Electron with Python 3.11: ${pythonExecutable}`)
    const extraArgs = process.argv.slice(2)
    const launch = createDevelopmentLaunch(pythonExecutable, { projectRoot, extraArgs })
    const child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      env: launch.env,
      shell: launch.shell,
      stdio: 'inherit',
      windowsHide: true
    })

    superviseDevelopmentChild(child)
  }
} catch (error) {
  console.error(`[dev] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
