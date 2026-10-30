import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SemanticMemoryService } from '../src/main/memory/semantic/service'
import { SemanticIndexStore } from '../src/main/memory/semantic/index-store'
import { SemanticIndexer } from '../src/main/memory/semantic/indexer'
import { semanticDatabase } from './fixtures/semantic-memory/database'
import { protection } from './fixtures/semantic-memory/source'
import { syntheticSource, testTokenizer, unitVector } from './fixtures/semantic-memory/corpus'
const scope = () => ({ signal: new AbortController().signal, deadline: Date.now() + 10000, check() {} })
function fixture() {
  const source = syntheticSource(), db = semanticDatabase(), index = new SemanticIndexStore(db, protection)
  let available = true, allowed = true, embeddings = 0
  const client = { async embed(texts: string[]) { embeddings++; return texts.map(unitVector) }, async stop() {} }
  const indexer = new SemanticIndexer(source, client, index, testTokenizer)
  const service = new SemanticMemoryService({ source, index, indexer, client,
    modelState: () => ({ phase: available ? 'ready' as const : 'not_prepared' as const }), authorize() { if (!allowed) throw Error('revoked') }, now: Date.now })
  return { source, db, index, indexer, service, client, unavailable() { available = false }, revoke() { allowed = false }, get embeddings() { return embeddings } }
}
test('semantic service labels textual fallback and never prepares or embeds when model is unavailable', async () => {
  const f = fixture(); f.unavailable()
  try {
    const result = await f.service.recall('Studio', scope())
    assert.equal(result.mode, 'text_only'); assert.ok(result.hits.some(hit => hit.text.includes('&amp;'))); assert.equal(f.embeddings, 0)
    f.revoke(); await assert.rejects(f.service.recall('Studio', scope()), /revoked/)
  } finally { await f.service.stop(); f.db.close() }
})
test('semantic service discards old embeddings after edit and returns only current text or memory_changed', async () => {
  const f = fixture()
  try {
    await f.service.reindex(scope())
    f.client.embed = async texts => { f.source.change('Novo Studio correto'); return texts.map(unitVector) }
    const result = await f.service.recall('Studio', scope())
    assert.equal(result.mode, 'text_only'); assert.ok(result.hits.every(hit => !hit.text.includes('&amp;')))
    assert.equal(result.token?.revision, f.source.snapshot().token.revision)
  } finally { await f.service.stop(); f.db.close() }
})
test('semantic service fails closed on protected source failure and does not use the derived index as source', async () => {
  const f = fixture()
  try {
    await f.service.reindex(scope()); f.source.snapshot = () => { throw Error('protected_source_unavailable') }
    const result = await f.service.recall('Ana', scope())
    assert.equal(result.mode, 'unavailable'); assert.equal(result.token, null); assert.deepEqual(result.hits, [])
  } finally { await f.service.stop(); f.db.close() }
})
test('semantic service permits only one refresh when source changes again during delivery', async () => {
  const f = fixture()
  try {
    await f.service.reindex(scope())
    const snapshot = f.source.snapshot.bind(f.source); let reads = 0
    f.source.snapshot = () => { reads++; if (reads === 2 || reads === 3) f.source.change(`Studio revisão ${reads}`); return snapshot() }
    await assert.rejects(f.service.recall('Studio', scope()), /memory_changed/)
  } finally { await f.service.stop(); f.db.close() }
})
test('semantic recall times out a stalled embedding and returns explicit current textual fallback', async () => {
  const f = fixture()
  try {
    await f.service.reindex(scope())
    f.client.embed = async () => new Promise<number[][]>(() => {})
    const result = await f.service.recall('Studio', scope())
    assert.equal(result.mode, 'text_only'); assert.equal(result.warningCode, 'embedding_unavailable')
    assert.ok(result.hits.some(hit => hit.sourceId === 'fact:profile:name'))
  } finally { await f.service.stop(); f.db.close() }
})
test('semantic service rechecks authorization after embedding before exposing any source', async () => {
  const f = fixture()
  try {
    await f.service.reindex(scope())
    f.client.embed = async texts => { f.revoke(); return texts.map(unitVector) }
    await assert.rejects(f.service.recall('Studio', scope()), /revoked/)
  } finally { await f.service.stop(); f.db.close() }
})
test('semantic textual fallback retains the matching tail of a long fact within output budgets', async () => {
  const f = fixture(); f.unavailable()
  try {
    f.source.change('Histórico antigo. '.repeat(200) + 'Meu projeto atual é Abacaxi.')
    const result = await f.service.recall('Abacaxi', scope())
    assert.equal(result.mode, 'text_only'); assert.ok(result.hits.some(hit => hit.text.includes('Abacaxi')))
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 6144)
  } finally { await f.service.stop(); f.db.close() }
})
