import { app, powerMonitor, safeStorage, shell, dialog } from 'electron'
import { startEmailApplication, type EmailApplication } from './email/application'
import { getMainWindow } from '../windows/main-window'
import { PcHealthStore } from './pc-health/store'
import { PcHealthService } from './pc-health/service'
import { HealthCollectorClient } from './pc-health/client'
import { createVisualReminderNotifier } from './reminders/visual-notifier'
import { safeSend } from '../windows/main-window'
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels'
import type { Reminder } from '../../shared/types/reminders'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ModuleRegistry } from './registry'
import { openModuleStore } from './installation'
import { ModuleLifecycle } from './lifecycle'
import { ModuleService } from './service'
import { ModulePolicy } from './policy'
import { ModuleRuntimeBridge } from './runtime-bridge'
import { InvocationStore } from './invocation-store'
import { StateDatabase } from '../storage/state-database'
import { pythonBackend } from '../services/python-backend'
import { operationalAccess } from '../services/operational-access'
import { licenseGate } from '../services/license-gate'
import { ModuleRefreshQueue } from './refresh-queue'
import { initializeTaskApplication, getTaskService } from '../tasks/application'
import { RemindersStore } from './reminders/store'
import { ReminderCalendar } from './reminders/calendar'
import { RemindersService } from './reminders/service'
import { isReminderCapability } from './reminders/capabilities'
import { startRemindersApplication } from './reminders/application'
import { RemindersDashboard } from './reminders/dashboard'
import { RemindersImportService } from './reminders/import-service'
import { ICalendarCodec } from './reminders/ical-client'
import { chooseCalendar, saveCalendar, createReminderPresentation } from './reminders/desktop'

let application: { service: ModuleService; bridge: ModuleRuntimeBridge; database: StateDatabase; reminderRuntime: ReturnType<typeof startRemindersApplication>; dashboard: RemindersDashboard; reminderStore: RemindersStore; presentation: ReturnType<typeof createReminderPresentation> } | undefined
let features: { moduleRuntimeVersion?: number } = {}
let featureSession: number | undefined
const refreshQueue = new ModuleRefreshQueue()
let pcHealth: PcHealthService | undefined
let closeHealth: (() => Promise<void>) | undefined
let email: EmailApplication | undefined
export function getEmailApplication(): EmailApplication { if (!email) throw new Error('email_unavailable'); return email }
export function getPcHealthApplication(): PcHealthService { if (!pcHealth) throw new Error('pc_health_unavailable'); return pcHealth }

export function initializeModuleApplication(): void {
  if (application) return
  const root = app.getAppPath()
  const registry = new ModuleRegistry(JSON.parse(fs.readFileSync(path.join(root, 'resources/modules/native-capabilities.json'), 'utf8')))
  const dataPath = app.getPath('userData')
  fs.mkdirSync(dataPath, { recursive: true })
  const sql = (name: string) => fs.readFileSync(path.join(root, 'src/main/storage/migrations', name), 'utf8')
  const store = openModuleStore(path.join(dataPath, 'modules.json'))
  const database = new StateDatabase(path.join(dataPath, 'jasper-state.sqlite'), sql('001-module-state.sql'), [sql('002-capability-invocations.sql'), sql('003-tasks.sql'), sql('004-task-evidence.sql'), sql('005-reminders.sql'), sql('006-reminder-imports.sql'), sql('007-pc-health.sql'), sql('008-email.sql')])
  const lifecycle = new ModuleLifecycle()
  const service = new ModuleService(store, lifecycle, () => operationalAccess.requireAgentAccess(), new Set(['computer', 'reminders', 'pc-health', 'email']))
  const policy = new ModulePolicy(registry, {
    requireAgentAccess: () => operationalAccess.requireAgentAccess(),
    getSnapshot: id => { const snapshot = service.getSnapshot(id); return id === 'email' && snapshot.enabled && snapshot.authorized && email ? { ...snapshot, ...email.status() } : snapshot }, getSessionId: () => pythonBackend.getSessionId(),
    // Download publication is deferred by the user; omit its permission from negotiated catalogs as well as failing closed in EmailService.
    getPermissions: id => registry.list().filter(capability => capability.moduleId === id).flatMap(capability => capability.permissions).filter(permission => id !== 'email' || permission !== 'email.attachments')
  })
  email = startEmailApplication({ database, profileRoot: dataPath, publisherRoot: root,
    crypto: { available: () => safeStorage.isEncryptionAvailable(), encrypt: text => safeStorage.encryptString(text), decrypt: bytes => safeStorage.decryptString(Buffer.from(bytes)) },
    authorizeAgent: (context, id) => { const decision = policy.authorize(id, context); if (!decision.allowed) throw new Error(decision.code) },
    authorizeManagement: () => { operationalAccess.requireAgentAccess(); const snapshot = service.getSnapshot('email'); if (!snapshot.enabled || snapshot.lifecycle !== 'running') throw new Error('email_unavailable') },
    moduleRevision: () => store.get('email').revision, sessionId: () => pythonBackend.getSessionId(),
    openBrowser: url => shell.openExternal(url),
    selectFiles: async () => { const window = getMainWindow(); if (!window || window.isDestroyed()) throw new Error('email_unavailable'); const result = await dialog.showOpenDialog(window, { properties: ['openFile', 'multiSelections'], title: 'Selecionar anexos de e-mail' }); return result.canceled ? [] : result.filePaths },
    selectDirectory: async () => { const window = getMainWindow(); if (!window || window.isDestroyed()) throw new Error('email_unavailable'); const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'], title: 'Pasta para anexos de e-mail' }); return result.canceled ? null : result.filePaths[0] ?? null },
    changed: () => { safeSend(IPC_CHANNELS.EMAIL_CHANGED, null); void refreshModuleRuntime().catch(() => {}) }
  })
  app.on('web-contents-created', (_event, contents) => {
    let wasMain = false
    contents.on('did-start-loading', () => { if (getMainWindow()?.webContents === contents) { wasMain = true; email?.abortPanel() } })
    contents.on('destroyed', () => { if (wasMain) email?.abortPanel() })
  })
  const reminderStore = new RemindersStore(database, new ReminderCalendar())
  const reminders = new RemindersService(reminderStore, registry, {
    nowUtc: () => new Date().toISOString(), authorize: (id, context) => { const decision = policy.authorize(id, context); if (!decision.allowed) throw new Error(decision.code) }
  })
  const healthAllowed = () => { const snapshot = service.getSnapshot('pc-health'); return snapshot.enabled && snapshot.authorized && snapshot.lifecycle === 'running' }
  const healthNotices = createVisualReminderNotifier(undefined, undefined, { title: 'Saúde do PC — Jasper', heading: 'Saúde do PC', footer: 'Observação de uso, sem reparo automático. Confira o painel Saúde do PC no Jasper.' })
  const health = new PcHealthService(new PcHealthStore(database), new HealthCollectorClient(path.join(__dirname, 'pc-health-worker.js')), {
    allowed: healthAllowed, now: Date.now, changed: () => safeSend(IPC_CHANNELS.PC_HEALTH_CHANGED, null),
    authorize: context => { const decision = policy.authorize('pc_health_read', context); if (!decision.allowed) throw new Error(decision.code) },
    closeNotices: () => healthNotices.close?.(),
    notify: (alerts, valid) => healthNotices.prepare({ title: 'Limites de uso atingidos', description: alerts.map(alert => alert.message).join('\n') } as Reminder,
      { beforeShow: valid, shown: () => {}, failed: () => {} }).show()
  })
  pcHealth = health
  const healthTimer = setInterval(() => { void health.poll().catch(() => {}) }, 1000); healthTimer.unref?.()
  const suspendHealth = () => { void health.suspend().catch(() => console.warn('[PcHealth] Collector termination uncertain.')) }, resumeHealth = () => { health.resume() }
  powerMonitor.on('suspend', suspendHealth); powerMonitor.on('resume', resumeHealth)
  closeHealth = async () => { clearInterval(healthTimer); powerMonitor.removeListener('suspend', suspendHealth); powerMonitor.removeListener('resume', resumeHealth); await health.stop() }
  const tasks = initializeTaskApplication(database, {
    verifyCapability: (context, id, result) => id.startsWith('email_') ? email!.service.verify(context, id, result) : id === 'pc_health_read' ? health.verify(context, id, result) : isReminderCapability(id) ? reminders.verify(context, id, result) : result,
    releaseObservation: id => { reminders.releaseObservation(id); health.releaseObservation(id); email!.service.releaseObservation(id) }, clearObservations: () => { reminders.clearObservations(); health.clearObservations(); email!.service.clearObservations() }
  })
  const bridge = new ModuleRuntimeBridge(registry, policy, new InvocationStore(database), pythonBackend, id => store.get(id).revision, tasks,
    { email: (id, args, context, signal) => email!.service.execute(id, args, context, signal), reminders: (id, args, context, signal) => reminders.execute(id, args, context, signal), 'pc-health': (id, args, context, signal) => health.execute(id, args, context, signal) })
  const reminderAllowed = () => {
    const snapshot = service.getSnapshot('reminders')
    return snapshot.enabled && snapshot.authorized && snapshot.lifecycle === 'running'
  }
  const authorizeReminders = () => { if (!reminderAllowed()) throw new Error('reminders_unavailable') }
  let dashboard: RemindersDashboard
  const presentation = createReminderPresentation(() => { if (dashboard) void dashboard.abortAll() })
  const reminderRuntime = startRemindersApplication(reminderStore, reminderAllowed, presentation)
  dashboard = new RemindersDashboard(reminderStore, reminders, new RemindersImportService(reminderStore, authorizeReminders),
    new ICalendarCodec(path.join(__dirname, 'reminders-ical-worker.js')), {
      authorize: authorizeReminders, sessionId: presentation.sessionId, chooseImport: chooseCalendar, exportFile: saveCalendar,
      context: () => ({ taskId: 'reminders-ui', stepId: 'manual', invocationId: randomUUID(), sessionId: pythonBackend.getSessionId(), moduleRevision: store.get('reminders').revision }),
      changed: presentation.changed
    })
  lifecycle.register('computer', () => bridge.stopModule('computer'))
  lifecycle.register('reminders', async () => { reminderRuntime.stop(); await dashboard.abortAll(); reminders.clearObservations(); return bridge.stopModule('reminders') })
  lifecycle.register('pc-health', async () => { await health.stop(); return bridge.stopModule('pc-health') })
  lifecycle.register('email', async () => { await email!.stop(); return bridge.stopModule('email') })
  application = { service, bridge, database, reminderRuntime, dashboard, reminderStore, presentation }
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
    if (snapshot.state !== 'unlocked') void email!.stop().catch(() => console.warn('[Email] Cleanup unavailable.'))
    else if (service.getSnapshot('email').enabled) void email!.restore().catch(() => console.warn('[Email] Credential restore unavailable.'))
    if (snapshot.state !== 'unlocked') { reminderRuntime.stop(); void health.stop().catch(() => console.warn('[PcHealth] Collector termination uncertain.')); void dashboard.abortAll(); void bridge.close() }
  })
}

export function getModuleService(): ModuleService {
  if (!application) throw new Error('module_application_unavailable')
  return application.service
}
export function getRemindersApplication() {
  if (!application) throw new Error('module_application_unavailable')
  return { dashboard: application.dashboard, scheduler: application.reminderRuntime.scheduler, store: application.reminderStore }
}

export function assertModuleRuntimeReady(): void {
  if (!application || !application.bridge.isReady()) throw new Error('Runtime modular indisponível. Reconecte o agente.')
}

export function listModuleSnapshots() {
  return getModuleService().list().map(snapshot => snapshot.id === 'email' && snapshot.enabled && snapshot.authorized && email ? { ...snapshot, ...email.status() } : snapshot.id === 'computer' && snapshot.enabled && snapshot.authorized
    && !application!.bridge.isReady() ? { ...snapshot, health: 'unavailable' as const, lifecycle: 'stopped' as const, errorCode: 'module_runtime_not_ready' } : snapshot)
}

export async function refreshModuleRuntime(): Promise<void> {
  await refreshQueue.run(async () => {
    if (!application) throw new Error('module_application_unavailable')
    if (application.service.getSnapshot('email').enabled) await email!.restore().catch(() => console.warn('[Email] Credential restore unavailable.'))
    if (featureSession !== pythonBackend.getSessionId()) throw new Error('module_runtime_not_negotiated')
    await application.bridge.negotiate(features, pythonBackend.getSessionId())
    const ack = await pythonBackend.request('task_runtime', { taskRuntimeVersion: 1, sessionId: pythonBackend.getSessionId() }) as { taskRuntimeVersion: number; sessionId: number }
    if (ack.taskRuntimeVersion !== 1 || ack.sessionId !== pythonBackend.getSessionId()) throw new Error('task_runtime_not_negotiated')
  })
}

export async function closeModuleApplication(): Promise<void> {
  if (!application) return
  await email?.stop()
  await closeHealth?.()
  application.reminderRuntime.close()
  application.presentation.close()
  await application.dashboard.close()
  getTaskService().interruptSession()
  await application.bridge.close()
  application.database.close()
}
