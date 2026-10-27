import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { CapabilityResult, ExecutionContext } from '../../../shared/types/modules'
import type { MutationRequest, Reminder } from '../../../shared/types/reminders'
import { ModuleRegistry } from '../registry'
import { RemindersStore } from './store'
import { isReminderCapability, REMINDER_READ_CAPABILITIES } from './capabilities'

interface Dependencies { authorize(id: string, context: ExecutionContext): void; nowUtc(): string }
interface Observation { context: ExecutionContext; capabilityId: string; output: unknown; argsHash?: string; observedAt: string }

/** All observations are produced in Main, never supplied as verification by the caller. */
export class RemindersService {
  private readonly observations = new Map<string, Observation>()
  constructor(private readonly store: RemindersStore, private readonly registry: ModuleRegistry, private readonly deps: Dependencies) {}

  private publicItem(item: Reminder) {
    const current = item.state === 'active' ? this.store.nextOccurrence(item.id) : null
    return { id: item.id, revision: item.revision, title: item.title, description: item.description, localDateTime: item.schedule.localDateTime,
      timeZone: item.schedule.timeZone, nextDueUtc: item.nextDueUtc, state: item.state, occurrenceKey: current?.key ?? null }
  }

  public async execute(capabilityId: string, args: unknown, context: ExecutionContext, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted()
    if (!isReminderCapability(capabilityId) || this.registry.get(capabilityId)?.moduleId !== 'reminders') throw new Error('unknown_reminder_capability')
    this.deps.authorize(capabilityId, context)
    this.registry.validateInput(capabilityId, args)
    const input = args as Record<string, any>
    let items: Reminder[], nextCursor: string | null = null, argsHash: string | undefined
    const read = REMINDER_READ_CAPABILITIES.has(capabilityId)
    if (capabilityId === 'reminder_get') {
      const item = this.store.get(input.id); items = item ? [item] : []
    } else if (capabilityId === 'reminder_list') {
      const page = this.store.list({ ...input, limit: input.limit ?? 100 }); items = page.items; nextCursor = page.nextCursor
    } else {
      const request = { ...input, type: capabilityId.slice('reminder_'.length), ...(capabilityId === 'reminder_create' ? { description: input.description ?? '' } : {}) } as MutationRequest
      let result: ReturnType<RemindersStore['mutate']>
      for (;;) {
        signal.throwIfAborted(); this.deps.authorize(capabilityId, context)
        try { result = this.store.mutate(request, { invocationId: context.invocationId, nowUtc: this.deps.nowUtc() }); break }
        catch (error) {
          if (!(error instanceof Error) || error.message !== 'recurrence_checkpoint_pending') throw error
          await new Promise<void>(resolve => setImmediate(resolve))
        }
      }
      items = result.items; argsHash = result.receipt.argsHash
    }
    const rows = items.map(item => this.publicItem(item)), single = rows.length === 1 ? rows[0] : null
    const affected = ['reminder_complete', 'reminder_snooze'].includes(capabilityId) && single
      ? this.store.getOccurrence(input.occurrenceKey, single.id) : null
    const affectedOccurrence = affected ? { key: affected.key, nominalLocalTime: affected.nominalLocalTime, dueUtc: affected.dueUtc,
      snoozedUntilUtc: affected.snoozedUntilUtc, state: affected.state } : null
    const output = { outcome: read ? 'read' : 'written', receiptRef: randomUUID(), id: single?.id ?? null, revision: single?.revision ?? null,
      occurrenceKey: affected?.key ?? single?.occurrenceKey ?? null, affectedOccurrence, items: rows, nextCursor }
    this.registry.validateOutput(capabilityId, output)
    this.observations.set(context.invocationId, { capabilityId, context: { ...context }, output: structuredClone(output), argsHash, observedAt: this.deps.nowUtc() })
    return output
  }

  public verify(context: ExecutionContext, capabilityId: string, result: CapabilityResult): CapabilityResult {
    const denied = (): CapabilityResult => ({ status: 'unknown', evidence: [], errorCode: 'unverified_host_result' })
    try {
      this.deps.authorize(capabilityId, context)
      const observation = this.observations.get(context.invocationId)
      if (!observation || observation.capabilityId !== capabilityId || !isDeepStrictEqual(observation.context, context)
        || result.status !== 'unknown' || !isDeepStrictEqual(result.data, observation.output)) return denied()
      this.registry.validateOutput(capabilityId, result.data)
      const read = REMINDER_READ_CAPABILITIES.has(capabilityId)
      if (!read) {
        const receipt = this.store.getReceipt(context.invocationId)
        if (!receipt || receipt.capabilityId !== capabilityId || receipt.argsHash !== observation.argsHash) return denied()
      }
      return { status: 'succeeded', data: structuredClone(observation.output), evidence: [{ kind: read ? 'reminder_read' : 'reminder_write',
        reference: (observation.output as { receiptRef: string }).receiptRef, observedAt: observation.observedAt, verified: true }] }
    } catch { return denied() }
  }
  public releaseObservation(invocationId: string): void { this.observations.delete(invocationId) }
  public clearObservations(): void { this.observations.clear() }
}
