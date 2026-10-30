import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore - will be implemented in Step 3
import { encodeFrame, FrameDecoder, FrameError } from '../src/main/services/backend-framing'
// @ts-ignore - will be implemented in Step 3
import type { BackendEnvelope } from '@shared'
import {
  BACKEND_MESSAGE_TYPES,
  HOST_TO_SIDECAR_MESSAGE_TYPES,
  SIDECAR_TO_HOST_MESSAGE_TYPES,
  type BackendMessageType
} from '@shared'

function rawFrame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  const prefix = Buffer.alloc(4)
  prefix.writeUInt32BE(body.length)
  return Buffer.concat([prefix, body])
}

describe('Sidecar Versioned Framing Protocol (TypeScript)', () => {
  test('publishes the complete canonical message allowlists', () => {
    assert.deepEqual(BACKEND_MESSAGE_TYPES, [
      'hello', 'config', 'chat', 'audio_input', 'interrupt', 'memory_snapshot', 'memory_clear', 'shutdown',
      'live_start', 'live_audio', 'live_stop',
      'module_snapshot', 'capability_execute', 'capability_response', 'invocation_cancel',
      'task_runtime', 'task_event_ack', 'task_cancel',
      'hello_ack', 'status', 'user_transcript', 'response', 'audio_output', 'tool_execution', 'tool_result',
      'memory_upsert', 'turn_complete', 'interrupted', 'error', 'module_snapshot_ack', 'capability_request', 'capability_result', 'capability_cancel_request', 'task_runtime_ack', 'task_event', 'web_research_note'
    ])
    assert.equal(HOST_TO_SIDECAR_MESSAGE_TYPES.length, 18)
    assert.equal(SIDECAR_TO_HOST_MESSAGE_TYPES.length, 19)
  })

  test('accepts a valid payload for every allowed message type', () => {
    const payloads: Record<BackendMessageType, Record<string, unknown>> = {
      hello: { client: 'test', protocolVersion: 1 },
      web_research_note: { researchId: '11111111-1111-4111-8111-111111111111', ticket: 'a'.repeat(64), sessionId: 1, summary: 'Summary' },
      task_runtime: { taskRuntimeVersion: 1, sessionId: 1 },
      task_runtime_ack: { taskRuntimeVersion: 1, sessionId: 1 },
      task_event: { requestId: 'r', sessionId: 1, taskId: '', expectedRevision: 0, event: { type: 'open', origin: 'chat' } },
      task_event_ack: { requestId: 'r', taskId: 't', revision: 0, accepted: true },
      task_cancel: { taskId: 't' },
      config: { agent_name: 'Jasper', model: 'model', voice: 'voice', apiKey: '', vision: false },
      chat: { text: 'oi' },
      audio_input: { audio_base64: 'AA==' },
      interrupt: {},
      memory_snapshot: { facts: [] },
      memory_clear: {},
      shutdown: { reason: 'test' },
      live_start: { apiKey: 'test', voice: 'Charon', greeting: false },
      live_audio: { audio_base64: 'AAA=' },
      live_stop: {},
      module_snapshot: { moduleRuntimeVersion: 1, snapshotVersion: 1, sessionId: 1, capabilities: [] },
      module_snapshot_ack: { moduleRuntimeVersion: 1, snapshotVersion: 1 },
      capability_request: { requestId: 'req', snapshotVersion: 1, capabilityId: 'run_powershell', args: {} },
      capability_cancel_request: { requestId: 'req' },
      capability_execute: { requestId: 'req', snapshotVersion: 1, capabilityId: 'run_powershell', args: {}, context: { taskId: 'task', stepId: 'step', invocationId: 'inv', sessionId: 1, moduleRevision: 0 } },
      capability_result: { context: { taskId: 'task', stepId: 'step', invocationId: 'inv', sessionId: 1, moduleRevision: 0 }, result: { status: 'unknown', evidence: [] } },
      capability_response: { requestId: 'req', result: { status: 'failed', errorCode: 'denied', evidence: [] } },
      invocation_cancel: { invocationId: 'inv', reason: 'disabled' },
      hello_ack: { service: 'jasper-backend', protocolVersion: 1, tools: [] },
      status: { status: 'ready' },
      user_transcript: { text: 'oi' },
      response: { text: 'olá' },
      audio_output: { audio_base64: 'AA==', format: 'mp3', text: 'olá' },
      tool_execution: { tool: 'test', args: {} },
      tool_result: { tool: 'test', result: 'ok' },
      memory_upsert: { facts: [] },
      turn_complete: {},
      interrupted: {},
      error: { message: 'erro' }
    }

    for (const type of BACKEND_MESSAGE_TYPES) {
      const envelope: BackendEnvelope = { version: 1, id: `valid-${type}`, type, payload: payloads[type] }
      assert.deepEqual(new FrameDecoder().push(encodeFrame(envelope)), [envelope])
    }
  })

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
      payload: { client: 'test', protocolVersion: 1 }
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
    const env1: BackendEnvelope = { version: 1, id: '1', type: 'hello', payload: { client: 'test', protocolVersion: 1 } }
    const env2: BackendEnvelope = { version: 1, id: '2', type: 'status', payload: { status: 'ok' } }
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

  test('rejects invalid UTF-8 instead of replacing bytes', () => {
    const invalidUtf8 = Buffer.from([0xc3, 0x28])
    const prefix = Buffer.alloc(4)
    prefix.writeUInt32BE(invalidUtf8.length)
    assert.throws(() => new FrameDecoder().push(Buffer.concat([prefix, invalidUtf8])), FrameError)
  })

  test('rejects unknown message types and wrong-direction messages', () => {
    assert.throws(
      () => new FrameDecoder().push(rawFrame({ version: 1, id: '1', type: 'made_up', payload: {} })),
      /unknown|desconhecido/i
    )
    assert.throws(
      () => new FrameDecoder({ allowedTypes: SIDECAR_TO_HOST_MESSAGE_TYPES }).push(
        rawFrame({ version: 1, id: '2', type: 'chat', payload: { text: 'oi' } })
      ),
      /direction|direção/i
    )
  })

  test('rejects missing or malformed payloads for every message family', () => {
    const invalidEnvelopes = [
      { version: 1, id: '1', type: 'hello' },
      { version: 1, id: '2', type: 'hello', payload: {} },
      { version: 1, id: '3', type: 'chat', payload: { text: 123 } },
      { version: 1, id: '4', type: 'audio_input', payload: { audio_base64: '' } },
      { version: 1, id: '5', type: 'config', payload: { model: 'x' } },
      { version: 1, id: '6', type: 'hello_ack', payload: { protocolVersion: 1 } },
      { version: 1, id: '7', type: 'status', payload: {} },
      { version: 1, id: '8', type: 'response', payload: { text: false } },
      { version: 1, id: '9', type: 'tool_execution', payload: { tool: 'x', args: [] } },
      { version: 1, id: '10', type: 'error', payload: {} }
    ]

    for (const envelope of invalidEnvelopes) {
      assert.throws(() => new FrameDecoder().push(rawFrame(envelope)), FrameError)
    }
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
