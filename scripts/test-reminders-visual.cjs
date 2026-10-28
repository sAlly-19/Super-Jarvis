// Isolated Electron test of the real reminder window. Never loads the user's profile.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { buildSync } = require('esbuild')
const root = path.resolve(__dirname, '..')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-reminder-visual-'))
try {
  const entry = path.join(temporary, 'visual.cjs')
  const profile = path.join(temporary, 'profile')
  fs.mkdirSync(profile)
  fs.mkdirSync(path.join(root, '.cache'), { recursive: true })
  buildSync({ entryPoints: [path.join(root, 'test/fixtures/reminders/visual-notification.ts')], outfile: entry, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] })
  const env = { ...process.env, APPDATA: temporary }
  delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(path.join(root, 'node_modules/electron/dist/electron.exe'), [entry, profile, root, path.join(root, '.cache/reminder-fix-popup.png')], { cwd: root, env, encoding: 'utf8', timeout: 20000, windowsHide: true })
  process.stdout.write(result.stdout || '')
  if (result.status !== 0) process.stderr.write(result.stderr || String(result.error || 'Visual notification test failed'))
  process.exitCode = result.status === 0 ? 0 : 1
} finally {
  fs.rmSync(temporary, { recursive: true, force: true })
}
