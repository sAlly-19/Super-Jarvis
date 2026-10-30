import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { verifyModelAssets, ModelFileTransaction } from '../src/main/memory/semantic/model-files'
import { finished } from 'node:stream/promises'
const scope = () => ({ signal: new AbortController().signal, deadline: Date.now() + 2000, check() {} })
const asset = { path: 'config.json', bytes: 2, sha256: createHash('sha256').update('{}').digest('hex') }
test('semantic model files require exact bytes, hashes and a closed local directory', async () => {
  const root = mkdtempSync(join(tmpdir(), 'jasper-model-files-'))
  try {
    writeFileSync(join(root, 'config.json'), '{}')
    assert.equal(await verifyModelAssets(root, [asset], scope()), true)
    writeFileSync(join(root, 'extra.js'), 'code')
    assert.equal(await verifyModelAssets(root, [asset], scope()), false)
    rmSync(join(root, 'extra.js')); writeFileSync(join(root, 'config.json'), '[]')
    assert.equal(await verifyModelAssets(root, [asset], scope()), false)
    assert.equal(await verifyModelAssets(root, [{ ...asset, path: '../config.json' }], scope()), false)
    const controller = new AbortController(); controller.abort()
    await assert.rejects(verifyModelAssets(root, [asset], { ...scope(), signal: controller.signal }))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test('semantic model files refuse directory junctions and absent files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'jasper-model-files-'))
  try {
    assert.equal(await verifyModelAssets(join(root, 'missing'), [asset], scope()), false)
    const target = join(root, 'target'); mkdirSync(target); writeFileSync(join(target, 'config.json'), '{}')
    symlinkSync(target, join(root, 'link'), 'junction')
    assert.equal(await verifyModelAssets(join(root, 'link'), [asset], scope()), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test('semantic model publication preserves prior pointer until a verified, authorized atomic switch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'jasper-model-files-'))
  const files = new ModelFileTransaction(root, [asset], 'f'.repeat(64))
  try {
    assert.equal(await files.verify(scope()), false)
    const first = await files.createStaging(scope()), writer = await files.writer(first, asset, scope())
    writer.end('{}'); await finished(writer)
    await files.publish(first, scope()); const location = await files.location(scope())
    assert.equal(await files.verify(scope()), true)
    const second = await files.createStaging(scope()), nextWriter = await files.writer(second, asset, scope())
    nextWriter.end('{}'); await finished(nextWriter)
    await assert.rejects(files.publish(second, { ...scope(), check() { throw Error('revoked') } }), /revoked/)
    assert.equal(await files.location(scope()), location)
    await files.discard(second)
    await assert.rejects(files.discard(root), /model_staging_invalid/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test('semantic model cleanup handles a staging directory cancelled before any file was written', async () => {
  const root = mkdtempSync(join(tmpdir(), 'jasper-model-files-'))
  const files = new ModelFileTransaction(root, [{ ...asset, path: 'onnx/model_int8.onnx' }], 'f'.repeat(64))
  try { await files.discard(await files.createStaging(scope())) }
  finally { rmSync(root, { recursive: true, force: true }) }
})
