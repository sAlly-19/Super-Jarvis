import type { ModuleId } from '../../shared/types/modules'

export interface StopReport { stopped: boolean; unknownInvocationIds: string[]; errorCode?: string }
export class ModuleLifecycle {
  private readonly generations = new Map<ModuleId, number>()
  private readonly stoppers = new Map<ModuleId, (reason: string) => Promise<StopReport>>()

  public register(id: ModuleId, stop: (reason: string) => Promise<StopReport>): void {
    if (this.stoppers.has(id)) throw new Error('duplicate_module_stopper')
    this.stoppers.set(id, stop)
  }
  public generation(id: ModuleId): number { return this.generations.get(id) ?? 0 }
  public isCurrent(id: ModuleId, generation: number): boolean { return generation === this.generation(id) }

  public async stop(id: ModuleId, reason: string): Promise<StopReport> {
    this.generations.set(id, this.generation(id) + 1)
    try {
      return await this.stoppers.get(id)?.(reason) ?? { stopped: true, unknownInvocationIds: [] }
    } catch { return { stopped: false, unknownInvocationIds: [], errorCode: 'module_stop_failed' } }
  }
}
