import { test } from 'node:test'
import assert from 'node:assert/strict'
import { memoryCorpus } from '../src/main/memory/semantic/corpus'
import { chunkSource } from '../src/main/memory/semantic/chunker'
import { SemanticIndexer } from '../src/main/memory/semantic/indexer'
import { SemanticIndexStore } from '../src/main/memory/semantic/index-store'
import { MODEL_FINGERPRINT } from '../src/main/memory/semantic/model-protocol'
import { semanticDatabase } from './fixtures/semantic-memory/database'
import { syntheticSource, testTokenizer, unitVector } from './fixtures/semantic-memory/corpus'
import { protection } from './fixtures/semantic-memory/source'
const scope = () => ({ signal: new AbortController().signal, deadline: Date.now() + 10000, check() {} })
test('semantic corpus preserves original texts with separate namespaced sources and Unicode-bounded chunks', async () => {
  const source = syntheticSource(), corpus = memoryCorpus(source.snapshot())
  assert.deepEqual(corpus.map(item => item.sourceId).sort(), ['fact:profile:name', 'profile:name', 'profile:preference:0'])
  assert.equal(corpus.find(item => item.kind === 'fact')!.text, 'Studio &amp; editor')
  const text = '👩🏽‍💻 "café" '.repeat(30), item = { sourceId: 'fact:unicode', kind: 'fact' as const, text }
  const chunks = await chunkSource(item, source.snapshot().token, testTokenizer, scope())
  assert.ok(chunks.length > 1)
  for (const chunk of chunks) { assert.ok(text.includes(chunk.text)); assert.ok((await testTokenizer.count([chunk.text]))[0] <= 96); assert.ok(!/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(chunk.text)) }
  assert.deepEqual(await chunkSource(item, source.snapshot().token, testTokenizer, scope()), chunks)
})
test('semantic chunk overlap counts the actual suffix including the final character', async () => {
  const tokenizer = { async count(texts: string[]) { return texts.map(text => Array.from(text).reduce((n, ch) => n + (ch === 'X' ? 20 : 1), 2)) } }
  const chunks = await chunkSource({ sourceId: 'fact:weighted', kind: 'fact', text: 'a'.repeat(74) + 'X' + 'b'.repeat(70) }, { generation: 0, revision: 0 }, tokenizer, scope())
  assert.equal(chunks[0].text.endsWith('X'), true)
  assert.equal(chunks[1].text.startsWith('b'), true, 'X alone exceeds overlap16, so overlap must be zero')
})
test('semantic indexer consolidates edits while embedding and never publishes the old source', async () => {
  const source = syntheticSource(), db = semanticDatabase(), index = new SemanticIndexStore(db, protection)
  let release!: () => void, entered!: () => void, first = true
  const started = new Promise<void>(resolve => { entered = resolve }), barrier = new Promise<void>(resolve => { release = resolve })
  const client = { async embed(texts: string[]) { if (first) { first = false; entered(); await barrier }; return texts.map(unitVector) }, async stop() {} }
  const indexer = new SemanticIndexer(source, client, index, testTokenizer)
  try {
    const work = indexer.rebuild(scope()); await started
    source.change('Nova preferência correta'); release(); await work
    const chunks = index.read(source.snapshot().token, MODEL_FINGERPRINT, () => {})!
    assert.ok(chunks.some(chunk => chunk.text === 'Nova preferência correta'))
    assert.ok(!chunks.some(chunk => chunk.text.includes('Studio')))
    source.change(); assert.equal(index.read(source.snapshot().token, MODEL_FINGERPRINT, () => {}), null)
  } finally { await indexer.stop(); db.close() }
})
test('semantic indexer cancellation preserves source and never finishes a late build', async () => {
  const source = syntheticSource(), original = source.snapshot(), db = semanticDatabase(), index = new SemanticIndexStore(db, protection)
  const controller = new AbortController()
  const indexer = new SemanticIndexer(source, { async embed(texts) { controller.abort(); return texts.map(unitVector) }, async stop() {} }, index, testTokenizer)
  try {
    await assert.rejects(indexer.rebuild({ ...scope(), signal: controller.signal }))
    assert.equal(index.read(original.token, MODEL_FINGERPRINT, () => {}), null)
    assert.deepEqual(source.snapshot(), original)
  } finally { await indexer.stop(); db.close() }
})
test('semantic indexer records synthetic small and large corpus costs without touching a real profile', async () => {
  for (const count of [10, 500]) {
    const source = syntheticSource(), original = source.snapshot()
    const snapshot = { ...original, memory: { ...original.memory, facts: Array.from({ length: count }, (_, i) => ({ id: `synthetic-${i}`, fact: `Projeto sintético número ${i}: preferência por TypeScript.`, createdAt: '2020-01-01' })) } }
    source.snapshot = () => structuredClone(snapshot)
    const db = semanticDatabase(), index = new SemanticIndexStore(db, protection)
    const indexer = new SemanticIndexer(source, { async embed(texts) { return texts.map(unitVector) }, async stop() {} }, index, testTokenizer)
    try {
      const heap = process.memoryUsage().heapUsed, start = performance.now()
      await indexer.rebuild(scope())
      assert.equal(index.read(snapshot.token, MODEL_FINGERPRINT, () => {})!.length, count + 2)
      console.log(JSON.stringify({ syntheticFacts: count, elapsedMs: performance.now() - start, heapDeltaBytes: process.memoryUsage().heapUsed - heap, fakeCryptoAndEmbeddings: true }))
    } finally { await indexer.stop(); db.close() }
  }
})
