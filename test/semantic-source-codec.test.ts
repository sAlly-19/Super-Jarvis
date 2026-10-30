import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SourceCodec } from '../src/main/memory/semantic/source-codec'
import { installationId, oldMemory, protection } from './fixtures/semantic-memory/source'
const snapshot = () => ({ token: { generation: 0, revision: 0 }, memory: oldMemory() })
test('permanent source roundtrips protected document without age filtering or double escaping', () => {
  const codec = new SourceCodec(protection), input = snapshot()
  input.memory.facts.push({ id: 'unicode', fact: 'Ação 😀 "texto"', createdAt: '2020-01-01' })
  const envelope = codec.encode(input, installationId)
  assert.deepEqual(Object.keys(envelope).sort(), ['schemaVersion', 'sealed'])
  assert.equal(JSON.stringify(envelope).includes('Synthetic sentinel'), false)
  assert.deepEqual(codec.decode(envelope, installationId), input)
  assert.equal(codec.decode(envelope, installationId).memory.facts[0].fact, oldMemory().facts[0].fact)
})
test('source codec rejects invalid structure, duplicates, tokens and installation without private errors', () => {
  const codec = new SourceCodec(protection)
  for (const value of [{ ...snapshot(), extra: 1 }, { ...snapshot(), token: { generation: -1, revision: 0 } },
    { ...snapshot(), memory: { ...oldMemory(), facts: [...oldMemory().facts, ...oldMemory().facts] } },
    { ...snapshot(), memory: { ...oldMemory(), userPreferences: [42] } }]) {
    assert.throws(() => codec.encode(value as any, installationId), { message: 'memory_unavailable' })
  }
  const good = codec.encode(snapshot(), installationId)
  for (const value of [{ ...good, extra: 1 }, { ...good, schemaVersion: 3 }, { schemaVersion: 2, sealed: 'bad!' },
    { schemaVersion: 2, sealed: Buffer.from('broken').toString('base64') }]) assert.throws(() => codec.decode(value, installationId), /memory_unavailable/)
  assert.throws(() => codec.decode(good, 'different-installation'), /memory_unavailable/)
  assert.throws(() => new SourceCodec({ ...protection, available: () => false }).decode(good, installationId), /memory_unavailable/)
  assert.throws(() => new SourceCodec({ ...protection, encrypt: () => { throw Error('private secret detail') } }).encode(snapshot(), installationId), { message: 'memory_unavailable' })
})
test('source codec counts escaped JSON bytes before encrypting and bounds ciphertext', () => {
  let encrypted = false
  const codec = new SourceCodec({ ...protection, encrypt: text => { encrypted = true; return protection.encrypt(text) } })
  const input = snapshot(); input.memory.facts[0].fact = '\u0000'.repeat(6 * 1024 * 1024)
  assert.throws(() => codec.encode(input, installationId), /memory_unavailable/)
  assert.equal(encrypted, false)
  assert.throws(() => codec.decode({ schemaVersion: 2, sealed: 'A'.repeat(64 * 1024 * 1024) }, installationId), /memory_unavailable/)
})
