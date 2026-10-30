import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { webDatabase } from './fixtures/web/database'
import { emailDatabase } from './fixtures/email/database'
import { WebHistoryStore } from '../src/main/modules/web-research/history-store'
import { WebHistoryCodec } from '../src/main/modules/web-research/history-codec'
import type { WebPage } from '../src/shared/types/web-research'
const mask = (bytes: Uint8Array) => Uint8Array.from(bytes, byte => byte ^ 0xa5)
const crypto = { available: () => true, encrypt: (text: string) => mask(Buffer.from(text)), decrypt: (bytes: Uint8Array) => Buffer.from(mask(bytes)).toString() }
const deps = { now: () => '2026-10-30T12:00:00.000Z', id: randomUUID }
const page = (url: string, text = 'Synthetic source'): WebPage => ({ title: 'Title', url, text, fetchedAt: deps.now(), publishedAt: null, mode: 'http', truncated: false })

test('history migration8 to9 preserves previous rows and creates a snapshot', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-web-db-')), filename = path.join(root, 'state.db')
  try {
    const old = emailDatabase(filename)
    old.transaction(tx => tx.prepare('UPDATE email_preferences SET revision=7 WHERE singleton=1').run()); old.close()
    const db = webDatabase(filename)
    try {
      assert.equal(db.transaction(tx => tx.prepare('PRAGMA user_version').get()!.user_version), 9)
      assert.equal(db.transaction(tx => tx.prepare('SELECT revision FROM email_preferences').get()!.revision), 7)
      assert.ok(fs.readdirSync(root).some(name => name.includes('.pre-v9.')))
    } finally { db.close() }
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('history retains ten by creation sequence and rejects pruned or cleared late callbacks', () => {
  const db = webDatabase()
  try {
    const store = new WebHistoryStore(db, new WebHistoryCodec(crypto), deps)
    const first = store.begin('Sentinel query')
    const handles = Array.from({ length: 10 }, () => store.begin('Another query'))
    assert.equal(store.list().items.length, 10)
    assert.equal(store.get(first.id), null); assert.ok(store.get(handles[9].id))
    assert.throws(() => store.addPage(first, { state: 'ok', page: page('https://example.org') }), /history_changed/)
    assert.throws(() => store.setSummary(first, 'late'), /history_changed/)
    const row = db.transaction(tx => tx.prepare('SELECT * FROM web_research_history ORDER BY sequence DESC LIMIT 1').get()!)
    for (const value of Object.values(row)) if (typeof value === 'string') assert.doesNotMatch(value, /query|example/)
    const generation = store.list().generation
    assert.equal(store.clear(generation).generation, generation + 1)
    assert.throws(() => store.clear(generation), /history_changed/)
    assert.equal(store.contains(handles[9]), false)
    assert.throws(() => store.setSummary(handles[9], 'late'), /history_changed/)
    const next = store.begin('New research'); assert.ok(store.get(next.id)!.sequence > 11)
  } finally { db.close() }
})

test('history page replacement, escaped-byte truncation and summary never change source proof', () => {
  const db = webDatabase()
  try {
    const store = new WebHistoryStore(db, new WebHistoryCodec(crypto), deps), h = store.begin('Question')
    store.addResults(h, { state: 'ok', query: 'Question', results: [], queriedAt: deps.now() })
    for (let i = 0; i < 4; i++) store.addPage(h, { state: 'ok', page: page(`https://example.org/${i}`, '\u0000'.repeat(48000)) })
    let record = store.get(h.id)!
    assert.equal(record.pages.length, 3); assert.equal(record.pages[0].url, 'https://example.org/1')
    assert.ok(record.pages.some(p => p.truncated))
    assert.ok(Buffer.byteLength(JSON.stringify({ schemaVersion: 1, record })) <= 262144)
    store.addPage(h, { state: 'partial', page: page('https://example.org/1', 'replacement') })
    record = store.get(h.id)!
    assert.equal(record.pages.length, 3); assert.equal(record.pages[2].text, 'replacement')
    store.setSummary(h, 'A model summary')
    assert.equal(store.get(h.id)!.state, record.state)
    assert.deepEqual(store.get(h.id)!.pages, record.pages)
    assert.equal(store.get(h.id)!.summaryState, 'available')
  } finally { db.close() }
})

test('history failures preserve ciphertext and never replace unavailable history with empty success', () => {
  const db = webDatabase()
  let available = true
  try {
    const store = new WebHistoryStore(db, new WebHistoryCodec({ ...crypto, available: () => available }), deps)
    const handles = Array.from({ length: 10 }, () => store.begin('Protected sentinel'))
    available = false
    assert.throws(() => store.begin('Cannot save'), /web_history_unavailable/)
    assert.equal(db.transaction(tx => tx.prepare('SELECT count(*) AS count FROM web_research_history').get()!.count), 10)
    assert.equal(store.list().storage, 'unavailable')
    available = true
    db.transaction(tx => tx.prepare("CREATE TRIGGER reject_web_insert BEFORE INSERT ON web_research_history BEGIN SELECT RAISE(ABORT,'synthetic'); END").run())
    assert.throws(() => store.begin('SQL failure'), /web_history_unavailable/)
    assert.ok(store.get(handles[0].id))
    db.transaction(tx => tx.prepare('UPDATE web_research_history SET sealed_payload=? WHERE id=?').run(new Uint8Array([1]), handles[0].id))
    assert.equal(store.list().storage, 'unavailable'); assert.throws(() => store.get(handles[0].id), /web_history_unavailable/)
    assert.equal(store.clear(0).items.length, 0)
  } finally { db.close() }
})

test('history reports unavailable protection even when there are no rows to decrypt', () => {
  const db = webDatabase()
  try {
    const store = new WebHistoryStore(db, new WebHistoryCodec({ ...crypto, available: () => false }), deps)
    assert.equal(store.list().storage, 'unavailable')
    assert.equal(store.clear(0).generation, 1)
    assert.equal(store.list().storage, 'unavailable')
  } finally { db.close() }
})
