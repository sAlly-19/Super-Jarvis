import { randomUUID } from 'node:crypto'
import type { Reminder } from '../../../shared/types/reminders'
import type { RemindersStore } from './store'

export interface NotificationHooks {
  beforeShow(): boolean
  shown(): void
  failed(): void
}
export interface ReminderNotifier {
  supported(): boolean
  prepare(item: Reminder, hooks: NotificationHooks): { show(): void; cancel(): void }
  close?(): void
}
export interface SchedulerDependencies {
  allowed(): boolean
  nowUtc(): string
  notifier: ReminderNotifier
  defer?(fn: () => void): void
  presenter?: { sessionId(): string | null; present(batch: NonNullable<ReturnType<RemindersStore['pendingBatch']>>): boolean }
}

/** No model connection and no external agenda process. All effects are gated again at delivery. */
export class ReminderScheduler {
  private epoch = randomUUID()
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly pending = new Map<string, { cancel(): void }>()
  private recovery: Promise<void> | null = null
  private recoveryEpoch: string | null = null
  private delivered: { batchId: string; sessionId: string; total: number } | null = null
  constructor(private readonly store: RemindersStore, private readonly dependencies: SchedulerDependencies) {}

  public tick(nowUtc: string): void {
    if (!this.dependencies.allowed()) { this.stop(); return }
    if (this.store.resumeAdvancements(nowUtc) || this.store.expireClaims(nowUtc)) {
      void this.recover(nowUtc).catch(() => this.stop())
      return
    }
    const epoch = this.epoch
    const claimEpoch = `${epoch}:${randomUUID()}`
    for (const occurrence of this.store.claimDue(nowUtc, claimEpoch)) {
      const key = occurrence.key
      const pendingKey = `${claimEpoch}:${key}`
      let settled = false
      const valid = () => this.epoch === epoch && this.dependencies.allowed()
        && this.store.getPreferences().notificationsEnabled && this.store.canDeliver(key, claimEpoch, this.dependencies.nowUtc())
      const finish = (state: 'shown' | 'blocked' | 'uncertain') => {
        if (this.epoch !== epoch || settled) return
        settled = true
        if (state === 'shown' && !valid()) state = 'uncertain'
        this.store.markDelivery(key, claimEpoch, state)
        this.pending.get(pendingKey)?.cancel()
        this.pending.delete(pendingKey)
        this.store.collectMissed(this.dependencies.nowUtc())
        this.presentPendingBatch()
        void this.recover(this.dependencies.nowUtc()).catch(() => this.stop())
      }
      if (!valid() || !this.dependencies.notifier.supported()) { finish('blocked'); continue }
      const item = this.store.get(occurrence.reminderId)!
      try {
        const notification = this.dependencies.notifier.prepare(item, {
          beforeShow: valid, shown: () => finish('shown'), failed: () => finish('uncertain')
        })
        this.pending.set(pendingKey, notification)
        ;(this.dependencies.defer ?? queueMicrotask)(() => {
          if (this.epoch !== epoch) return
          if (!valid()) { finish('blocked'); return }
          try { notification.show() } catch { finish('uncertain') }
        })
      } catch { finish('uncertain') }
    }
  }
  public recover(nowUtc: string): Promise<void> {
    if (this.recovery) return this.recoveryEpoch === this.epoch ? this.recovery : this.recovery.then(() => this.recover(nowUtc))
    const epoch = this.epoch
    this.recoveryEpoch = epoch
    this.recovery = (async () => {
      while (epoch === this.epoch && this.dependencies.allowed()) {
        try { if (!this.store.recoverDue(nowUtc)) break }
        catch (error) { if (!(error instanceof Error) || error.message !== 'recurrence_checkpoint_pending') throw error }
        await new Promise<void>(resolve => setImmediate(resolve))
      }
      if (epoch !== this.epoch || !this.dependencies.allowed()) return
      this.presentPendingBatch()
    })().finally(() => { this.recovery = null })
    return this.recovery
  }
  private presentPendingBatch(): void {
      if (!this.dependencies.allowed()) return
      const batch = this.store.pendingBatch(), presenter = this.dependencies.presenter
      const sessionId = presenter?.sessionId()
      if (batch && sessionId && presenter && !(this.delivered?.batchId === batch.batchId && this.delivered.sessionId === sessionId && this.delivered.total === batch.total)) {
        // Set correlation before sending so a synchronous fake renderer can acknowledge safely.
        this.delivered = { batchId: batch.batchId, sessionId, total: batch.total }
        if (!presenter.present(batch)) this.delivered = null
      }
  }
  public acknowledgeBatch(batchId: string, observedTotal?: number): boolean {
    if (!this.dependencies.allowed() || !this.delivered || this.delivered.batchId !== batchId
      || this.delivered.sessionId !== this.dependencies.presenter?.sessionId() || (observedTotal !== undefined && observedTotal !== this.delivered.total)) return false
    const batch = this.store.pendingBatch()
    if (!batch || batch.batchId !== batchId || batch.total !== this.delivered.total) return false
    if (!this.store.acknowledgeBatch(batchId, this.dependencies.nowUtc(), this.delivered.total)) return false
    this.delivered = null
    return true
  }
  public async start(): Promise<void> {
    if (this.timer || !this.dependencies.allowed()) return
    const epoch = this.epoch
    await this.recover(this.dependencies.nowUtc())
    if (epoch !== this.epoch || !this.dependencies.allowed() || this.timer) return
    this.timer = setInterval(() => {
      try { this.tick(this.dependencies.nowUtc()) }
      catch (error) {
        if (error instanceof Error && error.message === 'recurrence_checkpoint_pending') return
        this.stop(); console.warn('[Reminders] Delivery interrupted; recovery required.')
      }
    }, 1000)
    this.timer.unref?.()
  }
  public isRunning(): boolean { return this.timer !== null || this.recovery !== null }
  public stop(): void {
    const previous = this.epoch
    this.epoch = randomUUID()
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.delivered = null
    for (const pending of this.pending.values()) pending.cancel()
    this.pending.clear()
    this.dependencies.notifier.close?.()
    this.store.releaseClaims(previous, true)
  }
}
