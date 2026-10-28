interface Dependencies { authorize(): void; revision(accountId: string): number }
interface AccountWork {
  epoch: number; controller: AbortController; closing: boolean; unsafe: boolean
  active: Set<Promise<unknown>>; tail: Promise<unknown>
}
export class EmailAccountSession {
  private readonly accounts = new Map<string, AccountWork>()
  constructor(private readonly deps: Dependencies, private readonly timeoutMs = 1000) {}
  private record(id: string): AccountWork {
    if (!id || id.length > 160) throw new Error('invalid_email_account')
    let value = this.accounts.get(id)
    if (!value) { value = { epoch: 0, controller: new AbortController(), closing: false, unsafe: false, active: new Set(), tail: Promise.resolve() }; this.accounts.set(id, value) }
    return value
  }
  capture(accountId: string): { revision: number; signal: AbortSignal; check(): void } {
    this.deps.authorize()
    const record = this.record(accountId), epoch = record.epoch, revision = this.deps.revision(accountId), signal = record.controller.signal
    if (record.unsafe) throw new Error('email_account_cleanup_failed')
    if (record.closing) throw new Error('email_account_unavailable')
    return { revision, signal, check: () => {
      this.deps.authorize()
      if (epoch !== record.epoch || signal.aborted || revision !== this.deps.revision(accountId)) throw new Error('stale_email_account')
      if (record.unsafe || record.closing) throw new Error('email_account_unavailable')
    } }
  }
  runExclusive<T>(accountId: string, work: () => Promise<T>): Promise<T> {
    const capture = this.capture(accountId), record = this.record(accountId)
    const promise = record.tail.catch(() => {}).then(async () => {
      try { capture.check(); const result = await work(); capture.check(); return result }
      catch (error) { if (error instanceof Error && error.message === 'email_account_cleanup_failed') record.unsafe = true; throw error }
    })
    record.tail = promise; record.active.add(promise)
    const cleanup = () => record.active.delete(promise)
    void promise.then(cleanup, cleanup)
    return promise
  }
  async invalidate(accountId: string): Promise<void> {
    const record = this.record(accountId)
    record.epoch++; record.closing = true; record.controller.abort(); record.controller = new AbortController()
    const active = [...record.active]
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        Promise.allSettled(active),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('email_account_cleanup_failed')), this.timeoutMs) })
      ])
    } catch { record.unsafe = true; throw new Error('email_account_cleanup_failed') }
    finally { if (timer) clearTimeout(timer); record.closing = false }
  }
}
