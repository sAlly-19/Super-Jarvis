const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { spawnSync } = require('node:child_process')
const project = path.resolve(__dirname, '..'), build = path.join(project, 'build', 'semantic-retrieval-gate')
fs.mkdirSync(build, { recursive: true })
const api = path.join(build, 'api.cjs')
require('esbuild').buildSync({ stdin: { resolveDir: project, contents: [
  "export { ModelFiles } from './src/main/memory/semantic/model-files'",
  "export { SemanticModelClient } from './src/main/memory/semantic/model-client'",
  "export { chunkSource } from './src/main/memory/semantic/chunker'",
  "export { MODEL_FINGERPRINT } from './src/main/memory/semantic/model-protocol'",
  "export { rankMemories } from './src/main/memory/semantic/retrieval'",
  "export { RETRIEVAL_POLICY } from './src/main/memory/semantic/retrieval-policy'"
].join('\n') }, outfile: api, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], logLevel: 'silent' })
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-retrieval-gate-'))
try {
  const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP'].filter(key => process.env[key]).map(key => [key, process.env[key]]))
  const result = spawnSync(require('electron'), [path.join(project, 'test/fixtures/semantic-memory/retrieval-host.cjs'), profile, api, path.join(project, 'build/semantic-gate/models')], { env, stdio: 'inherit', timeout: 60000 })
  if (result.error) console.error(result.error.message)
  process.exitCode = result.status ?? 1
} finally {
  if (path.dirname(profile) === fs.realpathSync(os.tmpdir()) && path.basename(profile).startsWith('jasper-retrieval-gate-')) {
    try { fs.rmSync(profile, { recursive: true, force: true }) } catch { /* Temporary Chromium handles may remain briefly. */ }
  }
}
