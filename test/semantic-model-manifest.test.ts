import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SEMANTIC_MODEL_MANIFEST } from '../src/main/memory/semantic/model-manifest'
import { validateModelManifest, modelFingerprint } from '../src/main/memory/semantic/model-manifest-validator'

test('semantic model uses the authorized Apache-declared conversion and rejects the retired repository', () => {
  assert.equal(SEMANTIC_MODEL_MANIFEST.modelId, 'onnx-community/paraphrase-multilingual-MiniLM-L12-v2-ONNX')
  assert.equal(SEMANTIC_MODEL_MANIFEST.revision, 'd4c06bf0d7680171ac30042a1387e1fdb7a90021')
  assert.throws(() => validateModelManifest({ ...SEMANTIC_MODEL_MANIFEST, modelId: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', revision: '2c4055b12046f11709e9df2c122e59ffbdc2f900' }), /invalid_model_manifest/)
})
test('semantic model manifest pins one complete immutable variant with exact hashes', () => {
  const manifest = validateModelManifest(SEMANTIC_MODEL_MANIFEST)
  assert.match(manifest.revision, /^[a-f0-9]{40}$/)
  assert.equal(manifest.assets.filter(a => a.path.endsWith('.onnx')).length, 1)
  assert.equal(manifest.assets.find(a => a.path.endsWith('.onnx'))!.path, 'onnx/model_int8.onnx')
  assert.ok(manifest.assets.reduce((sum, a) => sum + a.bytes, 0) < 192 * 1024 * 1024)
  assert.match(modelFingerprint(manifest), /^[a-f0-9]{64}$/)
  assert.equal(modelFingerprint(manifest), modelFingerprint(structuredClone(manifest)))
})
test('semantic model manifest rejects dynamic revision, unexpected files, paths, hashes and budgets', () => {
  const original = structuredClone(SEMANTIC_MODEL_MANIFEST)
  const first = original.assets[0]
  const invalid = [{ ...original, revision: 'main' }, { ...original, modelId: 'another/model' }, { ...original, extra: true },
    ...['../model.onnx', 'https://example.org/m', 'a\\b', '/etc/passwd', 'code.js'].map(path => ({ ...original, assets: [{ ...first, path }] })),
    { ...original, assets: [...original.assets, first] }, { ...original, assets: [{ ...first, sha256: 'bad' }] },
    { ...original, assets: [{ ...first, bytes: 161 * 1024 * 1024 }] }, { ...original, dimensions: 768 }]
  for (const value of invalid) assert.throws(() => validateModelManifest(value), /invalid_model_manifest/)
})
