import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { JasperMemory, MemoryItem } from '../../../shared/types/memory'
import { memoryChanged, type MemorySource, type MemoryToken } from './contracts'
import { factKey, sanitizeNewFact } from './admission'

export class LegacyMemoryAdapter {
  private readonly origins = new WeakMap<JasperMemory, MemoryToken>()
  constructor(private readonly source: MemorySource, private readonly now: () => string) {}
  load(): JasperMemory {
    const snapshot = this.source.snapshot()
    this.origins.set(snapshot.memory, { ...snapshot.token })
    return snapshot.memory
  }
  save(memory: JasperMemory, expectedToken?: MemoryToken): void {
    const origin = this.origins.get(memory)
    if (origin && expectedToken && !isDeepStrictEqual(origin, expectedToken)) throw memoryChanged()
    const expected = origin ?? expectedToken
    if (!expected) throw memoryChanged()
    const committed = this.source.replace(memory, { ...expected })
    this.origins.delete(memory)
    // Keep the common load/edit/save object consistent with Main-assigned IDs/dates.
    // A frozen caller object cannot be synchronized; it must be reloaded, not silently reused.
    try { Object.assign(memory, structuredClone(committed.memory)); this.origins.set(memory, { ...committed.token }) } catch { /* The committed write remains successful. */ }
  }
  addFact(fact: string): string {
    let clean: string
    try { clean = sanitizeNewFact(fact) } catch { return 'Fato inválido ou vazio após sanitização.' }
    const before = this.source.snapshot()
    if (before.memory.facts.some(item => factKey(item.fact) === factKey(clean))) return `Já me lembrava disso: "${clean}".`
    this.source.mutate({ kind: 'upsert_fact', text: fact }, before.token)
    return `Fato memorizado com sucesso: "${clean}".`
  }
  upsertFacts(incoming: Array<string | { fact: string; id?: string; createdAt?: string }>): MemoryItem[] {
    const before = this.source.snapshot(), memory = structuredClone(before.memory)
    const known = new Set(memory.facts.map(item => factKey(item.fact))), wanted = new Set<string>()
    for (const value of incoming) {
      const raw = typeof value === 'string' ? value : value?.fact
      let clean: string
      try { clean = sanitizeNewFact(raw) } catch { continue }
      const key = factKey(clean); wanted.add(key)
      if (!known.has(key)) {
        known.add(key)
        // IDs/timestamps supplied by the sidecar are deliberately ignored.
        memory.facts.push({ id: randomUUID(), fact: raw, createdAt: this.now() })
      }
    }
    const committed = this.source.replace(memory, before.token)
    return committed.memory.facts.filter(item => wanted.has(factKey(item.fact)))
  }
  clear(): void {
    const snapshot = this.source.snapshot()
    this.source.mutate({ kind: 'clear' }, snapshot.token)
  }
  getSummary(): string {
    const memory = this.source.snapshot().memory
    let summary = '', remaining = 6144
    const append = (value: string) => {
      if (!remaining) return
      const bytes = Buffer.from((summary ? ' ' : '') + value, 'utf8')
      let end = Math.min(bytes.length, remaining)
      if (end < bytes.length) while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--
      summary += bytes.subarray(0, end).toString('utf8'); remaining -= end
    }
    if (memory.userName) append(`Nome do usuário: ${memory.userName}.`)
    if (memory.userPreferences.length) {
      append('Preferências:')
      for (const preference of memory.userPreferences) { append(preference); if (!remaining) break }
    }
    if (memory.facts.length && remaining) {
      append('Fatos memorizados:')
      for (const fact of memory.facts) { append(fact.fact); if (!remaining) break }
    }
    return summary || 'Nenhum detalhe prévio gravado.'
  }
}
