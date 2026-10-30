import { randomUUID } from 'node:crypto'
import { utilityProcess } from 'electron'
import type { SemanticScope, EmbeddingClient, LocalTokenizer } from './contracts'
import { MODEL_FINGERPRINT, modelRecord, validModelTexts, validVectors, validCounts } from './model-protocol'

export interface ModelChild {
  on(event: string, callback: (...args: any[]) => void): unknown
  once(event: string, callback: (...args: any[]) => void): unknown
  postMessage(value: unknown): void
  kill(): unknown
}
export type ModelFactory = (filename: string, root: string) => ModelChild
interface Job {
  id: string; kind: 'embed' | 'count'; texts: string[]; scope: SemanticScope
  resolve(value: number[][] | number[]): void; reject(error: Error): void
  timer: ReturnType<typeof setTimeout>; abort(): void
}
const fail = (code: string) => new Error(code)
const factory: ModelFactory = (filename, root) => utilityProcess.fork(filename, [root, MODEL_FINGERPRINT], {
  env: Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(SystemRoot|WINDIR|TEMP|TMP)$/i.test(key))),
  stdio: 'ignore', serviceName: 'Jasper local semantic memory'
})
/** One CPU worker; deadlines include queue time. Cancellation never starts a replacement automatically. */
export class SemanticModelClient implements EmbeddingClient, LocalTokenizer {
  private child?: ModelChild
  private ready = false
  private stopped = false
  private active?: Job
  private queue: Job[] = []
  private exitWork?: Promise<void>
  private stopWork?: Promise<void>
  constructor(private readonly filename: string, private readonly root: string, private readonly fork: ModelFactory = factory) {}
  embed(texts: string[], scope: SemanticScope): Promise<number[][]> { return this.submit('embed', texts, scope) as Promise<number[][]> }
  count(texts: string[], scope: SemanticScope): Promise<number[]> { return this.submit('count', texts, scope) as Promise<number[]> }
  private submit(kind: Job['kind'], texts: string[], scope: SemanticScope): Promise<number[][] | number[]> {
    try {
      scope.check(); if (scope.signal.aborted) throw fail('model_cancelled')
      if (this.stopped) throw fail('model_stopped')
      if (!validModelTexts(texts)) throw fail('model_invalid_input')
      if (!Number.isFinite(scope.deadline) || scope.deadline <= Date.now()) throw fail('model_timeout')
      if ((this.active ? 1 : 0) + this.queue.length >= 5) throw fail('model_queue_full')
    } catch (error) { return Promise.reject(error) }
    return new Promise((resolve, reject) => {
      const job: Job = { id: randomUUID(), kind, texts: [...texts], scope, resolve, reject,
        timer: setTimeout(() => this.cancel(job, 'model_timeout'), Math.min(20000, scope.deadline - Date.now())),
        abort: () => this.cancel(job, 'model_cancelled') }
      scope.signal.addEventListener('abort', job.abort, { once: true })
      this.queue.push(job)
      if (!this.child) this.launch()
      this.pump()
      if (scope.signal.aborted) job.abort()
    })
  }
  private launch() {
    try {
      const child = this.fork(this.filename, this.root); this.child = child
      this.exitWork = new Promise(resolve => child.once('exit', () => {
        if (this.child === child) { this.ready = false; this.stopped = true; this.rejectAll('model_worker_exited') }
        resolve()
      }))
      child.once('spawn', () => { if (this.stopped) child.kill(); else { this.ready = true; this.pump() } })
      child.on('message', value => { if (this.child === child && !this.stopped) this.receive(value) })
      child.once('error', () => { void this.shutdown('model_failed').catch(() => {}) })
    } catch { this.stopped = true; this.rejectAll('model_failed') }
  }
  private pump() {
    if (!this.ready || this.stopped || this.active || !this.child) return
    const job = this.queue.shift(); if (!job) return
    this.active = job
    try {
      job.scope.check(); job.scope.signal.throwIfAborted()
      if (job.scope.deadline <= Date.now()) { this.cancel(job, 'model_timeout'); return }
      this.child.postMessage({ id: job.id, type: job.kind, texts: job.texts, modelFingerprint: MODEL_FINGERPRINT })
    } catch { this.cancel(job, 'model_cancelled') }
  }
  private clear(job: Job) { clearTimeout(job.timer); job.scope.signal.removeEventListener('abort', job.abort) }
  private cancel(job: Job, code: string) {
    if (this.active === job) { void this.shutdown(code).catch(() => {}); return }
    const index = this.queue.indexOf(job)
    if (index >= 0) { this.queue.splice(index, 1); this.clear(job); job.reject(fail(code)) }
  }
  private receive(value: unknown) {
    const job = this.active
    if (!job || !modelRecord(value) || value.id !== job.id) return
    let result: number[][] | number[] | undefined
    if (value.modelFingerprint === MODEL_FINGERPRINT && Object.keys(value).length === 4) {
      if (job.kind === 'embed' && value.type === 'result' && validVectors(value.vectors, job.texts.length)) result = value.vectors
      if (job.kind === 'count' && value.type === 'counts' && validCounts(value.counts, job.texts.length)) result = value.counts
      if (value.type === 'error' && ['model_not_prepared', 'model_failed', 'model_protocol_error'].includes(value.code as string)) {
        this.clear(job); this.active = undefined; job.reject(fail(value.code as string)); this.pump(); return
      }
    }
    if (!result) { void this.shutdown('model_protocol_error').catch(() => {}); return }
    try { job.scope.check(); job.scope.signal.throwIfAborted(); if (job.scope.deadline <= Date.now()) throw fail('model_timeout') }
    catch { this.cancel(job, 'model_cancelled'); return }
    this.clear(job); this.active = undefined; job.resolve(result); this.pump()
  }
  private rejectAll(code: string) {
    const jobs = [...(this.active ? [this.active] : []), ...this.queue]
    this.active = undefined; this.queue = []
    for (const job of jobs) { this.clear(job); job.reject(fail(code)) }
  }
  private shutdown(code: string): Promise<void> {
    if (this.stopWork) return this.stopWork
    this.stopped = true; this.ready = false; this.rejectAll(code)
    this.stopWork = (async () => {
      if (!this.child) return
      this.child.kill()
      let timer: ReturnType<typeof setTimeout> | undefined
      try { await Promise.race([this.exitWork, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(fail('model_worker_cleanup_failed')), 5000) })]) }
      finally { if (timer) clearTimeout(timer) }
    })()
    return this.stopWork
  }
  stop(): Promise<void> { return this.shutdown('model_stopped') }
}
