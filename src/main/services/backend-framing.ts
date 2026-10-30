import {
  type BackendEnvelope,
  MAX_FRAME_BODY_LENGTH,
  MAX_ID_LENGTH,
  MAX_TYPE_LENGTH,
  MAX_CHAT_TEXT_LENGTH,
  BACKEND_MESSAGE_TYPES
} from '@shared'
import { validateModulePayload } from '../modules/wire-protocol'
import { validateTaskPayload } from '../tasks/task-protocol'
import { validateWebNote } from '../modules/web-research/note-protocol'

export class FrameError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FrameError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requireString(payload: Record<string, unknown>, field: string, allowEmpty = false): void {
  const value = payload[field]
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw new FrameError(`Payload '${field}' deve ser uma string${allowEmpty ? '' : ' não vazia'}.`)
  }
}

function validatePayload(type: string, value: unknown): void {
  if (!isRecord(value)) {
    throw new FrameError(`Payload inválido para '${type}': esperado objeto.`)
  }
  const payload = value
  if (type === 'web_research_note') { try { validateWebNote(payload); return } catch { throw new FrameError('Invalid web note') } }
  try { if (validateTaskPayload(type, payload)) return } catch { throw new FrameError('Invalid task payload') }
  try { if (validateModulePayload(type, payload)) return } catch { throw new FrameError('Invalid modular payload') }
  switch (type) {
    case 'hello':
      requireString(payload, 'client')
      if (payload.protocolVersion !== 1) throw new FrameError("Payload 'protocolVersion' deve ser 1.")
      break
    case 'config':
      requireString(payload, 'agent_name')
      requireString(payload, 'model')
      requireString(payload, 'voice')
      if (payload.apiKey !== undefined && typeof payload.apiKey !== 'string') throw new FrameError("Payload 'apiKey' inválido.")
      if (payload.vision !== undefined && typeof payload.vision !== 'boolean') throw new FrameError("Payload 'vision' inválido.")
      break
    case 'chat':
      requireString(payload, 'text')
      if ((payload.text as string).length > MAX_CHAT_TEXT_LENGTH) {
        throw new FrameError(`Texto de chat excede limite de ${MAX_CHAT_TEXT_LENGTH.toLocaleString('pt-BR')} caracteres.`)
      }
      if (payload.vision !== undefined && typeof payload.vision !== 'boolean') throw new FrameError("Payload 'vision' inválido.")
      break
    case 'live_start':
      requireString(payload, 'apiKey')
      requireString(payload, 'voice')
      if ((payload.apiKey as string).length > 512 || (payload.voice as string).length > 80) throw new FrameError('Configuração Live excede o limite.')
      if (payload.greeting !== undefined && typeof payload.greeting !== 'boolean') throw new FrameError('greeting inválido.')
      break
    case 'live_audio':
      requireString(payload, 'audio_base64')
      if ((payload.audio_base64 as string).length > 65536) throw new FrameError('Bloco Live excede o limite.')
      break
    case 'audio_input':
      requireString(payload, 'audio_base64')
      if (payload.vision !== undefined && typeof payload.vision !== 'boolean') throw new FrameError("Payload 'vision' inválido.")
      break
    case 'memory_snapshot':
    case 'memory_upsert':
      if (!Array.isArray(payload.facts)) throw new FrameError("Payload 'facts' deve ser um array.")
      break
    case 'hello_ack':
      requireString(payload, 'service')
      if (payload.protocolVersion !== 1) throw new FrameError("Payload 'protocolVersion' deve ser 1.")
      if (!Array.isArray(payload.tools) || !payload.tools.every((tool) => typeof tool === 'string')) {
        throw new FrameError("Payload 'tools' deve ser um array de strings.")
      }
      break
    case 'status':
      requireString(payload, 'status')
      break
    case 'user_transcript':
    case 'response':
      requireString(payload, 'text', true)
      break
    case 'audio_output':
      requireString(payload, 'audio_base64')
      requireString(payload, 'format')
      requireString(payload, 'text', true)
      break
    case 'tool_execution':
      requireString(payload, 'tool')
      if (!isRecord(payload.args)) throw new FrameError("Payload 'args' deve ser um objeto.")
      break
    case 'tool_result':
      requireString(payload, 'tool')
      if (!Object.prototype.hasOwnProperty.call(payload, 'result')) throw new FrameError("Payload 'result' é obrigatório.")
      break
    case 'error':
      requireString(payload, 'message')
      break
    case 'interrupt':
    case 'memory_clear':
    case 'shutdown':
    case 'turn_complete':
    case 'interrupted':
      break
  }
}

function validateEnvelope(env: any): asserts env is BackendEnvelope {
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    throw new FrameError('Envelope deve ser um objeto JSON não-nulo.')
  }

  if (env.version !== 1) {
    throw new FrameError(`Versão do protocolo incompatível: esperada 1, recebida ${env.version}.`)
  }

  if (typeof env.id !== 'string' || env.id.length === 0 || env.id.length > MAX_ID_LENGTH) {
    throw new FrameError(`ID inválido ou excede limite de ${MAX_ID_LENGTH} caracteres.`)
  }

  if (env.replyTo !== undefined && (typeof env.replyTo !== 'string' || env.replyTo.length === 0 || env.replyTo.length > MAX_ID_LENGTH)) {
    throw new FrameError(`replyTo inválido ou excede limite de ${MAX_ID_LENGTH} caracteres.`)
  }

  if (typeof env.type !== 'string' || env.type.length === 0 || env.type.length > MAX_TYPE_LENGTH) {
    throw new FrameError(`Tipo de mensagem inválido ou excede limite de ${MAX_TYPE_LENGTH} caracteres.`)
  }

  if (!(BACKEND_MESSAGE_TYPES as readonly string[]).includes(env.type)) {
    throw new FrameError(`Tipo de mensagem desconhecido: '${env.type}'.`)
  }

  if (!Object.prototype.hasOwnProperty.call(env, 'payload')) throw new FrameError('Payload ausente no envelope.')
  validatePayload(env.type, env.payload)
}

export interface FrameDecoderOptions {
  allowedTypes?: readonly string[]
}

export function encodeFrame(message: BackendEnvelope): Buffer {
  validateEnvelope(message)

  const bodyBytes = Buffer.from(JSON.stringify(message), 'utf-8')
  if (bodyBytes.length === 0) {
    throw new FrameError('Comprimento do corpo do frame não pode ser 0.')
  }
  if (bodyBytes.length > MAX_FRAME_BODY_LENGTH) {
    throw new FrameError(`Tamanho do frame excede o limite máximo de ${MAX_FRAME_BODY_LENGTH} bytes.`)
  }

  const prefix = Buffer.alloc(4)
  prefix.writeUInt32BE(bodyBytes.length, 0)
  return Buffer.concat([prefix, bodyBytes])
}

export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0)
  private readonly allowedTypes?: ReadonlySet<string>

  constructor(options: FrameDecoderOptions = {}) {
    this.allowedTypes = options.allowedTypes ? new Set(options.allowedTypes) : undefined
  }

  public push(chunk: Buffer): BackendEnvelope[] {
    if (!chunk || chunk.length === 0) return []

    this.buffer = Buffer.concat([this.buffer, chunk])
    const envelopes: BackendEnvelope[] = []

    while (this.buffer.length >= 4) {
      const declaredLength = this.buffer.readUInt32BE(0)

      if (declaredLength === 0) {
        throw new FrameError('Comprimento inválido do frame: 0 bytes anunciados.')
      }

      if (declaredLength > MAX_FRAME_BODY_LENGTH) {
        throw new FrameError(`Comprimento anunciado (${declaredLength} bytes) excede limite máximo de ${MAX_FRAME_BODY_LENGTH} bytes.`)
      }

      if (this.buffer.length < 4 + declaredLength) {
        // Incomplete frame, wait for more chunks
        break
      }

      const bodyBuffer = this.buffer.subarray(4, 4 + declaredLength)
      this.buffer = this.buffer.subarray(4 + declaredLength)

      let parsed: any
      try {
        const bodyText = new TextDecoder('utf-8', { fatal: true }).decode(bodyBuffer)
        parsed = JSON.parse(bodyText)
      } catch (err: any) {
        throw new FrameError(`JSON inválido no corpo do frame: ${err.message}`)
      }

      validateEnvelope(parsed)
      if (this.allowedTypes && !this.allowedTypes.has(parsed.type)) {
        throw new FrameError(`Tipo '${parsed.type}' não permitido nesta direção do protocolo.`)
      }
      envelopes.push(parsed)
    }

    return envelopes
  }

  public reset(): void {
    this.buffer = Buffer.alloc(0)
  }
}
