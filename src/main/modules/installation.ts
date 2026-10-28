import { ModuleStore } from './store'
import { getHardwareInfo } from '../services/hwid'

/** Retry the actual hardware probe; a stored installation ID never grants authority. */
export function openModuleStore(filename: string,
  identity: () => string = () => getHardwareInfo().machineId,
  refresh: () => string = () => getHardwareInfo({ refresh: true, timeoutMs: 20000 }).machineId): ModuleStore {
  try { return new ModuleStore(filename, identity()) }
  catch (error) {
    if (!(error instanceof Error) || error.message !== 'module_installation_mismatch') throw error
    return new ModuleStore(filename, refresh())
  }
}
