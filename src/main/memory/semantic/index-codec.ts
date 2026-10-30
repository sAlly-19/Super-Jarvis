import { exactObject, validateMemoryToken } from './source-codec'
import { validVectors } from './model-protocol'
import type { MemoryChunk, MemoryProtection } from './contracts'
export const indexUnavailable = () => new Error('index_unavailable')
export function validateIndexChunk(value: unknown): asserts value is MemoryChunk {
  if (!exactObject(value, ['id', 'sourceId', 'sourceRevision', 'generation', 'modelFingerprint', 'kind', 'text', 'vector'], ['createdAt']) ||
    typeof value.id !== 'string' || !/^[a-f0-9]{64}$/.test(value.id) || typeof value.sourceId !== 'string' || value.sourceId.length > 200 ||
    !['fact', 'name', 'preference'].includes(value.kind as string) ||
    !(value.kind === 'fact' ? /^fact:[A-Za-z0-9_.:-]{1,160}$/.test(value.sourceId) : value.kind === 'name' ? value.sourceId === 'profile:name' : /^profile:preference:\d+$/.test(value.sourceId)) ||
    typeof value.modelFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.modelFingerprint) ||
    typeof value.text !== 'string' || !value.text.trim() || Buffer.byteLength(value.text) > 16384 ||
    value.createdAt !== undefined && (typeof value.createdAt !== 'string' || value.createdAt.length > 80 || !Number.isFinite(Date.parse(value.createdAt))) ||
    !validVectors([value.vector], 1)) throw indexUnavailable()
  try { validateMemoryToken({ generation: value.generation, revision: value.sourceRevision }) } catch { throw indexUnavailable() }
}
/** Chunk text, source identity, dates, terms and vectors stay inside this protected envelope. */
export class IndexCodec {
  constructor(private readonly protection: MemoryProtection) {}
  seal(value: unknown): Uint8Array {
    try {
      if (!this.protection.available()) throw indexUnavailable()
      const text = JSON.stringify(value)
      if (Buffer.byteLength(text) > 65536) throw indexUnavailable()
      const bytes = this.protection.encrypt(text)
      if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 131072 || this.protection.decrypt(bytes) !== text || !this.protection.available()) throw indexUnavailable()
      return bytes
    } catch { throw indexUnavailable() }
  }
  open(bytes: unknown): unknown {
    try {
      if (!this.protection.available() || !(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 131072) throw indexUnavailable()
      const text = this.protection.decrypt(bytes)
      if (typeof text !== 'string' || Buffer.byteLength(text) > 65536 || !this.protection.available()) throw indexUnavailable()
      return JSON.parse(text)
    } catch { throw indexUnavailable() }
  }
}
