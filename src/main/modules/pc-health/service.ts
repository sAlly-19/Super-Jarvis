import { isDeepStrictEqual } from 'node:util'
import { randomUUID } from 'node:crypto'
import type { PcHealthSnapshot, PcHealthState, PcHealthAlert, PcHealthPreferences } from '../../../shared/types/pc-health'
import type { CapabilityResult, ExecutionContext } from '../../../shared/types/modules'
import type { HealthCollector } from './client'
import { PcHealthStore } from './store'
interface Dependencies {
  allowed(): boolean; authorize(context: ExecutionContext): void; now(): number
  changed(): void; notify(alerts: PcHealthAlert[], valid: () => boolean): void; closeNotices(): void
}
export class PcHealthService {
  private epoch = 0; private lastPoll = -Infinity; private paused = false
  private unsafe = false
  private snapshot: PcHealthSnapshot | null = null; private errorCode: string | null = null
  private alerts: PcHealthAlert[] = []; private counts = new Map<string, number>()
  private active = new Set<{ controller: AbortController; work: Promise<PcHealthSnapshot> }>()
  private observations = new Map<string, { context: ExecutionContext; output: unknown }>()
  constructor(private readonly store: PcHealthStore, private readonly collector: HealthCollector, private readonly deps: Dependencies) {}
  private access() { if (!this.deps.allowed()) throw new Error('pc_health_unavailable') }
  state(): PcHealthState { this.access(); return structuredClone({ snapshot: this.snapshot, preferences: this.store.get(), busy: this.active.size > 0, errorCode: this.errorCode, alerts: this.alerts }) }
  preferences() { this.access(); return this.store.get() }
  async configure(patch: Partial<Omit<PcHealthPreferences, 'revision'>>, revision: number) {
    this.access(); await this.stop(); this.access(); const value = this.store.update(patch, revision); this.deps.changed(); return value
  }
  read(signal = new AbortController().signal): Promise<PcHealthSnapshot> {
    this.access(); signal.throwIfAborted()
    if (this.unsafe) throw new Error('health_worker_cleanup_failed')
    if (this.active.size >= 2) throw new Error('health_collection_busy')
    const epoch = this.epoch, controller = new AbortController(), abort = () => controller.abort()
    signal.addEventListener('abort', abort, { once: true })
    const entry = { controller, work: Promise.resolve(null as unknown as PcHealthSnapshot) }
    this.active.add(entry)
    entry.work = (async () => {
      try {
        const snapshot = await this.collector.collect(controller.signal)
        controller.signal.throwIfAborted(); this.access()
        if (epoch !== this.epoch) throw new Error('health_collection_invalidated')
        this.snapshot = structuredClone(snapshot); this.errorCode = null
        this.evaluate(snapshot); this.deps.changed()
        return structuredClone(snapshot)
      } catch (error) { if (epoch === this.epoch && this.deps.allowed() && !controller.signal.aborted) { this.errorCode = 'health_collection_failed'; this.deps.changed() }; throw error }
      finally { signal.removeEventListener('abort', abort); this.active.delete(entry); if (epoch === this.epoch && this.deps.allowed()) this.deps.changed() }
    })()
    return entry.work
  }
  async poll(): Promise<void> {
    if (!this.deps.allowed()) { if (this.active.size || this.snapshot) await this.stop(); return }
    const prefs = this.store.get(), now = this.deps.now()
    if (this.unsafe || this.paused || !prefs.automatic || this.active.size || now - this.lastPoll < prefs.intervalSeconds * 1000) return
    this.lastPoll = now
    try { await this.read() } catch { /* State contains a bounded public diagnostic. */ }
  }
  private evaluate(snapshot: PcHealthSnapshot) {
    const prefs = this.store.get(), conditions: PcHealthAlert[] = []
    const check = (kind: PcHealthAlert['kind'], active: boolean, message: string) => { if (active) conditions.push({ kind, message }) }
    check('cpu', snapshot.cpuPercent !== null && snapshot.cpuPercent >= prefs.cpuPercent, `CPU acima de ${prefs.cpuPercent}%.`)
    check('memory', snapshot.memory !== null && snapshot.memory.percent >= prefs.memoryPercent, `Memória acima de ${prefs.memoryPercent}%.`)
    check('disk', Boolean(snapshot.disks?.some(disk => 100 - disk.usedPercent <= prefs.diskFreePercent)), `Disco com ${prefs.diskFreePercent}% ou menos de espaço livre.`)
    check('temperature', snapshot.temperatureC !== null && snapshot.temperatureC >= prefs.temperatureC, `Temperatura da CPU acima de ${prefs.temperatureC} °C.`)
    check('battery', snapshot.battery !== null && !snapshot.battery.charging && snapshot.battery.percent <= prefs.batteryPercent, `Bateria com ${prefs.batteryPercent}% ou menos.`)
    this.alerts = conditions
    const previous = this.counts; this.counts = new Map(conditions.map(alert => [alert.kind, (previous.get(alert.kind) ?? 0) + 1]))
    if (!prefs.alertsEnabled) return
    const deliver = conditions.filter(alert => this.counts.get(alert.kind)! >= 2 && this.store.claimAlert(alert.kind, this.deps.now()))
    const epoch = this.epoch
    if (deliver.length) this.deps.notify(deliver, () => epoch === this.epoch && this.deps.allowed() && this.store.get().alertsEnabled)
  }
  async stop(): Promise<void> {
    this.epoch++; this.lastPoll = -Infinity; this.snapshot = null; this.alerts = []; this.counts.clear(); this.observations.clear()
    for (const entry of this.active) entry.controller.abort()
    this.deps.closeNotices()
    const results = await Promise.allSettled([...this.active].map(entry => entry.work))
    if (results.some(result => result.status === 'rejected' && result.reason?.message === 'health_worker_cleanup_failed')) { this.unsafe = true; this.errorCode = 'health_worker_cleanup_failed'; throw new Error('health_worker_cleanup_failed') }
  }
  async suspend() { this.paused = true; await this.stop() }
  resume() { this.paused = false; this.lastPoll = -Infinity }
  async execute(id: string, args: unknown, context: ExecutionContext, signal: AbortSignal) {
    if (id !== 'pc_health_read' || !args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length) throw new Error('invalid_health_request')
    this.deps.authorize(context)
    const snapshot = await this.read(signal)
    signal.throwIfAborted(); this.deps.authorize(context)
    const output = { receiptRef: randomUUID(), snapshot }
    this.observations.set(context.invocationId, { context: { ...context }, output: structuredClone(output) })
    return output
  }
  verify(context: ExecutionContext, id: string, result: CapabilityResult): CapabilityResult {
    const denied: CapabilityResult = { status: 'unknown', evidence: [], errorCode: 'unverified_host_result' }
    try {
      this.deps.authorize(context)
      const observation = this.observations.get(context.invocationId)
      if (id !== 'pc_health_read' || result.status !== 'unknown' || !observation || !isDeepStrictEqual(context, observation.context) || !isDeepStrictEqual(result.data, observation.output)) return denied
      return { status: 'succeeded', data: structuredClone(observation.output), evidence: [{ kind: 'pc_health_read', reference: (observation.output as { receiptRef: string }).receiptRef, observedAt: (observation.output as { snapshot: PcHealthSnapshot }).snapshot.observedAt, verified: true }] }
    } catch { return denied }
  }
  releaseObservation(id: string) { this.observations.delete(id) }
  clearObservations() { this.observations.clear() }
}
