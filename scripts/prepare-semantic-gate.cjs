// Explicit development acceptance only; the installed application never imports this script.
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const project = path.resolve(__dirname, '..'), build = path.join(project, 'build', 'semantic-gate')
fs.mkdirSync(build, { recursive: true })
const api = path.join(build, 'gate-api.cjs')
require('esbuild').buildSync({ stdin: { contents: [
  "export { ModelFiles } from './src/main/memory/semantic/model-files'",
  "export { ModelPreparation } from './src/main/memory/semantic/model-preparation'",
  "export { ArtifactHttpTransport } from './src/main/memory/semantic/artifact-transport'",
  "export { SemanticModelClient } from './src/main/memory/semantic/model-client'"
].join('\n'), resolveDir: project }, outfile: api, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], logLevel: 'silent' })
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-semantic-prepare-'))
try {
  const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP'].filter(key => process.env[key]).map(key => [key, process.env[key]]))
  const result = spawnSync(require('electron'), [path.join(project, 'test/fixtures/semantic-memory/preparation-host.cjs'), profile, api, path.join(build, 'models'), process.argv.includes('--cache-only') ? 'cache-only' : 'prepare'], { env, stdio: 'inherit', timeout: 650000 })
  if (result.error) console.error(result.error.message)
  process.exitCode = result.status ?? 1
} finally {
  if (path.dirname(profile) === fs.realpathSync(os.tmpdir()) && path.basename(profile).startsWith('jasper-semantic-prepare-')) {
    try { fs.rmSync(profile, { recursive: true, force: true }) } catch { /* Chromium can retain temporary profile handles briefly. */ }
  }
}
