import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rankMemories, fitRecall } from '../src/main/memory/semantic/retrieval'
import { RETRIEVAL_POLICY } from '../src/main/memory/semantic/retrieval-policy'
import { unitVector } from './fixtures/semantic-memory/corpus'
import { MODEL_FINGERPRINT } from '../src/main/memory/semantic/model-protocol'
const chunk = (sourceId = 'fact:a', text = 'Prefiro café sem açúcar.') => ({ id: 'a'.repeat(64), sourceId, text, kind: 'fact' as const, generation: 0, sourceRevision: 0, modelFingerprint: MODEL_FINGERPRINT, vector: unitVector() })
test('semantic ranking combines relevant semantics and literal identifiers without duplicating sources', () => {
  const orthogonal = unitVector(); orthogonal[0] = 0; orthogonal[1] = 1
  const input = [chunk(), { ...chunk(), id: 'b'.repeat(64) }, { ...chunk('fact:studio', 'Visual Studio Code'), vector: orthogonal }]
  assert.deepEqual(rankMemories('Como gosto de beber pela manhã?', input, unitVector(), RETRIEVAL_POLICY).map(item => item.sourceId), ['fact:a'])
  assert.equal(rankMemories('Visual Studio Code', input, null, RETRIEVAL_POLICY)[0].sourceId, 'fact:studio')
  assert.equal(rankMemories('CAFÉ', input, null, RETRIEVAL_POLICY)[0].text, input[0].text)
  assert.deepEqual(rankMemories('de e para', input, unitVector(), RETRIEVAL_POLICY), [])
  assert.deepEqual(rankMemories('bicicleta pneu', input.map(item => ({ ...item, vector: orthogonal })), unitVector(), RETRIEVAL_POLICY), [])
})
test('semantic output budget counts escaped JSON and preserves Unicode with at most eight unique sources', () => {
  const result = fitRecall({ mode: 'text_only', token: { generation: 0, revision: 1 }, warningCode: 'model_not_ready', hits: Array.from({ length: 12 }, (_, i) => ({ sourceId: `fact:${i}`, sourceRevision: 1, kind: 'fact' as const, text: '👩🏽‍💻"\n'.repeat(1000), score: 0.8 })) })
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 6144); assert.ok(result.hits.length <= 8)
  for (const hit of result.hits) { assert.ok(Buffer.byteLength(hit.text) <= 2000); assert.ok(!/[\uD800-\uDBFF]$/.test(hit.text)) }
})
test('semantic literal matches require whole names rather than substrings in unrelated words', () => {
  const unrelated = chunk('fact:banana', 'Prefiro banana no café da manhã.'), orthogonal = unitVector()
  orthogonal[0] = 0; orthogonal[1] = 1; unrelated.vector = orthogonal
  for (const vector of [null, unitVector()]) assert.deepEqual(rankMemories('Ana', [unrelated], vector, RETRIEVAL_POLICY), [])
  assert.equal(rankMemories('Ana', [{ ...chunk(), sourceId: 'profile:name', kind: 'name', text: 'Ana' }], null, RETRIEVAL_POLICY).length, 1)
})
