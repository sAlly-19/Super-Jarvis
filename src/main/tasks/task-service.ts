import { createHash } from 'node:crypto'
import type { CapabilityResult, ExecutionContext } from '../../shared/types/modules'
import type { TaskMutation, TaskOrigin, TaskRecord, TaskEvidence } from '../../shared/types/tasks'
import { TaskStore } from './task-store'

export interface TaskDependencies {
  requireAccess(): void; sessionId(): number; sendCancel(taskId: string): void
  changed?(record: TaskRecord): void
  verifyCapability?(context: ExecutionContext, capabilityId: string, result: CapabilityResult): CapabilityResult
  releaseObservation?(invocationId: string): void
  clearObservations?(): void
}
/** Main owns IDs, verification and persistence. No tool data is written to history. */
export class TaskService {
  private readonly verified = new Map<string, TaskEvidence[]>()
  constructor(private readonly store: TaskStore, private readonly deps: TaskDependencies) {}
  public open(origin: TaskOrigin, sessionId: number): TaskRecord {
    this.deps.requireAccess()
    if (sessionId !== this.deps.sessionId()) throw new Error('stale_task_session')
    const task = this.store.create(origin, sessionId); this.deps.changed?.(task); return task
  }
  public list(): TaskRecord[] { this.deps.requireAccess(); return this.store.list() }
  public get(taskId: string): TaskRecord | null { this.deps.requireAccess(); return this.store.get(taskId) }
  private require(taskId: string, sessionId: number): TaskRecord {
    this.deps.requireAccess()
    const task = this.store.get(taskId)
    if (!task) throw new Error('task_not_found')
    if (task.sessionId !== sessionId || sessionId !== this.deps.sessionId()) throw new Error('stale_task_session')
    return task
  }
  public contextFor(taskId: string, stepId: string, sessionId: number) {
    const task = this.require(taskId, sessionId)
    if (Date.now() - Date.parse(task.createdAt) >= 120000) throw new Error('task_deadline_exceeded')
    if (task.status !== 'running' || task.stepStates[stepId] !== 'running') throw new Error('task_step_not_running')
    return { taskId, stepId, invocationId: createHash('sha256').update(`jasper:task-step:v1:${taskId}:${stepId}`).digest('hex') }
  }
  public event(taskId: string, revision: number, event: TaskMutation, sessionId: number): TaskRecord {
    this.require(taskId, sessionId)
    const key = `${taskId}:${'stepId' in event ? event.stepId : ''}`
    if (event.type === 'step_finished' && event.status === 'succeeded' && !this.verified.has(key)) throw new Error('unverified_step')
    const result = this.store.appendEvent(taskId, revision, event, this.verified.has(key), event.type === 'step_finished' && event.status === 'succeeded' ? this.verified.get(key) ?? [] : [])
    if (event.type === 'step_finished') this.verified.delete(key)
    if (event.type === 'finished') this.clearTaskProofs(taskId)
    this.deps.changed?.(result); return result
  }
  public verifyHostResult(context: ExecutionContext, capabilityId: string, result: CapabilityResult): CapabilityResult {
    this.deps.requireAccess()
    if (context.sessionId !== this.deps.sessionId()) throw new Error('stale_task_session')
    return this.deps.verifyCapability?.(context, capabilityId, result) ?? result
  }
  public releaseHostObservation(invocationId: string): void { this.deps.releaseObservation?.(invocationId) }
  public observe(taskId: string, stepId: string, capabilityId: string, result: CapabilityResult, context?: ExecutionContext): CapabilityResult {
    const binding = this.contextFor(taskId, stepId, this.deps.sessionId())
    if (context) {
      if (context.taskId !== taskId || context.stepId !== stepId || context.invocationId !== binding.invocationId) throw new Error('invalid_task_context')
      const host = this.verifyHostResult(context, capabilityId, result)
      if (host.status === 'succeeded' && host.evidence.length && host.evidence.every(proof => proof.verified === true)) {
        this.verified.set(`${taskId}:${stepId}`, host.evidence.map(proof => ({ ...proof, stepId, invocationId: context.invocationId })))
        return host
      }
      result = host
    }
    if (capabilityId !== 'get_system_telemetry' || result.status !== 'unknown' || !Object.hasOwn(result, 'data')) return result
    let value: any
    try { value = typeof result.data === 'string' ? JSON.parse(result.data) : result.data } catch { return result }
    const percent = (n: unknown): boolean => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100
    if (value?.status !== 'ok' || !percent(value.cpu_percent) || !percent(value.ram?.percent) || !percent(value.disk_c?.percent)) return result
    this.verified.set(`${taskId}:${stepId}`, [])
    return { status: 'succeeded', data: value, evidence: [{ kind: 'telemetry_read', reference: `${taskId}:${stepId}`, observedAt: new Date().toISOString(), verified: true }] }
  }
  public async cancel(taskId: string): Promise<TaskRecord> {
    const task = this.require(taskId, this.deps.sessionId())
    if (!['queued', 'planning', 'running', 'cancelling'].includes(task.status)) return task
    const result = task.status === 'cancelling' ? task : this.event(taskId, task.revision, { type: 'cancel_requested', sequence: task.revision + 1 }, task.sessionId)
    this.deps.sendCancel(taskId); return result
  }
  public abandon(taskId: string, sessionId: number): TaskRecord {
    this.require(taskId, sessionId)
    this.clearTaskProofs(taskId)
    for (const task of this.store.markInterrupted(sessionId, taskId)) this.deps.changed?.(task)
    return this.store.get(taskId)!
  }
  public interruptSession(sessionId?: number): void {
    for (const task of this.store.markInterrupted(sessionId)) this.deps.changed?.(task)
    this.verified.clear()
    this.deps.clearObservations?.()
  }
  private clearTaskProofs(taskId: string): void {
    for (const key of this.verified.keys()) if (key.startsWith(`${taskId}:`)) this.verified.delete(key)
  }
}
