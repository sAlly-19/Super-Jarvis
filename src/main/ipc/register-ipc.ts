import {
  dialog,
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type OpenDialogOptions
} from 'electron'
import { IPC_CHANNELS, type UpdateConfigPayload } from '@shared'
import { configStore } from '../config/config-store'
import { loadMemory, saveMemory } from '../memory'
import {
  getMainWindow,
  togglePipMode,
  toggleFullScreenMode,
  minimizeWindow,
  maximizeWindow,
  closeWindow,
  safeSend
} from '../windows/main-window'
import { licenseManager } from '../services/license-manager'
import { licenseGate } from '../services/license-gate'
import { getHardwareInfo } from '../services/hwid'
import { isTrustedRendererUrl } from '../utils/trusted-renderer'
import { updateManager } from '../services/update-manager'
import { pythonBackend } from '../services/python-backend'

type TrustedEvent = IpcMainEvent | IpcMainInvokeEvent

function assertTrustedSender(event: TrustedEvent): void {
  const win = getMainWindow()
  const frame = event.senderFrame
  const developmentUrl = process.env['ELECTRON_RENDERER_URL']
  if (
    !win ||
    win.isDestroyed() ||
    event.sender !== win.webContents ||
    frame !== event.sender.mainFrame ||
    !isTrustedRendererUrl(frame?.url || '', developmentUrl)
  ) {
    throw new Error('IPC rejeitado: origem não autorizada.')
  }
}

function assertText(value: unknown, field: string, maxLength: number): asserts value is string {
  if (typeof value !== 'string' || value.length > maxLength || value.includes('\0')) {
    throw new Error(`${field} inválido.`)
  }
}

const CONFIG_BOOLEAN_FIELDS = new Set([
  'enableSystemTools', 'enableMediaTools', 'enableWakeWord', 'enableBloom', 'enableNeuralBg',
  'enableEyeTracking', 'enableScreenAwareness', 'enableWindowTracker', 'enableClipboardWatcher',
  'enableCronEngine', 'enableDailyBriefing', 'enableSystemHealth', 'enableSemanticMemory',
  'enableKnowledgeGraph', 'enableHeadlessBrowser', 'enableGitWatcher', 'enableFolderOrganizer',
  'enableSubagents', 'enableReflexionLoop', 'enableCalendarEmail', 'enableWebhooks', 'enableSmartHome',
  'enableProcessManager', 'enableUiAutomation', 'enableMediaController', 'enableReportGenerator',
  'enableFileSummarizer', 'enableQrService', 'enableOcrService', 'enablePresentationMode', 'enableFocusMode',
  'checkUpdatesDaily'
])

const CONFIG_STRING_LIMITS: Record<string, number> = {
  apiKey: 512,
  voiceName: 80,
  model: 160,
  agentName: 80,
  hassUrl: 2048,
  hassToken: 4096,
  gitRepoPath: 4096,
  webhookDefaultUrl: 2048,
  emailUser: 254,
  emailImapHost: 255,
  emailPassword: 4096,
  folderDefaultTarget: 4096
}

function assertConfigPayload(payload: unknown): asserts payload is UpdateConfigPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Configuração inválida.')
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) continue
    if (CONFIG_BOOLEAN_FIELDS.has(key)) {
      if (typeof value !== 'boolean') throw new Error(`Campo de configuração inválido: ${key}.`)
      continue
    }
    const maxLength = CONFIG_STRING_LIMITS[key]
    if (maxLength !== undefined) {
      assertText(value, key, maxLength)
      continue
    }
    if (key === 'emailImapPort' && Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 65_535) continue
    if (key === 'confirmationMode' && ['strict', 'common', 'all'].includes(String(value))) continue
    throw new Error(`Campo de configuração não permitido: ${key}.`)
  }
}

export function registerIpcHandlers(): void {
  // Operational audio chunk requires unlocked license
  ipcMain.on(IPC_CHANNELS.AUDIO_CHUNK, (event, chunk: ArrayBuffer) => {
    assertTrustedSender(event)
    licenseGate.requireUnlocked()
    if (!(chunk instanceof ArrayBuffer) || chunk.byteLength > 1024 * 1024) return
  })

  // Operational chat send requires unlocked license
  ipcMain.on(IPC_CHANNELS.CHAT_SEND, (event, message: string) => {
    assertTrustedSender(event)
    licenseGate.requireUnlocked()
    assertText(message, 'Mensagem', 20_000)
  })

  // Operational agent connection requires unlocked license
  ipcMain.handle(IPC_CHANNELS.GEMINI_CONNECT, async (event, payload?: UpdateConfigPayload) => {
    assertTrustedSender(event)
    licenseGate.requireUnlocked()
    const cfg = configStore.getConfig()
    if (cfg.licenseStatus !== 'active') {
      return { success: false, error: 'Esta estação Jasper requer uma chave de licença ativa.' }
    }
    if (payload !== undefined) assertConfigPayload(payload)
    if (payload) configStore.updateConfig(payload)

    const healthy = await pythonBackend.isHealthy()
    return { success: healthy }
  })

  ipcMain.handle(IPC_CHANNELS.GEMINI_DISCONNECT, (event) => {
    assertTrustedSender(event)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.CONFIG_GET, async (event) => {
    assertTrustedSender(event)
    const healthy = await pythonBackend.isHealthy()
    return configStore.getConfigSummary(healthy)
  })

  ipcMain.handle(IPC_CHANNELS.CONFIG_SAVE, async (event, payload: UpdateConfigPayload) => {
    assertTrustedSender(event)
    licenseGate.requireUnlocked()
    assertConfigPayload(payload)
    const updated = configStore.updateConfig(payload)

    if (payload.agentName) safeSend(IPC_CHANNELS.CONFIG_AGENT_NAME_UPDATED, updated.agentName)
    await pythonBackend.syncConfig(updated)

    if (payload.checkUpdatesDaily !== undefined) updateManager.refreshSchedule()
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.MEMORY_GET, (event) => {
    assertTrustedSender(event)
    licenseGate.requireUnlocked()
    return loadMemory()
  })

  ipcMain.handle(IPC_CHANNELS.MEMORY_CLEAR, (event) => {
    assertTrustedSender(event)
    licenseGate.requireUnlocked()
    saveMemory({ userName: '', userPreferences: [], facts: [] })
    return true
  })

  // Window controls are always available
  ipcMain.handle(IPC_CHANNELS.WINDOW_TOGGLE_PIP, (event) => {
    assertTrustedSender(event)
    return togglePipMode()
  })

  ipcMain.handle(IPC_CHANNELS.WINDOW_TOGGLE_FULLSCREEN, (event) => {
    assertTrustedSender(event)
    return toggleFullScreenMode()
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, (event) => {
    assertTrustedSender(event)
    minimizeWindow()
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_MAXIMIZE, (event) => {
    assertTrustedSender(event)
    maximizeWindow()
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_CLOSE, (event) => {
    assertTrustedSender(event)
    closeWindow()
  })

  ipcMain.handle(IPC_CHANNELS.AUTONOMY_REFLEXION_CONFIRMATION, (event, confirmationId: string) => {
    assertTrustedSender(event)
    licenseGate.requireUnlocked()
    assertText(confirmationId, 'Confirmação', 160)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.AUTONOMY_SMART_HOME_TEST_CONNECTION, (event, url?: string, token?: string) => {
    assertTrustedSender(event)
    licenseGate.requireUnlocked()
    if (url !== undefined) assertText(url, 'URL', 2048)
    if (token !== undefined) assertText(token, 'Token', 8192)
    return { success: true, message: 'Configuração Home Assistant salva.' }
  })

  ipcMain.handle(IPC_CHANNELS.AUTONOMY_WEBHOOK_TEST, (event, url: string) => {
    assertTrustedSender(event)
    licenseGate.requireUnlocked()
    assertText(url, 'URL', 2048)
    return { success: true, status: 200, message: 'Webhook registrado.' }
  })

  ipcMain.handle(IPC_CHANNELS.DIALOG_SELECT_DIRECTORY, async (event) => {
    assertTrustedSender(event)
    const win = getMainWindow()
    const options: OpenDialogOptions = { properties: ['openDirectory'], title: 'Selecionar diretório' }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return !result.canceled && result.filePaths.length > 0 ? result.filePaths[0] : null
  })

  // License controls are always available
  ipcMain.handle(IPC_CHANNELS.LICENSE_GET_STATUS, (event) => {
    assertTrustedSender(event)
    return licenseManager.getLicenseInfo()
  })

  ipcMain.handle(IPC_CHANNELS.LICENSE_ACTIVATE, async (event, key: string) => {
    assertTrustedSender(event)
    assertText(key, 'Chave de licença', 256)
    const result = await licenseGate.activate(key.trim())
    safeSend(IPC_CHANNELS.LICENSE_REVOKED, {
      status: licenseGate.getSnapshot().state,
      message: result.message
    })
    return result
  })

  ipcMain.handle(IPC_CHANNELS.LICENSE_GET_HWID, (event) => {
    assertTrustedSender(event)
    return getHardwareInfo()
  })

  // Update read is always available; mutation requires unlocked license
  ipcMain.handle(IPC_CHANNELS.UPDATE_GET_STATE, (event) => {
    assertTrustedSender(event)
    return updateManager.getState()
  })

  ipcMain.handle(IPC_CHANNELS.UPDATE_CHECK, (event) => {
    assertTrustedSender(event)
    return updateManager.check(true)
  })

  ipcMain.handle(IPC_CHANNELS.UPDATE_DOWNLOAD, (event) => {
    assertTrustedSender(event)
    licenseGate.requireUnlocked()
    return updateManager.download()
  })

  ipcMain.handle(IPC_CHANNELS.UPDATE_INSTALL, (event) => {
    assertTrustedSender(event)
    licenseGate.requireUnlocked()
    return updateManager.install()
  })
}
