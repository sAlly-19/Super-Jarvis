import { MODULE_IDS, type ModuleId } from '../../shared/types/modules'

export function assertModuleId(id: unknown): asserts id is ModuleId {
  if (typeof id !== 'string' || !MODULE_IDS.includes(id as ModuleId)) throw new Error('unknown_module')
}
export function assertModuleUpdate(payload: unknown): asserts payload is { id: ModuleId; enabled: boolean; expectedRevision: number } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('invalid_module_update')
  const value = payload as Record<string, unknown>
  assertModuleId(value.id)
  if (Object.keys(value).length !== 3 || typeof value.enabled !== 'boolean'
    || typeof value.expectedRevision !== 'number' || !Number.isSafeInteger(value.expectedRevision)
    || value.expectedRevision < 0) throw new Error('invalid_module_update')
}
