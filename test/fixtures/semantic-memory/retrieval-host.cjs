const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { app } = require('electron')
const [profile, api, cache] = process.argv.slice(2)
assert.ok(path.basename(profile).startsWith('jasper-retrieval-gate-'))
app.setPath('userData', path.join(profile, 'profile')); app.commandLine.appendSwitch('disable-gpu')
require('node:net').Socket.prototype.connect = function () { throw Error('gate_network_forbidden') }
globalThis.fetch = async () => { throw Error('gate_network_forbidden') }
let client
app.whenReady().then(async () => {
  const { ModelFiles, SemanticModelClient, chunkSource, rankMemories, RETRIEVAL_POLICY, MODEL_FINGERPRINT } = require(api)
  const file = fs.readFileSync(path.join(__dirname, 'relevance-pt-br.json')), fixture = JSON.parse(file)
  const scope = { signal: new AbortController().signal, deadline: Date.now() + 45000, check() {} }
  const files = new ModelFiles(cache); assert.equal(await files.verify(scope), true)
  client = new SemanticModelClient(path.resolve(__dirname, '../../../out/main/semantic-model-worker.js'), await files.location(scope))
  const inputs = []
  for (const source of fixture.sources) inputs.push(...await chunkSource(source, { generation: 0, revision: 0 }, client, scope))
  const vectors = await client.embed(inputs.map(chunk => chunk.text), scope), chunks = inputs.map((chunk, i) => ({ ...chunk, vector: vectors[i] }))
  const reports = []
  for (const entry of fixture.queries) {
    const [vector] = await client.embed([entry.query], scope)
    const hits = rankMemories(entry.query, chunks, vector, RETRIEVAL_POLICY)
    const top3 = hits.slice(0, 3).map(hit => hit.sourceId)
    const passed = entry.expected === null ? hits.length === 0 : top3.includes(entry.expected)
    const cosines = chunks.map(chunk => ({ sourceId: chunk.sourceId, cosine: chunk.vector.reduce((sum, value, i) => sum + value * vector[i], 0) }))
    reports.push({ query: entry.query, expected: entry.expected, passed, top3, cosines })
  }
  await client.stop()
  const ok = reports.every(report => report.passed)
  console.log(JSON.stringify({ ok, fixtureSha256: createHash('sha256').update(file).digest('hex'), modelFingerprint: MODEL_FINGERPRINT, policy: RETRIEVAL_POLICY, reports }))
  app.exit(ok ? 0 : 1)
}).catch(async () => { await client?.stop().catch(() => {}); console.log(JSON.stringify({ ok: false, code: 'retrieval_gate_failed' })); app.exit(1) })
