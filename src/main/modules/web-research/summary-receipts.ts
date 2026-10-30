import { randomBytes } from 'node:crypto'
import type { ExecutionContext } from '../../../shared/types/modules'
import type { ResearchHandle, SummaryReceipt, WebResearchNote } from '../../../shared/types/web-research'
import { isResearchId } from './history-codec'

interface Entry { receipt: SummaryReceipt; handle: ResearchHandle; context: ExecutionContext; issuedAt: number }
interface Dependencies {
  now(): number
  currentSession(): number
  authorize(): void
  contains(handle: ResearchHandle): boolean
  setSummary(handle: ResearchHandle, text: string): void
}
/** Main-only capability: never expose tickets to models, logs or renderer events. */
export class SummaryReceipts {
  private readonly entries = new Map<string, Entry>()
  private closed = false
  constructor(private readonly deps: Dependencies) {}
  private authorize(): void {
    try { this.deps.authorize() }
    catch (error) { this.entries.clear(); throw error }
  }
  private prune(now: number): void {
    for (const [ticket, entry] of this.entries) {
      if (!Number.isFinite(now) || now < entry.issuedAt || now >= entry.receipt.expiresAt
        || entry.context.sessionId !== this.deps.currentSession() || !this.deps.contains(entry.handle)) this.entries.delete(ticket)
    }
  }
  issue(handle: ResearchHandle, context: ExecutionContext): SummaryReceipt {
    try {
      this.authorize()
      const now = this.deps.now()
      this.prune(now)
      if (this.closed || !Number.isFinite(now) || !isResearchId(handle.id)
        || !Number.isSafeInteger(handle.generation) || handle.generation < 0
        || !['saved', 'volatile'].includes(handle.storage) || !this.deps.contains(handle)
        || !Number.isSafeInteger(context.sessionId) || context.sessionId !== this.deps.currentSession()) throw Error('invalid_receipt')
      this.invalidate(handle.id)
      while (this.entries.size >= 30) this.entries.delete(this.entries.keys().next().value!)
      const receipt = { researchId: handle.id, ticket: randomBytes(32).toString('hex'), sessionId: context.sessionId, expiresAt: now + 300000 }
      this.entries.set(receipt.ticket, { receipt: { ...receipt }, handle: { ...handle }, context: { ...context }, issuedAt: now })
      return receipt
    } catch { throw Error('invalid_receipt') }
  }
  accept(note: WebResearchNote, eventSessionId: number): boolean {
    try {
      if (this.closed || !note || typeof note !== 'object' || Array.isArray(note)
        || Object.keys(note).length !== 4 || !['researchId', 'ticket', 'sessionId', 'summary'].every(key => Object.hasOwn(note, key))
        || !isResearchId(note.researchId) || typeof note.ticket !== 'string' || !/^[a-f0-9]{64}$/.test(note.ticket)
        || !Number.isSafeInteger(note.sessionId) || typeof note.summary !== 'string' || note.summary.length > 4000) return false
      const now = this.deps.now()
      this.prune(now)
      const entry = this.entries.get(note.ticket)
      if (!entry || entry.handle.id !== note.researchId || note.sessionId !== eventSessionId
        || note.sessionId !== entry.context.sessionId || note.sessionId !== this.deps.currentSession()) return false
      this.authorize()
      if (!this.deps.contains(entry.handle)) { this.entries.delete(note.ticket); return false }
      this.entries.delete(note.ticket)
      this.deps.setSummary(entry.handle, note.summary)
      return true
    } catch { return false }
  }
  invalidate(researchId?: string): void {
    for (const [ticket, entry] of this.entries) if (researchId === undefined || entry.handle.id === researchId) this.entries.delete(ticket)
  }
  close(): void { this.closed = true; this.entries.clear() }
}
