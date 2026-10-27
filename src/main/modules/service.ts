import { MODULE_IDS, type ModuleId, type ModuleSnapshot } from '../../shared/types/modules'
import { ModuleStore } from './store'
import { ModuleLifecycle } from './lifecycle'

export class ModuleService {
  private readonly stopping = new Set<ModuleId>()
  private readonly stopErrors = new Set<ModuleId>()

  constructor(private readonly store: ModuleStore, private readonly lifecycle: ModuleLifecycle,
    private readonly requireAgentAccess: () => void, private readonly implemented: ReadonlySet<ModuleId> = new Set(['computer'])) {}

  public getSnapshot(id: ModuleId): ModuleSnapshot {
    const record = this.store.get(id)
    const implemented = this.implemented.has(id)
    let authorized = false
    try { this.requireAgentAccess(); authorized = true } catch { /* No private diagnostic reaches renderer. */ }
    const stopping = this.stopping.has(id) || this.stopErrors.has(id)
    return { id, ...record, configured: implemented, authorized,
      health: this.stopErrors.has(id) ? 'error' : implemented ? 'healthy' : 'unavailable',
      lifecycle: stopping ? 'stopping' : implemented && record.enabled && authorized ? 'running' : 'stopped',
      ...(!implemented ? { errorCode: 'not_implemented' } : this.stopErrors.has(id) ? { errorCode: 'module_stop_failed' } : {}) }
  }

  public list(): ModuleSnapshot[] { return MODULE_IDS.map(id => this.getSnapshot(id)) }

  public async setEnabled(id: ModuleId, enabled: boolean, expectedRevision: number): Promise<ModuleSnapshot> {
    this.requireAgentAccess()
    if (this.stopping.has(id) || this.stopErrors.has(id)) throw new Error('module_stopping')
    if (enabled && !this.implemented.has(id)) throw new Error('not_implemented')
    this.store.setEnabled(id, enabled, expectedRevision)
    if (!enabled) {
      this.stopping.add(id)
      try {
        const report = await this.lifecycle.stop(id, 'disabled')
        if (!report.stopped) this.stopErrors.add(id)
      } finally { this.stopping.delete(id) }
    }
    return this.getSnapshot(id)
  }

  public async configure(id: ModuleId, _settings: unknown, _expectedRevision: number): Promise<ModuleSnapshot> {
    this.requireAgentAccess()
    this.store.get(id)
    throw new Error('configuration_not_supported')
  }

  public async diagnose(id: ModuleId): Promise<ModuleSnapshot> {
    this.requireAgentAccess()
    return this.getSnapshot(id)
  }
}
