import type { CapabilityResult, ExecutionContext, ModuleId } from '../../shared/types/modules'
import { ModuleRegistry } from './registry'
import { ModulePolicy } from './policy'
import type { StopReport } from './lifecycle'
import { InvocationStore } from './invocation-store'

type Executor = (id: string, args: unknown, context: ExecutionContext, signal: AbortSignal) => Promise<unknown>
interface RunningInvocation {
  moduleId: ModuleId
  controller: AbortController
  work: Promise<void>
  settled: boolean
}

/** Main-side admission and cancellation; runtime wiring is separate from this component. */
export class ExecutionBroker {
  private readonly active = new Map<string, RunningInvocation>()

  constructor(private readonly registry: ModuleRegistry, private readonly policy: ModulePolicy,
    private readonly executor: Executor, private readonly invocations: InvocationStore) {}

  public async invoke(id: string, args: unknown, context: ExecutionContext): Promise<CapabilityResult> {
    const error = (status: 'failed' | 'unknown', errorCode: string): CapabilityResult => ({ status, errorCode, evidence: [] })
    const decision = this.policy.authorize(id, context)
    if (!decision.allowed) return error('failed', decision.code)
    try { this.registry.validateInput(id, args) } catch { return error('failed', 'invalid_input') }
    const key = context.invocationId
    try {
      if (!this.invocations.reserve(id, context)) return error('failed', 'duplicate_invocation')
    } catch { return error('failed', 'invocation_store_unavailable') }
    const definition = this.registry.get(id)!
    const invocation: RunningInvocation = { moduleId: definition.moduleId, controller: new AbortController(), work: Promise.resolve(), settled: false }
    this.active.set(key, invocation)
    let timer: ReturnType<typeof setTimeout> | undefined
    let finish!: (value: CapabilityResult) => void
    const result = new Promise<CapabilityResult>(resolve => { finish = resolve })
    timer = setTimeout(() => {
      invocation.controller.abort()
      finish(error('unknown', 'execution_timeout'))
    }, definition.timeoutMs)
    invocation.work = (async () => {
      try {
        const value = await this.executor(id, structuredClone(args), { ...context }, invocation.controller.signal)
        if (invocation.controller.signal.aborted || !this.policy.authorize(id, context).allowed) {
          finish(error('unknown', 'execution_invalidated'))
          return
        }
        this.registry.validateOutput(id, value)
        // Raw output is not proof of an arbitrary objective. Verification belongs to a capability verifier.
        finish({ status: 'unknown', data: value, evidence: [], errorCode: 'verification_unavailable' })
      } catch { finish(error('unknown', invocation.controller.signal.aborted ? 'execution_cancelled' : 'execution_failed')) }
      finally {
        if (timer) clearTimeout(timer)
        invocation.settled = true
        this.active.delete(key)
      }
    })()
    return result
  }

  public async stopModule(id: ModuleId): Promise<StopReport> {
    const records = [...this.active.entries()].filter(([, invocation]) => invocation.moduleId === id)
    for (const [, invocation] of records) invocation.controller.abort()
    // Worker cleanup must be awaited, but an executor ignoring cancellation remains explicitly uncertain.
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      Promise.all(records.map(([, invocation]) => invocation.work)),
      new Promise<void>(resolve => { timer = setTimeout(resolve, 1000) })
    ])
    if (timer) clearTimeout(timer)
    const unknownInvocationIds = records.filter(([, invocation]) => !invocation.settled).map(([key]) => key)
    return { stopped: unknownInvocationIds.length === 0, unknownInvocationIds }
  }

  public cancelInvocation(id: string): void {
    this.active.get(id)?.controller.abort()
  }
}
