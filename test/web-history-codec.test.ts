import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WebHistoryCodec, type HistoryCrypto } from '../src/main/modules/web-research/history-codec'
import type { WebResearchRecord } from '../src/shared/types/web-research'

export const record = (): WebResearchRecord => ({ id: '11111111-1111-4111-8111-111111111111', sequence: 1,
  createdAt: '2026-10-30T12:00:00.000Z', updatedAt: '2026-10-30T12:00:00.000Z', state: 'running',
  query: 'Synthetic sentinel', results: [], pages: [], summary: null, summaryState: 'pending' })
const mask = (bytes: Uint8Array) => Uint8Array.from(bytes, byte => byte ^ 0xa5)
export const crypto: HistoryCrypto = { available: () => true, encrypt: text => mask(Buffer.from(text)), decrypt: bytes => Buffer.from(mask(bytes)).toString() }

test('history codec roundtrips protected envelope and enforces byte budgets before encryption', () => {
  let plaintext = ''
  const codec = new WebHistoryCodec({ ...crypto, encrypt: text => { plaintext = text; return crypto.encrypt(text) } })
  const input = record(), bytes = codec.encode(input)
  assert.deepEqual(codec.decode(bytes), input)
  assert.equal(Buffer.from(bytes).includes(Buffer.from(input.query)), false)
  assert.ok(Buffer.byteLength(plaintext) <= 262144)
  input.pages = Array.from({ length: 3 }, (_, i) => ({ title: 'Title', url: `https://example.org/${i}`, text: '\u0000'.repeat(48000), fetchedAt: input.createdAt, publishedAt: null, mode: 'http', truncated: false }))
  assert.throws(() => codec.encode(input), /web_history_unavailable/)
})

test('history codec rejects malformed, extra, invalid and oversized data on encode and decode', () => {
  const codec = new WebHistoryCodec(crypto)
  const invalid: unknown[] = [{ ...record(), extra: 1 }, { ...record(), id: 'invalid' }, { ...record(), sequence: 0 },
    { ...record(), query: 'x'.repeat(501) }, { ...record(), summary: 'x'.repeat(4001) },
    { ...record(), results: [{ title: 'T', url: 'file:///x', snippet: '' }] },
    { ...record(), pages: [{ title: 'T', url: 'https://example.org', text: '😀'.repeat(13000), fetchedAt: record().createdAt, publishedAt: null, mode: 'http', truncated: false }] }]
  for (const value of invalid) {
    assert.throws(() => codec.encode(value as WebResearchRecord), /web_history_unavailable/)
    assert.throws(() => codec.decode(crypto.encrypt(JSON.stringify({ schemaVersion: 1, record: value }))), /web_history_unavailable/)
  }
  for (const value of ['{', JSON.stringify({ schemaVersion: 2, record: record() }), JSON.stringify({ schemaVersion: 1, record: record(), extra: true })]) {
    assert.throws(() => codec.decode(crypto.encrypt(value)), /web_history_unavailable/)
  }
  assert.throws(() => codec.decode(new Uint8Array(524289)), /web_history_unavailable/)
})

test('history codec never falls back to plaintext when protection fails', () => {
  const codec = new WebHistoryCodec({ ...crypto, available: () => false })
  assert.throws(() => codec.encode(record()), /web_history_unavailable/)
  assert.throws(() => codec.decode(crypto.encrypt('anything')), /web_history_unavailable/)
  const broken = new WebHistoryCodec({ ...crypto, encrypt: () => { throw Error('private detail') } })
  assert.throws(() => broken.encode(record()), { message: 'web_history_unavailable' })
})
