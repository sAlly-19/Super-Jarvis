import { MODULE_IDS, type CapabilityDefinition } from '../../shared/types/modules'
import { assertSchema, validateValue } from './schema'

export class ModuleRegistry {
  private readonly entries = new Map<string, CapabilityDefinition>()

  constructor(definitions: CapabilityDefinition[]) {
    if (!Array.isArray(definitions)) throw new Error('invalid_manifest')
    for (const definition of definitions) {
      if (!definition || typeof definition.id !== 'string' || !/^[a-z][a-z0-9_]{0,159}$/.test(definition.id)
        || !MODULE_IDS.includes(definition.moduleId) || typeof definition.description !== 'string'
        || !definition.description.trim() || !Number.isSafeInteger(definition.timeoutMs) || definition.timeoutMs <= 0
        || typeof definition.cancellable !== 'boolean') throw new Error('invalid_capability')
      for (const list of [definition.permissions, definition.configurationKeys, definition.effects]) {
        if (!Array.isArray(list) || list.some(item => typeof item !== 'string' || !item)) throw new Error('invalid_capability')
      }
      if (this.entries.has(definition.id)) throw new Error('duplicate_capability')
      assertSchema(definition.inputSchema)
      assertSchema(definition.outputSchema)
      this.entries.set(definition.id, structuredClone(definition))
    }
  }

  public get(id: string): CapabilityDefinition | undefined {
    const entry = this.entries.get(id)
    return entry ? structuredClone(entry) : undefined
  }

  public list(): CapabilityDefinition[] { return [...this.entries.values()].map(entry => structuredClone(entry)) }

  public validateInput(id: string, value: unknown): void {
    const entry = this.entries.get(id)
    if (!entry) throw new Error('unknown_capability')
    validateValue(entry.inputSchema, value)
  }

  public validateOutput(id: string, value: unknown): void {
    const entry = this.entries.get(id)
    if (!entry) throw new Error('unknown_capability')
    validateValue(entry.outputSchema, value)
  }
}
