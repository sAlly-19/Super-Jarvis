import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

function resolvePython() {
  if (process.env.JASPER_PYTHON_EXECUTABLE && existsSync(process.env.JASPER_PYTHON_EXECUTABLE)) {
    return process.env.JASPER_PYTHON_EXECUTABLE
  }

  const uvPython = path.join(
    process.env.APPDATA || '',
    'uv',
    'python',
    'cpython-3.11.15-windows-x86_64-none',
    'python.exe'
  )
  if (existsSync(uvPython)) {
    return uvPython
  }

  const py314 = path.join(
    process.env.LOCALAPPDATA || '',
    'Python',
    'pythoncore-3.14-64',
    'python.exe'
  )
  if (existsSync(py314)) {
    return py314
  }

  return 'python'
}

const pythonExe = resolvePython()
const testsDir = path.join(rootDir, 'jasper-backend', 'tests')
console.log(`[test:python] Running Python unittests with ${pythonExe}...`)

const res = spawnSync(pythonExe, ['-m', 'unittest', 'discover', '-s', testsDir, '-v'], {
  cwd: rootDir,
  stdio: 'inherit'
})

process.exit(res.status ?? 0)
