import { spawnSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import { resolveDevelopmentPython } from './development-python.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

const pythonExe = resolveDevelopmentPython({ projectRoot: rootDir })
const testsDir = path.join(rootDir, 'jasper-backend', 'tests')
console.log(`[test:python] Running Python unittests with ${pythonExe}...`)

const res = spawnSync(pythonExe, ['-m', 'unittest', 'discover', '-s', testsDir, '-v'], {
  cwd: rootDir,
  stdio: 'inherit'
})

if (res.error) console.error(`[test:python] ${res.error.message}`)
process.exit(res.status ?? 1)
