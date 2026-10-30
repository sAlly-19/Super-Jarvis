const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-semantic-gate-'))
try {
  const fingerprintFile = path.join(root, 'fingerprint.cjs')
  require('esbuild').buildSync({ entryPoints: [path.resolve(__dirname, '../src/main/memory/semantic/model-protocol.ts')], outfile: fingerprintFile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
  const { MODEL_FINGERPRINT } = require(fingerprintFile)
  const index = process.argv.indexOf('--model-root')
  const modelRoot = index < 0 ? path.join(root, 'absent') : path.resolve(process.argv[index + 1])
  const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP'].filter(key => process.env[key]).map(key => [key, process.env[key]]))
  const result = spawnSync(require('electron'), [path.resolve(__dirname, '../test/fixtures/semantic-memory/worker-host.cjs'), root, modelRoot, MODEL_FINGERPRINT, index < 0 ? 'absent' : 'real'], { env, encoding: 'utf8', timeout: 60000 })
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '')
  if (result.error) console.error(result.error.message)
  process.exitCode = result.status ?? 1
} finally {
  if (path.dirname(root) === fs.realpathSync(os.tmpdir()) && path.basename(root).startsWith('jasper-semantic-gate-')) fs.rmSync(root, { recursive: true, force: true })
}
