import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore - will be implemented in Step 3
import { encodeFrame, FrameDecoder, FrameError } from '../src/main/services/backend-framing'
// @ts-ignore - will be implemented in Step 3
import type { BackendEnvelope } from '@shared'

describe('Sidecar Versioned Framing Protocol (TypeScript)', () => {
  test('round-trip Unicode envelope encoding and decoding', () => {
    const envelope: BackendEnvelope = {
      version: 1,
      id: 'msg-001',
      type: 'chat',
      payload: { text: 'Olá Jasper! 🚀 Áudio e caracteres especiais: ñ, ç, ü.' }
    }

    const frame = encodeFrame(envelope)
    assert.ok(frame instanceof Buffer)
    assert.equal(frame.readUInt32BE(0), frame.length - 4)

    const decoder = new FrameDecoder()
    const decoded = decoder.push(frame)
    assert.equal(decoded.length, 1)
    assert.deepEqual(decoded[0], envelope)
  })

  test('handles split prefix across multiple chunks', () => {
    const envelope: BackendEnvelope = {
      version: 1,
      id: 'msg-split-pre',
      type: 'hello',
      payload: { nonce: 'abc', capabilities: ['system'] }
    }

    const frame = encodeFrame(envelope)
    const decoder = new FrameDecoder()

    // Push 2 bytes of prefix, then next 2 bytes, then body
    assert.deepEqual(decoder.push(frame.subarray(0, 2)), [])
    assert.deepEqual(decoder.push(frame.subarray(2, 4)), [])
    const decoded = decoder.push(frame.subarray(4))

    assert.equal(decoded.length, 1)
    assert.deepEqual(decoded[0], envelope)
  })

  test('handles split body across multiple chunks', () => {
    const envelope: BackendEnvelope = {
      version: 1,
      id: 'msg-split-body',
      type: 'response',
      payload: { text: 'Long response payload that arrives in small pieces.' }
    }

    const frame = encodeFrame(envelope)
    const decoder = new FrameDecoder()

    const half = Math.floor(frame.length / 2)
    assert.deepEqual(decoder.push(frame.subarray(0, half)), [])
    const decoded = decoder.push(frame.subarray(half))

    assert.equal(decoded.length, 1)
    assert.deepEqual(decoded[0], envelope)
  })

  test('handles coalesced frames in a single chunk', () => {
    const env1: BackendEnvelope = { version: 1, id: '1', type: 'hello', payload: {} }
    const env2: BackendEnvelope = { version: 1, id: '2', type: 'status', payload: { state: 'ok' } }
    const env3: BackendEnvelope = { version: 1, id: '3', type: 'turn_complete', payload: {} }

    const combined = Buffer.concat([encodeFrame(env1), encodeFrame(env2), encodeFrame(env3)])
    const decoder = new FrameDecoder()
    const decoded = decoder.push(combined)

    assert.equal(decoded.length, 3)
    assert.deepEqual(decoded, [env1, env2, env3])
  })

  test('rejects zero declared length without allocating', () => {
    const invalid = Buffer.alloc(4)
    invalid.writeUInt32BE(0, 0)

    const decoder = new FrameDecoder()
    assert.throws(() => decoder.push(invalid), {
      name: 'FrameError',
      message: /comprimento inválido/i
    })
  })

  test('rejects oversized length (>16 MiB) without allocating', () => {
    const invalid = Buffer.alloc(4)
    invalid.writeUInt32BE(16777217, 0) // 16 MiB + 1 byte

    const decoder = new FrameDecoder()
    assert.throws(() => decoder.push(invalid), {
      name: 'FrameError',
      message: /excede limite máximo/i
    })
  })

  test('rejects invalid JSON payload', () => {
    const raw = Buffer.from('{ not-json }', 'utf-8')
    const header = Buffer.alloc(4)
    header.writeUInt32BE(raw.length, 0)
    const invalid = Buffer.concat([header, raw])

    const decoder = new FrameDecoder()
    assert.throws(() => decoder.push(invalid), {
      name: 'FrameError',
      message: /JSON inválido/i
    })
  })

  test('rejects version mismatch (version !== 1)', () => {
    const raw = Buffer.from(JSON.stringify({ version: 2, id: '1', type: 'hello', payload: {} }), 'utf-8')
    const header = Buffer.alloc(4)
    header.writeUInt32BE(raw.length, 0)

    const decoder = new FrameDecoder()
    assert.throws(() => decoder.push(Buffer.concat([header, raw])), {
      name: 'FrameError',
      message: /versão do protocolo incompatível/i
    })
  })

  test('rejects ID or type exceeding 160 characters', () => {
    const longId = 'a'.repeat(161)
    const raw = Buffer.from(JSON.stringify({ version: 1, id: longId, type: 'hello', payload: {} }), 'utf-8')
    const header = Buffer.alloc(4)
    header.writeUInt32BE(raw.length, 0)

    const decoder = new FrameDecoder()
    assert.throws(() => decoder.push(Buffer.concat([header, raw])), {
      name: 'FrameError',
      message: /excede limite de 160 caracteres/i
    })
  })

  test('rejects chat text exceeding 20,000 characters', () => {
    const longText = 'x'.repeat(20001)
    const raw = Buffer.from(JSON.stringify({ version: 1, id: '1', type: 'chat', payload: { text: longText } }), 'utf-8')
    const header = Buffer.alloc(4)
    header.writeUInt32BE(raw.length, 0)

    const decoder = new FrameDecoder()
    assert.throws(() => decoder.push(Buffer.concat([header, raw])), {
      name: 'FrameError',
      message: /excede limite de 20.000 caracteres/i
    })
  })
})
