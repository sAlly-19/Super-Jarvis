// Phase02 containment gate, not a mock of a completed browser implementation.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-web-gate-'))
const evidence = path.join(root, '.superpowers/sdd/2026-10-29-web-research-02-reader-browser/gate-probe')
fs.mkdirSync(evidence, { recursive: true })
try {
  const env = {}
  for (const key of ['PATH', 'SystemRoot', 'SystemDrive', 'WINDIR', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA']) {
    if (process.env[key]) env[key] = process.env[key]
  }
  const output = path.join(temporary, 'result.json')
  const result = spawnSync(require('electron'), [path.join(root, 'test/fixtures/web/browser-host.cjs'),
    path.join(temporary, 'profile'), output, 'enable-feature'], { env, cwd: root, windowsHide: true, encoding: 'utf8', timeout: 15000 })
  assert.equal(result.status, 0, result.error?.message || result.stderr || 'Probe failed to exit')
  assert.ok(fs.existsSync(output), 'Process exit alone does not prove a completed probe')
  const report = JSON.parse(fs.readFileSync(output, 'utf8'))
  fs.writeFileSync(path.join(evidence, 'gate-result.json'), JSON.stringify(report, null, 2))
  const denied = report.reports.find(item => item.mode === 'connection-allowlist')
  assert.equal(denied.result.rendered, 'Rendered', 'JavaScript fixture did not run')
  assert.equal(denied.result.node, 'undefined', 'Remote content exposed Node')
  assert.equal(denied.result.bridge, 'undefined', 'Remote content exposed application bridge')
  assert.equal(denied.result.fetchSucceeded, false, 'Deny-all connection header was not enforced on the intercepted document')
  assert.ok(['absent', 'failed'].includes(denied.result.rtc), 'WebRTC was not blocked')
  assert.equal(denied.result.webTransport, 'undefined', 'Unmediated WebTransport remains exposed')
  console.log('WEB_BROWSER_GATE_PASS')
} catch (error) {
  console.error('WEB_BROWSER_GATE_FAILED: ' + error.message)
  process.exitCode = 1
} finally {
  const resolved = fs.realpathSync(temporary)
  if (!resolved.startsWith(fs.realpathSync(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('jasper-web-gate-')) throw new Error('Unsafe test profile path')
  fs.rmSync(resolved, { recursive: true, force: true })
}
