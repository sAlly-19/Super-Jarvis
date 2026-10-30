import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StateDatabase } from '../src/main/storage/state-database'
import { semanticDatabase, semanticMigrations } from './fixtures/semantic-memory/database'
import { protection } from './fixtures/semantic-memory/source'
import { SemanticIndexStore } from '../src/main/memory/semantic/index-store'
import { MODEL_FINGERPRINT } from '../src/main/memory/semantic/model-protocol'
const token = { generation: 0, revision: 1 }, check = () => {}
const chunk = () => ({ id: 'a'.repeat(64), sourceId: 'fact:sentinel', sourceRevision: 1, generation: 0, modelFingerprint: MODEL_FINGERPRINT,
  kind: 'fact' as const, text: 'PRIVATE_SENTINEL: gosto de café', createdAt: '2020-01-01', vector: Array.from({ length: 384 }, (_, i) => i === 0 ? 1 : 0) })
test('semantic migration9 to10 preserves prior records and creates a migration snapshot', () => {
  const root = mkdtempSync(join(tmpdir(), 'jasper-semantic-db-')), filename = join(root, 'test.sqlite')
  try {
    const migrations = semanticMigrations(), old = new StateDatabase(filename, migrations[0], migrations.slice(1, 9))
    old.transaction(tx => tx.prepare("INSERT INTO web_research_history(id,created_at,updated_at,state,sealed_payload) VALUES(?,?,?,?,?)").run('old', '2020', '2020', 'complete', Buffer.from('old-cipher'))); old.close()
    const db = semanticDatabase(filename)
    assert.equal(db.transaction(tx => tx.prepare('PRAGMA user_version').get()!.user_version), 10)
    assert.equal(db.transaction(tx => tx.prepare('SELECT id FROM web_research_history').get()!.id), 'old')
    assert.ok(readdirSync(root).some(name => name.includes('.pre-v10.'))); db.close()
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test('semantic index publishes only complete builds for exact source token and model, with protected contents', () => {
  const db = semanticDatabase(), index = new SemanticIndexStore(db, protection)
  try {
    const build = index.begin(token, MODEL_FINGERPRINT)
    index.append(build, [chunk()], check); assert.equal(index.read(token, MODEL_FINGERPRINT, check), null)
    const rows = db.transaction(tx => tx.prepare('SELECT * FROM semantic_index_chunks').all())
    assert.ok(!JSON.stringify(rows).includes('PRIVATE_SENTINEL'))
    assert.ok(!Buffer.from(rows[0].sealed_chunk as Uint8Array).toString().includes('café'))
    index.finish(build, token, check); assert.deepEqual(index.read(token, MODEL_FINGERPRINT, check), [chunk()])
    assert.deepEqual(index.read({ revision: 1, generation: 0 }, MODEL_FINGERPRINT, check), [chunk()])
    assert.equal(index.read({ generation: 0, revision: 2 }, MODEL_FINGERPRINT, check), null)
    assert.equal(index.read(token, 'b'.repeat(64), check), null)
    db.transaction(tx => tx.prepare('UPDATE semantic_index_chunks SET sealed_chunk=?').run(Buffer.from('corrupt')))
    assert.equal(index.read(token, MODEL_FINGERPRINT, check), null)
  } finally { db.close() }
})
test('semantic completion receipt detects deleted rows without accepting a partial ready build', () => {
  const db = semanticDatabase(), index = new SemanticIndexStore(db, protection)
  try {
    const build = index.begin(token, MODEL_FINGERPRINT); index.append(build, [chunk()], check); index.finish(build, token, check)
    db.transaction(tx => tx.prepare('DELETE FROM semantic_index_chunks WHERE id=?').run(chunk().id))
    assert.equal(index.read(token, MODEL_FINGERPRINT, check), null)
  } finally { db.close() }
})
test('semantic index rejects stale finish, invalidation during encryption and authority loss before commit', () => {
  const db = semanticDatabase()
  let allowed = true, invalidate = false
  let index!: SemanticIndexStore
  index = new SemanticIndexStore(db, { ...protection, encrypt(text) { const bytes = protection.encrypt(text); if (invalidate) index.invalidate(); if (text.includes('PRIVATE_SENTINEL')) allowed = false; return bytes } })
  try {
    const build = index.begin(token, MODEL_FINGERPRINT)
    assert.throws(() => index.finish(build, { generation: 1, revision: 2 }, check), /index_unavailable/)
    assert.throws(() => index.append(build, [chunk()], () => { if (!allowed) throw Error('revoked') }), /revoked/)
    assert.equal(db.transaction(tx => tx.prepare('SELECT count(*) AS n FROM semantic_index_chunks').get()!.n), 0)
    allowed = true; invalidate = true
    assert.throws(() => index.append(build, [chunk()], check), /index_unavailable/)
    assert.equal(index.read(token, MODEL_FINGERPRINT, check), null)
    const unavailable = new SemanticIndexStore(db, { ...protection, available: () => false })
    assert.throws(() => unavailable.begin(token, MODEL_FINGERPRINT), /index_unavailable/)
  } finally { db.close() }
})
test('semantic index prunes obsolete derived builds on rebuild and clears ciphertext rows on invalidation', () => {
  const db = semanticDatabase(), index = new SemanticIndexStore(db, protection)
  try {
    for (let i = 0; i < 3; i++) { const build = index.begin(token, MODEL_FINGERPRINT); index.append(build, [chunk()], check); index.finish(build, token, check) }
    assert.equal(db.transaction(tx => tx.prepare('SELECT count(*) AS n FROM semantic_index_builds').get()!.n), 1)
    index.invalidate()
    assert.equal(db.transaction(tx => tx.prepare('SELECT count(*) AS n FROM semantic_index_builds').get()!.n), 0)
    assert.equal(db.transaction(tx => tx.prepare('SELECT count(*) AS n FROM semantic_index_chunks').get()!.n), 0)
  } finally { db.close() }
})
