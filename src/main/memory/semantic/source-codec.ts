import type { JasperMemory } from '../../../shared/types/memory'
import { MEMORY_PLAINTEXT_BYTES, MEMORY_ENVELOPE_BYTES, memoryUnavailable,
  type MemoryProtection, type PermanentMemorySnapshot, type ProtectedMemoryEnvelope, type MemoryToken } from './contracts'

export function exactObject(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key))
}
export const validMemoryId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value)
export function validateMemoryToken(value: unknown): asserts value is MemoryToken {
  if (!exactObject(value, ['generation', 'revision']) || !Number.isSafeInteger(value.generation) || !Number.isSafeInteger(value.revision)
    || Number(value.generation) < 0 || Number(value.revision) < Number(value.generation)) throw memoryUnavailable()
}
function date(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 80
    || !/^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)
    || !Number.isFinite(Date.parse(value))) return false
  const day = Date.parse(value.slice(0, 10) + 'T00:00:00Z')
  return Number.isFinite(day) && new Date(day).toISOString().slice(0, 10) === value.slice(0, 10)
}
export function validateMemoryProfile(value: unknown, installationId: string): asserts value is JasperMemory {
  if (!installationId || installationId.length > 256
    || !exactObject(value, ['userName', 'userPreferences', 'facts'], ['installationId', 'updatedAt'])
    || value.installationId !== undefined && value.installationId !== installationId
    || value.updatedAt !== undefined && !date(value.updatedAt)
    || typeof value.userName !== 'string' || !Array.isArray(value.userPreferences) || !value.userPreferences.every(item => typeof item === 'string')
    || !Array.isArray(value.facts)) throw memoryUnavailable()
  const ids = new Set<string>()
  for (const fact of value.facts) {
    if (!exactObject(fact, ['id', 'fact', 'createdAt']) || !validMemoryId(fact.id) || ids.has(fact.id)
      || typeof fact.fact !== 'string' || !fact.fact.trim() || !date(fact.createdAt)) throw memoryUnavailable()
    ids.add(fact.id)
  }
}
export function validateMemorySnapshot(value: unknown, installationId: string): asserts value is PermanentMemorySnapshot {
  if (!exactObject(value, ['token', 'memory'])) throw memoryUnavailable()
  validateMemoryToken(value.token)
  validateMemoryProfile(value.memory, installationId)
}

/** No age filter or admission sanitization belongs on the decode/migration path. */
export class SourceCodec {
  constructor(private readonly protection: MemoryProtection) {}
  encode(snapshot: PermanentMemorySnapshot, installationId: string): ProtectedMemoryEnvelope {
    try {
      if (!this.protection.available()) throw memoryUnavailable()
      validateMemorySnapshot(snapshot, installationId)
      const plaintext = JSON.stringify({ installationId, token: snapshot.token, profile: snapshot.memory })
      if (Buffer.byteLength(plaintext) > MEMORY_PLAINTEXT_BYTES) throw memoryUnavailable()
      const bytes = this.protection.encrypt(plaintext)
      // Base64 expands by 4/3; reject oversized results before allocating the envelope.
      if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > Math.floor((MEMORY_ENVELOPE_BYTES - 128) * 3 / 4)) throw memoryUnavailable()
      const envelope: ProtectedMemoryEnvelope = { schemaVersion: 2, sealed: Buffer.from(bytes).toString('base64') }
      if (Buffer.byteLength(JSON.stringify(envelope)) > MEMORY_ENVELOPE_BYTES) throw memoryUnavailable()
      return envelope
    } catch { throw memoryUnavailable() }
  }
  decode(envelope: unknown, installationId: string): PermanentMemorySnapshot {
    try {
      if (!this.protection.available() || !exactObject(envelope, ['schemaVersion', 'sealed']) || envelope.schemaVersion !== 2
        || typeof envelope.sealed !== 'string' || envelope.sealed.length > MEMORY_ENVELOPE_BYTES - 128
        || !envelope.sealed.length || envelope.sealed.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(envelope.sealed)) throw memoryUnavailable()
      const bytes = Buffer.from(envelope.sealed, 'base64')
      if (!bytes.length || bytes.toString('base64') !== envelope.sealed) throw memoryUnavailable()
      const plaintext = this.protection.decrypt(bytes)
      if (typeof plaintext !== 'string' || Buffer.byteLength(plaintext) > MEMORY_PLAINTEXT_BYTES) throw memoryUnavailable()
      const value: unknown = JSON.parse(plaintext)
      if (!exactObject(value, ['installationId', 'token', 'profile']) || value.installationId !== installationId) throw memoryUnavailable()
      const snapshot = { token: value.token, memory: value.profile }
      validateMemorySnapshot(snapshot, installationId)
      return snapshot
    } catch { throw memoryUnavailable() }
  }
}
