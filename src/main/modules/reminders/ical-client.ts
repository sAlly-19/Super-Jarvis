import { Worker } from 'node:worker_threads'
import type { ImportCandidate, ImportReport, Reminder, ReminderPreferences } from '../../../shared/types/reminders'

/** Main owns each worker until terminate finishes, including abort/error/timeout paths. */
export class ICalendarCodec {
  constructor(private readonly workerPath: string, private readonly timeoutMs = 15_000) {}
  public parse(bytes: Uint8Array, preferences: ReminderPreferences, signal: AbortSignal): Promise<{ candidates: ImportCandidate[]; report: ImportReport }> {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > 2 * 1024 * 1024) return Promise.reject(new Error('ical_size_limit'))
    return this.run({ operation: 'parse', bytes, preferences }, signal)
  }
  public serialize(items: Reminder[], signal: AbortSignal): Promise<Uint8Array> {
    return this.run({ operation: 'serialize', items }, signal)
  }
  private async run<T>(request: unknown, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted()
    const worker = new Worker(this.workerPath)
    let timer: ReturnType<typeof setTimeout> | undefined
    let abort: (() => void) | undefined
    try {
      return await new Promise<T>((resolve, reject) => {
        abort = () => reject(new Error('ical_job_aborted'))
        signal.addEventListener('abort', abort, { once: true })
        timer = setTimeout(() => reject(new Error('ical_worker_timeout')), this.timeoutMs)
        worker.once('error', () => reject(new Error('ical_worker_failed')))
        worker.once('exit', () => reject(new Error('ical_worker_terminated')))
        worker.once('message', message => {
          if (message?.ok === true) resolve(message.value as T)
          else reject(new Error(typeof message?.reason === 'string' && /^[a-z_]+$/.test(message.reason) ? message.reason : 'invalid_worker_response'))
        })
        if (signal.aborted) abort()
        else worker.postMessage(request)
      })
    } finally {
      if (timer) clearTimeout(timer)
      if (abort) signal.removeEventListener('abort', abort)
      await worker.terminate()
      worker.removeAllListeners()
    }
  }
}
