const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { buildSync } = require('esbuild')
const root = path.resolve(__dirname, '..')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-health-native-'))
try {
  const entry = path.join(temporary, 'health.cjs'), profile = path.join(temporary, 'profile')
  fs.mkdirSync(profile)
  buildSync({ entryPoints: [path.join(root, 'test/fixtures/pc-health-native.ts')], outfile: entry, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] })
  const env = { ...process.env, APPDATA: temporary }; delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(path.join(root, 'node_modules/electron/dist/electron.exe'), [entry, profile, root, process.argv.includes('--packaged') ? 'yes' : 'no'], { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 40000 })
  process.stdout.write(result.stdout || '')
  if (result.status !== 0) process.stderr.write(result.stderr || String(result.error || 'Native health test failed'))
  process.exitCode = result.status === 0 ? 0 : 1
} finally { fs.rmSync(temporary, { recursive: true, force: true }) }
