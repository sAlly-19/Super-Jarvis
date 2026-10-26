import type { AuthorizationDecision, ExecutionContext, ModuleId, ModuleSnapshot } from '../../shared/types/modules'
import { ModuleRegistry } from './registry'

export interface ModulePolicyDependencies {
  requireAgentAccess(): void
  getSnapshot(id: ModuleId): ModuleSnapshot | undefined
  getSessionId(): number
  getPermissions(id: ModuleId): readonly string[]
}

export class ModulePolicy {
  constructor(private readonly registry: ModuleRegistry, private readonly deps: ModulePolicyDependencies) {}

  public authorize(id: string, context: ExecutionContext): AuthorizationDecision {
    const deny = (code: string): AuthorizationDecision => ({ allowed: false, code })
    try {
      this.deps.requireAgentAccess()
      if (!context || !['taskId', 'stepId', 'invocationId'].every(key => {
        const value = context[key as keyof ExecutionContext]
        return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value)
      }) || !Number.isSafeInteger(context.sessionId) || !Number.isSafeInteger(context.moduleRevision)
        || context.sessionId < 0 || context.moduleRevision < 0) return deny('invalid_context')
      const capability = this.registry.get(id)
      if (!capability) return deny('unknown_capability')
      const state = this.deps.getSnapshot(capability.moduleId)
      if (!state || state.id !== capability.moduleId || !state.enabled || !state.configured || !state.authorized
        || state.health !== 'healthy' || state.lifecycle !== 'running') return deny('module_unavailable')
      if (context.sessionId !== this.deps.getSessionId() || context.moduleRevision !== state.revision) return deny('stale_context')
      const permissions = this.deps.getPermissions(capability.moduleId)
      if (!capability.permissions.every(permission => permissions.includes(permission))) return deny('permission_denied')
      return { allowed: true }
    } catch { return deny('access_denied') }
  }
}
