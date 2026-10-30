import { isDeepStrictEqual } from 'node:util'
import type { JasperMemory } from '../../../shared/types/memory'
import { SourceCodec, exactObject, validMemoryId, validateMemoryProfile, validateMemoryToken } from './source-codec'
import { createSourceFileAccess, type SourceFileAccess } from './source-file'
import { factKey, sanitizeNewFact, validateNewProfile } from './admission'
import { memoryChanged, memoryUnavailable, type MemorySource, type MemoryChange, type MemoryToken,
  type MemoryProtection, type PermanentMemorySnapshot } from './contracts'
interface Options {
  filePath: string; installationId: string; protection: MemoryProtection
  authorize(): void; now(): string; id(): string
  onChanged?(token: MemoryToken): void
  files?: SourceFileAccess
}
export class PermanentMemoryStore implements MemorySource {
  private readonly codec: SourceCodec
  private readonly files: SourceFileAccess
  private readonly listeners = new Set<(token: MemoryToken) => void>()
  private busy = false
  constructor(private readonly options: Options) {
    this.codec = new SourceCodec(options.protection); this.files = options.files ?? createSourceFileAccess()
    if (options.onChanged) this.listeners.add(options.onChanged)
  }
  private run<T>(action: () => T): T {
    if (this.busy) throw memoryUnavailable()
    this.busy = true
    try { this.options.authorize(); const result = action(); this.options.authorize(); return result }
    catch (error) { if (error instanceof Error && error.message === 'memory_changed') throw memoryChanged(); throw memoryUnavailable() }
    finally { this.busy = false }
  }
  private persist(snapshot: PermanentMemorySnapshot, fingerprint: string | null): void {
    this.options.authorize()
    const envelope = this.codec.encode(snapshot, this.options.installationId)
    // Verify before replacing a legacy file; a faulty crypto implementation must not destroy it.
    if (!isDeepStrictEqual(this.codec.decode(envelope, this.options.installationId), snapshot)) throw memoryUnavailable()
    const backup = this.files.readBackup(this.options.filePath)
    if (backup.fingerprint !== null) this.codec.decode(backup.document, this.options.installationId)
    this.options.authorize()
    this.files.commit(this.options.filePath, envelope, fingerprint, () => this.options.authorize())
  }
  private read(): { snapshot: PermanentMemorySnapshot; fingerprint: string } {
    const file = this.files.read(this.options.filePath)
    if (file.fingerprint !== null && exactObject(file.document, ['schemaVersion', 'sealed'])) {
      const snapshot = this.codec.decode(file.document, this.options.installationId)
      this.options.authorize()
      return { snapshot, fingerprint: file.fingerprint }
    }
    let memory: JasperMemory
    if (file.fingerprint === null) memory = { installationId: this.options.installationId, updatedAt: this.options.now(), userName: '', userPreferences: [], facts: [] }
    else {
      validateMemoryProfile(file.document, this.options.installationId)
      memory = structuredClone(file.document)
      if (!memory.installationId) memory.installationId = this.options.installationId
    }
    const snapshot: PermanentMemorySnapshot = { token: { generation: 0, revision: 0 }, memory }
    this.persist(snapshot, file.fingerprint)
    const committed = this.files.read(this.options.filePath)
    if (committed.fingerprint === null) throw memoryUnavailable()
    // Do not pair an old migration snapshot with a newer writer's fingerprint.
    return { snapshot: this.codec.decode(committed.document, this.options.installationId), fingerprint: committed.fingerprint }
  }
  initialize(): void { this.snapshot() }
  snapshot(): PermanentMemorySnapshot { return this.run(() => structuredClone(this.read().snapshot)) }
  onChanged(callback: (token: MemoryToken) => void): () => void {
    this.listeners.add(callback); return () => this.listeners.delete(callback)
  }
  private change(expected: MemoryToken, action: (memory: JasperMemory) => { memory: JasperMemory; clear?: boolean }): PermanentMemorySnapshot {
    let committedToken: MemoryToken | undefined
    try { return this.run(() => {
      try { validateMemoryToken(expected) } catch { throw memoryChanged() }
      const current = this.read()
      if (!isDeepStrictEqual(expected, current.snapshot.token)) throw memoryChanged()
      const next = action(structuredClone(current.snapshot.memory))
      if (!next.clear && isDeepStrictEqual(next.memory, current.snapshot.memory)) return structuredClone(current.snapshot)
      const token = { generation: expected.generation + (next.clear ? 1 : 0), revision: expected.revision + 1 }
      validateMemoryToken(token)
      next.memory.updatedAt = this.options.now()
      const snapshot = { token, memory: next.memory }
      this.persist(snapshot, current.fingerprint); committedToken = { ...token }
      return structuredClone(snapshot)
    }) } finally {
      // Revocation after the authorized rename must withhold plaintext, not hide
      // that a commit occurred. Invalidation carries only the new token.
      if (committedToken) for (const listener of this.listeners) try { listener({ ...committedToken }) } catch { /* Committed write remains successful. */ }
    }
  }
  mutate(change: MemoryChange, expected: MemoryToken): PermanentMemorySnapshot {
    return this.change(expected, memory => {
      if (!change || typeof change !== 'object') throw memoryUnavailable()
      switch (change.kind) {
        case 'upsert_fact': {
          if (!exactObject(change, ['kind', 'text'], ['id']) || change.id !== undefined && !validMemoryId(change.id)) throw memoryUnavailable()
          const text = sanitizeNewFact(change.text)
          if (change.id !== undefined) {
            const fact = memory.facts.find(item => item.id === change.id)
            if (!fact) throw memoryChanged()
            fact.fact = text
          } else if (!memory.facts.some(item => factKey(item.fact) === factKey(text))) {
            const id = this.options.id()
            if (!validMemoryId(id) || memory.facts.some(item => item.id === id)) throw memoryUnavailable()
            memory.facts.push({ id, fact: text, createdAt: this.options.now() })
          }
          return { memory }
        }
        case 'remove_fact':
          if (!exactObject(change, ['kind', 'id']) || !validMemoryId(change.id)) throw memoryUnavailable()
          memory.facts = memory.facts.filter(item => item.id !== change.id); return { memory }
        case 'profile':
          if (!exactObject(change, ['kind', 'userName', 'userPreferences'])) throw memoryUnavailable()
          validateNewProfile(change.userName, change.userPreferences)
          memory.userName = change.userName; memory.userPreferences = [...change.userPreferences]; return { memory }
        case 'clear':
          if (!exactObject(change, ['kind'])) throw memoryUnavailable()
          return { memory: { ...memory, userName: '', userPreferences: [], facts: [] }, clear: true }
        default: throw memoryUnavailable()
      }
    })
  }
  replace(memory: JasperMemory, expected: MemoryToken): PermanentMemorySnapshot {
    return this.change(expected, previous => {
      validateMemoryProfile(memory, this.options.installationId)
      const next = structuredClone(memory)
      next.installationId = this.options.installationId
      if (next.userName !== previous.userName || !isDeepStrictEqual(next.userPreferences, previous.userPreferences)) validateNewProfile(next.userName, next.userPreferences)
      next.updatedAt = previous.updatedAt
      const used = new Set(previous.facts.map(item => item.id))
      next.facts = next.facts.map(fact => {
        const original = previous.facts.find(item => item.id === fact.id)
        if (original) return { ...original, fact: fact.fact === original.fact ? original.fact : sanitizeNewFact(fact.fact) }
        const id = this.options.id()
        if (!validMemoryId(id) || used.has(id)) throw memoryUnavailable()
        used.add(id)
        return { id, fact: sanitizeNewFact(fact.fact), createdAt: this.options.now() }
      })
      return { memory: next }
    })
  }
}
