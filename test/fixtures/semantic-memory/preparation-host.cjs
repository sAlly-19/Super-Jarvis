const path = require('node:path')
const assert = require('node:assert/strict')
const { app } = require('electron')
const [profile, apiFile, cache, mode] = process.argv.slice(2)
assert.ok(path.basename(profile).startsWith('jasper-semantic-prepare-'))
app.setPath('userData', path.join(profile, 'profile'))
app.commandLine.appendSwitch('disable-gpu')
let preparation
app.whenReady().then(async () => {
  const { ModelFiles, ModelPreparation, ArtifactHttpTransport, SemanticModelClient } = require(apiFile)
  const files = new ModelFiles(cache), scope = { signal: new AbortController().signal, deadline: Date.now() + 600000, check() {} }
  const probe = async (root, currentScope) => {
    const client = new SemanticModelClient(path.resolve(__dirname, '../../../out/main/semantic-model-worker.js'), root)
    try { await client.embed(['Teste de memória local.'], currentScope); const counts = await client.count(['Teste de memória local.'], currentScope); assert.ok(counts[0] > 0) }
    finally { await client.stop() }
  }
  preparation = new ModelPreparation(files, mode === 'cache-only' ? { async download() { throw Error('network_forbidden_cache_gate') } } : new ArtifactHttpTransport(), probe)
  let last = ''
  preparation.onProgress(state => {
    const status = `${state.phase}:${Math.floor(state.downloadedBytes / state.totalBytes * 10) * 10}`
    if (status !== last) { last = status; console.log(JSON.stringify({ phase: state.phase, percent: Math.floor(state.downloadedBytes / state.totalBytes * 100), errorCode: state.errorCode })) }
  })
  await preparation.prepare(scope)
  assert.equal(preparation.state().phase, 'ready')
  const modelRoot = await files.location(scope)
  await preparation.stop()
  console.log(JSON.stringify({ ok: true, mode, modelRoot, bytes: preparation.state().totalBytes }))
  app.exit(0)
}).catch(async () => { console.log(JSON.stringify({ ok: false, state: preparation?.state() })); await preparation?.stop(); app.exit(1) })
