import {
  type BackendEnvelope,
  MAX_FRAME_BODY_LENGTH,
  MAX_ID_LENGTH,
  MAX_TYPE_LENGTH,
  MAX_CHAT_TEXT_LENGTH
} from '@shared'

export class FrameError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FrameError'
  }
}

function validateEnvelope(env: any): asserts env is BackendEnvelope {
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    throw new FrameError('Envelope deve ser um objeto JSON não-nulo.')
  }

  if (env.version !== 1) {
    throw new FrameError(`Versão do protocolo incompatível: esperada 1, recebida ${env.version}.`)
  }

  if (typeof env.id !== 'string' || env.id.length > MAX_ID_LENGTH) {
    throw new FrameError(`ID inválido ou excede limite de ${MAX_ID_LENGTH} caracteres.`)
  }

  if (env.replyTo !== undefined && (typeof env.replyTo !== 'string' || env.replyTo.length > MAX_ID_LENGTH)) {
    throw new FrameError(`replyTo inválido ou excede limite de ${MAX_ID_LENGTH} caracteres.`)
  }

  if (typeof env.type !== 'string' || env.type.length > MAX_TYPE_LENGTH) {
    throw new FrameError(`Tipo de mensagem inválido ou excede limite de ${MAX_TYPE_LENGTH} caracteres.`)
  }

  if (env.type === 'chat' && env.payload && typeof env.payload.text === 'string') {
    if (env.payload.text.length > MAX_CHAT_TEXT_LENGTH) {
      throw new FrameError(`Texto de chat excede limite de ${MAX_CHAT_TEXT_LENGTH.toLocaleString('pt-BR')} caracteres.`)
    }
  }
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
        parsed = JSON.parse(bodyBuffer.toString('utf-8'))
      } catch (err: any) {
        throw new FrameError(`JSON inválido no corpo do frame: ${err.message}`)
      }

      validateEnvelope(parsed)
      envelopes.push(parsed)
    }

    return envelopes
  }

  public reset(): void {
    this.buffer = Buffer.alloc(0)
  }
}
