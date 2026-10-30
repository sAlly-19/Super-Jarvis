import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { PermanentMemoryStore } from '../src/main/memory/semantic/permanent-store'
import { createSourceFileAccess } from '../src/main/memory/semantic/source-file'
import { SourceCodec } from '../src/main/memory/semantic/source-codec'
import { installationId, oldMemory, protection } from './fixtures/semantic-memory/source'
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-semantic-store-')), filePath = path.join(root, 'memory.json')
  const options = { filePath, installationId, protection, authorize() {}, now: () => '2026-10-30T12:00:00.000Z', id: randomUUID }
  const close = () => {
    const resolved = fs.realpathSync(root), parent = fs.realpathSync(os.tmpdir())
    assert.ok(resolved.startsWith(parent + path.sep) && path.basename(resolved).startsWith('jasper-semantic-store-'))
    fs.rmSync(resolved, { recursive: true, force: true })
  }
  return { root, filePath, options, close }
}
test('legacy migration keeps facts older than30 days and creates only protected backups', () => {
  const f = fixture()
  try {
    fs.writeFileSync(f.filePath, JSON.stringify(oldMemory()))
    const store = new PermanentMemoryStore(f.options)
    const snapshot = store.snapshot()
    assert.deepEqual(snapshot.memory, oldMemory()); assert.deepEqual(snapshot.token, { generation: 0, revision: 0 })
    const codec = new SourceCodec(protection)
    assert.deepEqual(codec.decode(JSON.parse(fs.readFileSync(f.filePath, 'utf8')), installationId), snapshot)
    const backup = JSON.parse(fs.readFileSync(f.filePath + '.protected.bak', 'utf8'))
    assert.deepEqual(codec.decode(backup, installationId).memory, oldMemory())
    assert.equal(fs.readFileSync(f.filePath + '.protected.bak', 'utf8').includes('Synthetic sentinel'), false)
    assert.equal(fs.existsSync(f.filePath + '.bak'), false)
  } finally { f.close() }
})
test('invalid, foreign or unavailable memory is preserved instead of reset', () => {
  for (const kind of ['invalid', 'foreign', 'date', 'duplicate', 'crypto', 'broken-encrypt', 'missing-primary'] as const) {
    const f = fixture()
    try {
      const memory = oldMemory()
      if (kind === 'foreign') memory.installationId = 'FOREIGN'
      if (kind === 'date') memory.facts[0].createdAt = 'invalid'
      if (kind === 'duplicate') memory.facts.push({ ...memory.facts[0] })
      const raw = kind === 'invalid' ? '{' : JSON.stringify(memory)
      const target = kind === 'missing-primary' ? f.filePath + '.bak' : f.filePath
      fs.writeFileSync(target, raw)
      const store = new PermanentMemoryStore({ ...f.options, protection: { ...protection, available: () => kind !== 'crypto',
        encrypt: text => kind === 'broken-encrypt' ? new Uint8Array([1]) : protection.encrypt(text) } })
      assert.throws(() => store.snapshot(), /memory_unavailable/)
      assert.equal(fs.readFileSync(target, 'utf8'), raw)
      if (kind === 'missing-primary') assert.equal(fs.existsSync(f.filePath), false)
    } finally { f.close() }
  }
})

test('migration returns the snapshot matching the observed file if another writer updates immediately after commit', () => {
  const f = fixture()
  try {
    fs.writeFileSync(f.filePath, JSON.stringify(oldMemory()))
    const actual = createSourceFileAccess()
    let update = true
    const store = new PermanentMemoryStore({ ...f.options, files: { ...actual, commit(...args) {
      actual.commit(...args)
      if (update) {
        update = false
        const other = new PermanentMemoryStore(f.options), current = other.snapshot()
        other.mutate({ kind: 'upsert_fact', text: 'Concurrent new preference' }, current.token)
      }
    } } })
    const snapshot = store.snapshot()
    assert.equal(snapshot.token.revision, 1)
    assert.equal(snapshot.memory.facts.length, 2)
  } finally { f.close() }
})
test('migration disk or rename failures leave the original and allow an explicit retry', () => {
  for (const kind of ['rename', 'disk'] as const) {
    const f = fixture()
    try {
      const raw = JSON.stringify(oldMemory()); fs.writeFileSync(f.filePath, raw)
      const files = createSourceFileAccess(kind === 'rename' ? { renameSync: (from, to) => { if (to === f.filePath) throw Error('EACCES synthetic'); fs.renameSync(from, to) } }
        : { writeFileSync: () => { throw Error('ENOSPC synthetic') } })
      assert.throws(() => new PermanentMemoryStore({ ...f.options, files }).initialize(), { message: 'memory_unavailable' })
      assert.equal(fs.readFileSync(f.filePath, 'utf8'), raw)
      assert.deepEqual(new PermanentMemoryStore(f.options).snapshot().memory, oldMemory())
    } finally { f.close() }
  }
})
test('clear and editing reject stale writes and use host IDs/dates without automatic pruning', () => {
  const f = fixture()
  try {
    const events: unknown[] = [], store = new PermanentMemoryStore({ ...f.options, onChanged: token => events.push(token) })
    const first = store.snapshot()
    const second = store.mutate({ kind: 'upsert_fact', text: 'A & B' }, first.token)
    assert.equal(second.memory.facts[0].fact, 'A &amp; B'); assert.equal(second.token.revision, 1)
    const id = second.memory.facts[0].id
    const third = store.mutate({ kind: 'upsert_fact', id, text: 'Corrected' }, second.token)
    assert.equal(third.memory.facts[0].id, id)
    assert.throws(() => store.mutate({ kind: 'upsert_fact', text: 'Late' }, second.token), /memory_changed/)
    const fourth = store.mutate({ kind: 'profile', userName: 'Name', userPreferences: ['Preference'] }, third.token)
    const fifth = store.mutate({ kind: 'remove_fact', id }, fourth.token)
    assert.equal(fifth.memory.facts.length, 0)
    const cleared = store.mutate({ kind: 'clear' }, fifth.token)
    assert.deepEqual(cleared.token, { generation: 1, revision: 5 })
    assert.throws(() => store.mutate({ kind: 'upsert_fact', text: 'Resurrected' }, fifth.token), /memory_changed/)
    assert.equal(events.length, 5)
    assert.equal(store.snapshot().memory.facts.length, 0)
  } finally { f.close() }
})
test('crypto-time revocation, external changes and notifications cannot fake a commit', () => {
  const f = fixture()
  try {
    let allowed = true, revoke = false
    const store = new PermanentMemoryStore({ ...f.options,
      authorize() { if (!allowed) throw Error('revoked') },
      protection: { ...protection, encrypt(text) { if (revoke) allowed = false; return protection.encrypt(text) } },
      onChanged() { throw Error('private notification failure') } })
    const before = store.snapshot(), raw = fs.readFileSync(f.filePath, 'utf8')
    revoke = true
    assert.throws(() => store.mutate({ kind: 'upsert_fact', text: 'No late write' }, before.token), /memory_unavailable/)
    assert.equal(fs.readFileSync(f.filePath, 'utf8'), raw)
    allowed = true; revoke = false
    const after = store.mutate({ kind: 'upsert_fact', text: 'Committed once' }, before.token)
    assert.equal(after.memory.facts.length, 1)
    const other = new PermanentMemoryStore(f.options)
    other.mutate({ kind: 'clear' }, after.token)
    assert.throws(() => store.mutate({ kind: 'upsert_fact', text: 'External old state' }, after.token), /memory_changed/)
    assert.equal(store.snapshot().memory.facts.length, 0)
  } finally { f.close() }
})

test('authorization loss immediately after rename withholds data but still invalidates committed memory', () => {
  const f = fixture()
  try {
    let allowed = true, expireAfterCommit = false
    const tokens: unknown[] = [], actual = createSourceFileAccess()
    const store = new PermanentMemoryStore({ ...f.options, authorize() { if (!allowed) throw Error('expired') }, onChanged: token => tokens.push(token),
      files: { ...actual, commit(...args) { actual.commit(...args); if (expireAfterCommit) allowed = false } } })
    const initial = store.snapshot()
    expireAfterCommit = true
    assert.throws(() => store.mutate({ kind: 'upsert_fact', text: 'Committed while authorized' }, initial.token), /memory_unavailable/)
    assert.deepEqual(tokens, [{ generation: 0, revision: 1 }], 'committed mutation must invalidate old contexts even when plaintext cannot be returned')
    allowed = true; expireAfterCommit = false
    assert.equal(store.snapshot().memory.facts.length, 1)
  } finally { f.close() }
})
