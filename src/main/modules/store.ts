import fs from 'node:fs'
import { MODULE_IDS, type ModuleId } from '../../shared/types/modules'
import { atomicWriteJsonSync, readJsonFileSync } from '../utils/atomic-json'

export interface StoredModule { enabled: boolean; revision: number }
interface ModuleDocument { version: 1; installationId: string; modules: Record<ModuleId, StoredModule> }

/** Main-only store. No credentials, authorizations or operational health are persisted here. */
export class ModuleStore {
  private document: ModuleDocument

  constructor(private readonly filename: string, private readonly installationId: string) {
    if (!installationId) throw new Error('invalid_installation')
    this.document = this.load()
  }

  private load(): ModuleDocument {
    if (!fs.existsSync(this.filename) && !fs.existsSync(`${this.filename}.bak`)) {
      return { version: 1, installationId: this.installationId,
        modules: Object.fromEntries(MODULE_IDS.map(id => [id, { enabled: id === 'computer', revision: 0 }])) as ModuleDocument['modules'] }
    }
    const document = readJsonFileSync<ModuleDocument>(this.filename)
    if (document?.installationId !== this.installationId) throw new Error('module_installation_mismatch')
    if (document.version !== 1 || !document.modules || Array.isArray(document.modules)
      || Object.keys(document).some(key => !['version', 'installationId', 'modules'].includes(key))
      || Object.keys(document.modules).length !== MODULE_IDS.length) throw new Error('invalid_module_store')
    for (const id of MODULE_IDS) {
      const record = document.modules[id]
      if (!record || typeof record.enabled !== 'boolean' || !Number.isSafeInteger(record.revision) || record.revision < 0
        || Object.keys(record).some(key => !['enabled', 'revision'].includes(key))) throw new Error('invalid_module_store')
    }
    return document
  }

  public get(id: ModuleId): StoredModule {
    if (!MODULE_IDS.includes(id)) throw new Error('unknown_module')
    this.document = this.load()
    return { ...this.document.modules[id] }
  }

  public setEnabled(id: ModuleId, enabled: boolean, expectedRevision: number): StoredModule {
    const current = this.get(id)
    if (typeof enabled !== 'boolean' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('invalid_module_update')
    if (current.revision !== expectedRevision) throw new Error('stale_module_revision')
    if (!Number.isSafeInteger(current.revision + 1)) throw new Error('module_revision_exhausted')
    const next = structuredClone(this.document)
    next.modules[id] = { enabled, revision: current.revision + 1 }
    atomicWriteJsonSync(this.filename, next)
    this.document = next
    return { ...next.modules[id] }
  }
}
