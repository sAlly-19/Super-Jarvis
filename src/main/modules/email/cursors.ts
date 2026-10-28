import { randomUUID, createHash } from 'node:crypto'
export class EmailCursors<T> {
  private readonly entries = new Map<string, { hash: string; revisions: string; expires: number; state: T }>()
  constructor(private readonly now = Date.now) {}
  private revisions(value: Record<string, number>): string { return JSON.stringify(Object.keys(value).sort().map(key => [key, value[key]])) }
  create(queryHash: string, accountRevisions: Record<string, number>, state: T): string {
    const now = this.now()
    for (const [id, entry] of this.entries) if (entry.expires <= now) this.entries.delete(id)
    if (Buffer.byteLength(JSON.stringify(state)) > 2097152) throw new Error('email_cursor_budget_exceeded')
    while (this.entries.size >= 100) this.entries.delete(this.entries.keys().next().value!)
    const id = randomUUID()
    this.entries.set(id, { hash: queryHash, revisions: this.revisions(accountRevisions), expires: now + 300000, state: structuredClone(state) })
    return id
  }
  take(id: string, queryHash: string, accountRevisions: Record<string, number>): T {
    const value = this.entries.get(id)
    if (!value || value.expires <= this.now() || value.hash !== queryHash || value.revisions !== this.revisions(accountRevisions)) throw new Error('email_cursor_stale')
    return structuredClone(value.state)
  }
  clear(): void { this.entries.clear() }
}
export function emailQueryHash(value: unknown): string {
  const canonical = (input: any): any => Array.isArray(input) ? input.map(canonical) : input && typeof input === 'object' ? Object.fromEntries(Object.keys(input).filter(key => input[key] !== undefined).sort().map(key => [key, canonical(input[key])])) : input
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}
