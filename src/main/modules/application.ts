import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { ModuleRegistry } from './registry'
import { ModuleStore } from './store'
import { ModuleLifecycle } from './lifecycle'
import { ModuleService } from './service'
import { ModulePolicy } from './policy'
import { ModuleRuntimeBridge } from './runtime-bridge'
import { InvocationStore } from './invocation-store'
import { StateDatabase } from '../storage/state-database'
import { pythonBackend } from '../services/python-backend'
import { operationalAccess } from '../services/operational-access'
import { licenseGate } from '../services/license-gate'
import { getHardwareInfo } from '../services/hwid'
import { ModuleRefreshQueue } from './refresh-queue'
import { initializeTaskApplication, getTaskService } from '../tasks/application'

let application: { service: ModuleService; bridge: ModuleRuntimeBridge; database: StateDatabase } | undefined
let features: { moduleRuntimeVersion?: number } = {}
let featureSession: number | undefined
const refreshQueue = new ModuleRefreshQueue()

export function initializeModuleApplication(): void {
  if (application) return
  const root = app.getAppPath()
  const registry = new ModuleRegistry(JSON.parse(fs.readFileSync(path.join(root, 'resources/modules/native-capabilities.json'), 'utf8')))
  const dataPath = app.getPath('userData')
  fs.mkdirSync(dataPath, { recursive: true })
  const sql = (name: string) => fs.readFileSync(path.join(root, 'src/main/storage/migrations', name), 'utf8')
  const database = new StateDatabase(path.join(dataPath, 'jasper-state.sqlite'), sql('001-module-state.sql'), [sql('002-capability-invocations.sql'), sql('003-tasks.sql')])
  const tasks = initializeTaskApplication(database)
  const store = new ModuleStore(path.join(dataPath, 'modules.json'), getHardwareInfo().machineId)
  const lifecycle = new ModuleLifecycle()
  const service = new ModuleService(store, lifecycle, () => operationalAccess.requireAgentAccess())
  const policy = new ModulePolicy(registry, {
    requireAgentAccess: () => operationalAccess.requireAgentAccess(),
    getSnapshot: id => service.getSnapshot(id), getSessionId: () => pythonBackend.getSessionId(),
    getPermissions: id => registry.list().filter(capability => capability.moduleId === id).flatMap(capability => capability.permissions)
  })
  const bridge = new ModuleRuntimeBridge(registry, policy, new InvocationStore(database), pythonBackend, () => store.get('computer').revision, tasks)
  lifecycle.register('computer', () => bridge.close())
  application = { service, bridge, database }
  pythonBackend.onMessage((frame, sessionId) => {
    if (frame.type === 'hello_ack') {
      features = frame.payload as { moduleRuntimeVersion?: number }
      featureSession = sessionId
    }
    if (frame.type === 'capability_request' || frame.type === 'capability_cancel_request') {
      void bridge.handle(frame, sessionId).catch(() => { console.warn('[Modules] Invalid modular request.') })
    }
  })
  licenseGate.onStateChanged(snapshot => {
    if (snapshot.state !== 'unlocked') void bridge.close()
  })
}

export function getModuleService(): ModuleService {
  if (!application) throw new Error('module_application_unavailable')
  return application.service
}

export function assertModuleRuntimeReady(): void {
  if (!application || !application.bridge.isReady()) throw new Error('Runtime modular indisponível. Reconecte o agente.')
}

export function listModuleSnapshots() {
  return getModuleService().list().map(snapshot => snapshot.id === 'computer' && snapshot.enabled && snapshot.authorized
    && !application!.bridge.isReady() ? { ...snapshot, health: 'unavailable' as const, lifecycle: 'stopped' as const, errorCode: 'module_runtime_not_ready' } : snapshot)
}

export async function refreshModuleRuntime(): Promise<void> {
  await refreshQueue.run(async () => {
    if (!application) throw new Error('module_application_unavailable')
    if (featureSession !== pythonBackend.getSessionId()) throw new Error('module_runtime_not_negotiated')
    await application.bridge.negotiate(features, pythonBackend.getSessionId())
    const ack = await pythonBackend.request('task_runtime', { taskRuntimeVersion: 1, sessionId: pythonBackend.getSessionId() }) as { taskRuntimeVersion: number; sessionId: number }
    if (ack.taskRuntimeVersion !== 1 || ack.sessionId !== pythonBackend.getSessionId()) throw new Error('task_runtime_not_negotiated')
  })
}

export async function closeModuleApplication(): Promise<void> {
  if (!application) return
  getTaskService().interruptSession()
  await application.bridge.close()
  application.database.close()
}
