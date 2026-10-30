import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { PermanentMemoryStore } from '../src/main/memory/semantic/permanent-store'
import { LegacyMemoryAdapter } from '../src/main/memory/semantic/legacy-adapter'
import { installationId, oldMemory, protection } from './fixtures/semantic-memory/source'
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-semantic-adapter-')), filePath = path.join(root, 'memory.json')
  fs.writeFileSync(filePath, JSON.stringify(oldMemory()))
  const source = new PermanentMemoryStore({ filePath, installationId, protection, authorize() {}, now: () => '2026-10-30T12:00:00.000Z', id: randomUUID })
  return { source, adapter: new LegacyMemoryAdapter(source, () => '2026-10-30T12:00:00.000Z'), filePath, close() {
    const target = fs.realpathSync(root), parent = fs.realpathSync(os.tmpdir())
    assert.ok(target.startsWith(parent + path.sep) && path.basename(target).startsWith('jasper-semantic-adapter-'))
    fs.rmSync(target, { recursive: true, force: true })
  } }
}
test('legacy adapter preserves old facts, sanitizes new facts once and deduplicates only identical normalized text', () => {
  const f = fixture()
  try {
    const loaded = f.adapter.load()
    assert.deepEqual(loaded, oldMemory())
    loaded.userName = 'Changed name'; f.adapter.save(loaded)
    assert.equal(f.adapter.load().facts[0].fact, oldMemory().facts[0].fact)
    const first = f.adapter.upsertFacts([{ fact: 'Prefiro café & chá', id: 'forged', createdAt: '2020-01-01' }])[0]
    assert.notEqual(first.id, 'forged'); assert.equal(first.createdAt, '2026-10-30T12:00:00.000Z')
    assert.equal(first.fact, 'Prefiro café &amp; chá')
    const duplicate = f.adapter.upsertFacts(['PREFIRO CAFE\u0301 & CHA\u0301'])[0]
    assert.equal(duplicate.id, first.id)
    f.adapter.addFact('Eu prefiro outra bebida')
    assert.equal(f.adapter.load().facts.length, 3, 'semantically similar is not duplicate')
    const later = f.adapter.load(); f.adapter.save(later); f.adapter.save(later)
    assert.equal(f.adapter.load().facts[0].createdAt, '2020-01-01T12:00:00.000Z')
  } finally { f.close() }
})
test('legacy save cannot resurrect after clear or replace a source with an untracked object', () => {
  const f = fixture()
  try {
    const old = f.adapter.load()
    f.adapter.clear()
    assert.throws(() => f.adapter.save(old), /memory_changed/)
    assert.throws(() => f.adapter.save(old, f.source.snapshot().token), /memory_changed/)
    assert.throws(() => f.adapter.save(oldMemory()), /memory_changed/)
    assert.equal(f.adapter.load().facts.length, 0)
    const fresh = f.adapter.load(); fresh.userName = 'After clear'; f.adapter.save(fresh)
    assert.equal(f.adapter.load().userName, 'After clear')
  } finally { f.close() }
})
test('legacy summary is UTF8 bounded and never changes the persistent source', () => {
  const f = fixture()
  try {
    for (let i = 0; i < 4; i++) f.adapter.addFact(`${i}: ` + '😀á'.repeat(5000))
    const before = fs.readFileSync(f.filePath, 'utf8')
    const summary = f.adapter.getSummary()
    assert.ok(Buffer.byteLength(summary) <= 6144)
    assert.equal(summary.includes('\ufffd'), false)
    assert.equal(fs.readFileSync(f.filePath, 'utf8'), before)
    assert.equal(f.adapter.load().facts.length, 5)
  } finally { f.close() }
})
test('legacy adapter propagates storage failure instead of creating an empty memory', () => {
  const f = fixture()
  try {
    f.adapter.load()
    const before = fs.readFileSync(f.filePath, 'utf8')
    fs.writeFileSync(f.filePath, '{invalid')
    assert.throws(() => f.adapter.load(), /memory_unavailable/)
    assert.throws(() => f.adapter.addFact('Cannot write through corruption'), /memory_unavailable/)
    assert.equal(fs.readFileSync(f.filePath, 'utf8'), '{invalid')
    assert.ok(before.length > 0)
  } finally { f.close() }
})
