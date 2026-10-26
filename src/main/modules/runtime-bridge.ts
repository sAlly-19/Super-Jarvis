import { createHash } from 'node:crypto'
import type { BackendEnvelope, HostToSidecarMessageType } from '../../shared/types/backend-protocol'
import type { ExecutionContext } from '../../shared/types/modules'
import { ModuleRegistry } from './registry'
import { ModulePolicy } from './policy'
import { InvocationStore } from './invocation-store'
import { ExecutionBroker } from './execution-broker'
import { validateModulePayload } from './wire-protocol'
import type { StopReport } from './lifecycle'
import type { TaskService } from '../tasks/task-service'

export interface ModuleTransport {
  getSessionId(): number
  notify(type: HostToSidecarMessageType, payload: unknown): void
  request(type: HostToSidecarMessageType, payload: unknown, timeoutMs?: number): Promise<unknown>
}

/** Private transport adapter; it does not grant authority from renderer or LLM fields. */
export class ModuleRuntimeBridge {
  private snapshotVersion = 0
  private negotiatedSession: number | null = null
  private ready = false
  private readonly broker: ExecutionBroker
  private readonly requestIds = new Map<string, string>()

  public isReady(): boolean { return this.ready && this.negotiatedSession === this.transport.getSessionId() }

  constructor(private readonly registry: ModuleRegistry, private readonly policy: ModulePolicy,
    invocations: InvocationStore, private readonly transport: ModuleTransport,
    private readonly getRevision: () => number, private readonly tasks?: TaskService) {
    this.broker = new ExecutionBroker(registry, policy, async (capabilityId, args, context, signal) => {
      const requestId = this.requestIds.get(context.invocationId)
      if (!requestId || !this.ready || context.sessionId !== this.negotiatedSession) throw new Error('module_not_ready')
      const cancel = (): void => {
        if (context.sessionId === this.transport.getSessionId()) {
          this.transport.notify('invocation_cancel', { invocationId: context.invocationId, reason: 'execution_cancelled' })
        }
      }
      signal.addEventListener('abort', cancel, { once: true })
      try {
        const response = await this.transport.request('capability_execute', {
          requestId, context, capabilityId, args, snapshotVersion: this.snapshotVersion
        }, this.registry.get(capabilityId)!.timeoutMs + 1000) as { context: ExecutionContext; result: { data?: unknown } }
        validateModulePayload('capability_result', response)
        if (!Object.keys(context).every(key => response.context[key as keyof ExecutionContext] === context[key as keyof ExecutionContext])
          || !Object.hasOwn(response.result, 'data')) throw new Error('invalid_capability_response')
        return response.result.data
      } finally { signal.removeEventListener('abort', cancel) }
    }, invocations)
  }

  public async negotiate(features: { moduleRuntimeVersion?: number }, sessionId: number): Promise<number> {
    this.ready = false
    if (features.moduleRuntimeVersion !== 1 || sessionId !== this.transport.getSessionId()) {
      this.negotiatedSession = null
      throw new Error('incompatible_module_runtime')
    }
    this.negotiatedSession = sessionId
    return this.synchronize()
  }

  public async synchronize(): Promise<number> {
    this.ready = false
    const sessionId = this.negotiatedSession
    if (sessionId === null || sessionId !== this.transport.getSessionId()) throw new Error('module_not_negotiated')
    const snapshotVersion = ++this.snapshotVersion
    await this.broker.stopModule('computer')
    const capabilities = this.registry.list().filter(capability => this.policy.authorize(capability.id, {
      taskId: 'catalog', stepId: 'catalog', invocationId: 'catalog', sessionId, moduleRevision: this.getRevision()
    }).allowed)
    const ack = await this.transport.request('module_snapshot', { moduleRuntimeVersion: 1, snapshotVersion, sessionId, capabilities }) as { snapshotVersion: number }
    validateModulePayload('module_snapshot_ack', ack)
    if (sessionId !== this.transport.getSessionId() || this.snapshotVersion !== snapshotVersion || ack.snapshotVersion !== snapshotVersion) throw new Error('stale_module_ack')
    this.ready = true
    return snapshotVersion
  }

  public async handle(frame: BackendEnvelope, eventSessionId: number): Promise<void> {
    if (frame.type === 'capability_cancel_request' && eventSessionId === this.transport.getSessionId()) {
      validateModulePayload(frame.type, frame.payload)
      const requestId = (frame.payload as { requestId: string }).requestId
      const invocationId = [...this.requestIds.entries()].find(([, value]) => value === requestId)?.[0]
      if (invocationId) this.broker.cancelInvocation(invocationId)
      return
    }
    if (frame.type !== 'capability_request' || eventSessionId !== this.transport.getSessionId()) return
    validateModulePayload(frame.type, frame.payload)
    const payload = frame.payload as { requestId: string; snapshotVersion: number; capabilityId: string; args: unknown; task?: { taskId: string; stepId: string } }
    if (!this.ready || eventSessionId !== this.negotiatedSession || payload.snapshotVersion !== this.snapshotVersion) {
      this.transport.notify('capability_response', { requestId: payload.requestId, result: { status: 'failed', evidence: [], errorCode: 'module_not_ready' } })
      return
    }
    // Deterministic host-generated opaque ID lets SQLite reject replayed request IDs without an unbounded JS map.
    let binding: { taskId: string; stepId: string; invocationId: string } | undefined
    if (payload.task) {
      try {
        if (!this.tasks) throw new Error('tasks_unavailable')
        binding = this.tasks.contextFor(payload.task.taskId, payload.task.stepId, eventSessionId)
      } catch {
        this.transport.notify('capability_response', { requestId: payload.requestId, result: { status: 'failed', evidence: [], errorCode: 'task_not_running' } })
        return
      }
    }
    const invocationId = binding?.invocationId ?? createHash('sha256').update(`jasper:capability:v1:${payload.requestId}`).digest('hex')
    const context: ExecutionContext = { invocationId, taskId: binding?.taskId ?? invocationId, stepId: binding?.stepId ?? invocationId,
      sessionId: eventSessionId, moduleRevision: this.getRevision() }
    if (this.requestIds.has(invocationId)) {
      this.transport.notify('capability_response', { requestId: payload.requestId, result: { status: 'failed', evidence: [], errorCode: 'duplicate_invocation' } })
      return
    }
    this.requestIds.set(invocationId, payload.requestId)
    try {
      let result = await this.broker.invoke(payload.capabilityId, payload.args, context)
      if (binding && this.tasks) {
        try { result = this.tasks.observe(binding.taskId, binding.stepId, payload.capabilityId, result) }
        catch { result = { status: 'unknown', evidence: [], errorCode: 'task_invalidated' } }
      }
      if (eventSessionId === this.transport.getSessionId()) this.transport.notify('capability_response', { requestId: payload.requestId, result })
    } finally { this.requestIds.delete(invocationId) }
  }

  public async close(): Promise<StopReport> {
    this.ready = false
    this.negotiatedSession = null
    return this.broker.stopModule('computer')
  }
}
