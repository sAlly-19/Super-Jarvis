import {
  dialog,
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type OpenDialogOptions
} from 'electron'
import {
  IPC_CHANNELS,
  LOCKED_ALLOWED_CHANNELS,
  type UpdateConfigPayload,
  type BackendEnvelope,
  type IpcChannel,
  type LicenseState
} from '@shared'
import { configStore } from '../config/config-store'
import { memoryStore, loadMemory, clearMemory } from '../memory'
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
import { operationalAccess } from '../services/operational-access'
import { auditLog } from '../services/audit-log'
import { getHardwareInfo } from '../services/hwid'
import { isTrustedRendererUrl } from '../utils/trusted-renderer'
import { updateManager } from '../services/update-manager'
import { pythonBackend } from '../services/python-backend'

export type TrustedEvent = IpcMainEvent | IpcMainInvokeEvent

export function isBackendEnvelopeForwardingAllowed(
  licenseState: LicenseState,
  activeSessionId: number | null,
  eventSessionId: number
): boolean {
  return licenseState === 'unlocked' && activeSessionId !== null && activeSessionId === eventSessionId
}

function requireIpcAccess(channel: IpcChannel): void {
  if (!LOCKED_ALLOWED_CHANNELS.has(channel)) licenseGate.requireUnlocked()
}

export function assertTrustedSender(event: TrustedEvent): void {
  const win = getMainWindow()
  const frame = event.senderFrame
  const developmentUrl = process.env['ELECTRON_RENDERER_URL']

  if (!frame || (frame.parent !== null && frame !== event.sender.mainFrame)) {
    throw new Error('Untrusted IPC sender frame: nested iframes not permitted.')
  }

  if (win && !win.isDestroyed() && event.sender !== win.webContents) {
    throw new Error('Untrusted IPC sender: unrecognized webContents.')
  }

  const frameUrl = frame?.url || ''
  if (!isTrustedRendererUrl(frameUrl, developmentUrl)) {
    throw new Error(`Untrusted IPC sender origin: ${frameUrl}`)
  }
}

export function assertText(value: unknown, field: string, maxLength: number): asserts value is string {
  if (typeof value !== 'string' || value.length > maxLength || value.includes('\0')) {
    throw new Error(`${field} inválido.`)
  }
}

export function assertTextPayload(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.includes('\0')) {
    throw new Error('Payload de texto inválido: esperado string sem caracteres nulos.')
  }
  if (value.length > 20_000) {
    throw new Error('Texto de mensagem excede limite de 20.000 caracteres.')
  }
}

export function assertAudioPayload(chunk: unknown): asserts chunk is Buffer | ArrayBuffer | Uint8Array {
  const isBuffer = Buffer.isBuffer(chunk)
  const isArrayBuffer = chunk instanceof ArrayBuffer
  const isView = ArrayBuffer.isView(chunk)

  if (!isBuffer && !isArrayBuffer && !isView) {
    throw new Error('Payload de áudio inválido: esperado Buffer, ArrayBuffer ou TypedArray.')
  }

  const byteLength = isBuffer
    ? chunk.byteLength
    : isArrayBuffer
      ? chunk.byteLength
      : (chunk as ArrayBufferView).byteLength

  if (byteLength > 16 * 1024 * 1024) {
    throw new Error('Payload de áudio excede o limite de 16 MiB.')
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

export function assertConfigPayload(payload: unknown): asserts payload is UpdateConfigPayload {
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
    throw new Error(`Campo de configuração não permitido: ${key}.`)
  }
}

let backendForwardingWired = false
let activeBackendSessionId: number | null = null

function wireBackendForwarding(): void {
  if (backendForwardingWired) return
  backendForwardingWired = true

  pythonBackend.onMessage((envelope: BackendEnvelope, sessionId: number) => {
    if (!isBackendEnvelopeForwardingAllowed(licenseGate.getSnapshot().state, activeBackendSessionId, sessionId)) {
      return
    }
    switch (envelope.type) {
      case 'status':
        if ((envelope.payload as any)?.status === 'connected' || (envelope.payload as any)?.status === 'ready') {
          try {
            const currentMem = memoryStore.load()
            pythonBackend.notify('memory_snapshot', {
              facts: currentMem.facts.map((f) => ({ id: f.id, fact: f.fact, createdAt: f.createdAt }))
            })
          } catch (err) {
            console.warn('[IPC] Failed to push memory snapshot to sidecar:', err)
          }
        }
        safeSend(IPC_CHANNELS.AGENT_STATUS, envelope.payload)
        break
      case 'memory_upsert':
        if (envelope.payload && Array.isArray((envelope.payload as any).facts)) {
          memoryStore.upsertFacts((envelope.payload as any).facts)
        }
        break
      case 'memory_clear':
        memoryStore.clear()
        break
      case 'response':
        safeSend(IPC_CHANNELS.AGENT_TEXT, (envelope.payload as any)?.text ?? '')
        break
      case 'audio_output':
        safeSend(IPC_CHANNELS.AGENT_AUDIO, envelope.payload)
        break
      case 'user_transcript':
        safeSend(IPC_CHANNELS.AGENT_USER_TRANSCRIPT, (envelope.payload as any)?.text ?? '')
        break
      case 'tool_execution':
        void auditLog.write({
          event: 'tool_execution',
          tool: (envelope.payload as any)?.tool,
          status: 'started'
        })
        safeSend(IPC_CHANNELS.AGENT_TOOL_EXECUTION, envelope.payload)
        break
      case 'tool_result':
        void auditLog.write({
          event: 'tool_result',
          tool: (envelope.payload as any)?.tool,
          status: (envelope.payload as any)?.status || 'completed',
          durationMs: (envelope.payload as any)?.durationMs
        })
        safeSend(IPC_CHANNELS.AGENT_TOOL_RESULT, envelope.payload)
        break
      case 'turn_complete':
        safeSend(IPC_CHANNELS.AGENT_TURN_COMPLETE)
        break
      case 'interrupted':
        safeSend(IPC_CHANNELS.AGENT_INTERRUPTED)
        break
      case 'error':
        void auditLog.write({
          event: 'error',
          status: 'error',
          details: { message: (envelope.payload as any)?.message }
        })
        safeSend(IPC_CHANNELS.AGENT_ERROR, envelope.payload)
        break
    }
  })

  licenseGate.onStateChanged((snapshot) => {
    activeBackendSessionId = snapshot.state === 'unlocked' ? pythonBackend.getSessionId() : null
    safeSend(IPC_CHANNELS.LICENSE_STATUS_CHANGED, snapshot)
  })
}

export function registerIpcHandlers(): void {
  wireBackendForwarding()

  // Agent text prompt
  ipcMain.on(IPC_CHANNELS.AGENT_SEND_TEXT, (event, message: unknown) => {
    assertTrustedSender(event)
    requireIpcAccess(IPC_CHANNELS.AGENT_SEND_TEXT)
    operationalAccess.requireAgentAccess()
    assertTextPayload(message)
    pythonBackend.notify('chat', { text: message })
  })

  // Agent audio chunk
  ipcMain.on(IPC_CHANNELS.AGENT_SEND_AUDIO, (event, chunk: unknown) => {
    assertTrustedSender(event)
    requireIpcAccess(IPC_CHANNELS.AGENT_SEND_AUDIO)
    operationalAccess.requireAgentAccess()
    assertAudioPayload(chunk)

    const base64Audio = Buffer.isBuffer(chunk)
      ? chunk.toString('base64')
      : Buffer.from(chunk as ArrayBuffer).toString('base64')

    pythonBackend.notify('audio_input', { audio_base64: base64Audio })
  })

  // Agent interrupt
  ipcMain.on(IPC_CHANNELS.AGENT_INTERRUPT, (event) => {
    assertTrustedSender(event)
    requireIpcAccess(IPC_CHANNELS.AGENT_INTERRUPT)
    operationalAccess.requireAgentAccess()
    pythonBackend.notify('interrupt', {})
  })

  // Agent connection
  ipcMain.handle(IPC_CHANNELS.AGENT_CONNECT, async (event, payload?: UpdateConfigPayload) => {
    assertTrustedSender(event)
    requireIpcAccess(IPC_CHANNELS.AGENT_CONNECT)
    const cfg = configStore.getConfig()
    if (cfg.licenseStatus !== 'active') {
      return { success: false, error: 'Esta estação Jasper requer uma chave de licença ativa.' }
    }
    if (payload !== undefined) assertConfigPayload(payload)
    if (payload) configStore.updateConfig(payload)

    const healthy = await pythonBackend.isHealthy()
    return { success: healthy }
  })

  ipcMain.handle(IPC_CHANNELS.AGENT_DISCONNECT, (event) => {
    assertTrustedSender(event)
    requireIpcAccess(IPC_CHANNELS.AGENT_DISCONNECT)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.AGENT_GET_STATUS, async (event) => {
    assertTrustedSender(event)
    requireIpcAccess(IPC_CHANNELS.AGENT_GET_STATUS)
    return {
      state: pythonBackend.getState(),
      healthy: await pythonBackend.isHealthy()
    }
  })

  // Commercial Control Consent
  ipcMain.handle(IPC_CHANNELS.CONSENT_GET_STATUS, (event) => {
    assertTrustedSender(event)
    requireIpcAccess(IPC_CHANNELS.CONSENT_GET_STATUS)
    return { accepted: operationalAccess.isConsentAccepted() }
  })

  ipcMain.handle(IPC_CHANNELS.CONSENT_ACCEPT, (event) => {
    assertTrustedSender(event)
    requireIpcAccess(IPC_CHANNELS.CONSENT_ACCEPT)
    operationalAccess.acceptConsent()
    return { success: true }
  })

  // Configuration
  ipcMain.handle(IPC_CHANNELS.CONFIG_GET, async (event) => {
    assertTrustedSender(event)
    requireIpcAccess(IPC_CHANNELS.CONFIG_GET)
    const healthy = await pythonBackend.isHealthy()
    return configStore.getConfigSummary(healthy)
  })

  ipcMain.handle(IPC_CHANNELS.CONFIG_SAVE, async (event, payload: UpdateConfigPayload) => {
    assertTrustedSender(event)
    requireIpcAccess(IPC_CHANNELS.CONFIG_SAVE)
    assertConfigPayload(payload)
    const updated = configStore.updateConfig(payload)

    if (payload.agentName) safeSend(IPC_CHANNELS.CONFIG_AGENT_NAME_UPDATED, updated.agentName)
    await pythonBackend.syncConfig(updated)

    if (payload.checkUpdatesDaily !== undefined) updateManager.refreshSchedule()
    return { success: true }
  })

  // Memory
  ipcMain.handle(IPC_CHANNELS.MEMORY_GET, (event) => {
    assertTrustedSender(event)
    requireIpcAccess(IPC_CHANNELS.MEMORY_GET)
    operationalAccess.requireAgentAccess()
    return loadMemory()
  })

  ipcMain.handle(IPC_CHANNELS.MEMORY_CLEAR, (event) => {
    assertTrustedSender(event)
    requireIpcAccess(IPC_CHANNELS.MEMORY_CLEAR)
    operationalAccess.requireAgentAccess()
    clearMemory()
    pythonBackend.notify('memory_clear', {})
    return true
  })

  // Window controls
  ipcMain.handle(IPC_CHANNELS.WINDOW_TOGGLE_PIP, (event) => {
    assertTrustedSender(event)
    requireIpcAccess(IPC_CHANNELS.WINDOW_TOGGLE_PIP)
    return togglePipMode()
  })

  ipcMain.handle(IPC_CHANNELS.WINDOW_TOGGLE_FULLSCREEN, (event) => {
    assertTrustedSender(event)
    requireIpcAccess(IPC_CHANNELS.WINDOW_TOGGLE_FULLSCREEN)
    return toggleFullScreenMode()
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, (event) => {
    assertTrustedSender(event)
    requireIpcAccess(IPC_CHANNELS.WINDOW_MINIMIZE)
    minimizeWindow()
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_MAXIMIZE, (event) => {
    assertTrustedSender(event)
    requireIpcAccess(IPC_CHANNELS.WINDOW_MAXIMIZE)
    maximizeWindow()
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_CLOSE, (event) => {
    assertTrustedSender(event)
    requireIpcAccess(IPC_CHANNELS.WINDOW_CLOSE)
    closeWindow()
  })

  // Dialog
  ipcMain.handle(IPC_CHANNELS.DIALOG_SELECT_DIRECTORY, async (event) => {
    assertTrustedSender(event)
    requireIpcAccess(IPC_CHANNELS.DIALOG_SELECT_DIRECTORY)
    const win = getMainWindow()
    const options: OpenDialogOptions = { properties: ['openDirectory'], title: 'Selecionar diretório' }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return !result.canceled && result.filePaths.length > 0 ? result.filePaths[0] : null
  })

  // License controls
  ipcMain.handle(IPC_CHANNELS.LICENSE_GET_STATUS, (event) => {
    assertTrustedSender(event)
    requireIpcAccess(IPC_CHANNELS.LICENSE_GET_STATUS)
    return {
      ...licenseManager.getLicenseInfo(),
      gateSnapshot: licenseGate.getSnapshot()
    }
  })

  ipcMain.handle(IPC_CHANNELS.LICENSE_ACTIVATE, async (event, key: string) => {
    assertTrustedSender(event)
    requireIpcAccess(IPC_CHANNELS.LICENSE_ACTIVATE)
    assertText(key, 'Chave de licença', 256)
    return licenseGate.activate(key.trim())
  })

  ipcMain.handle(IPC_CHANNELS.LICENSE_GET_HWID, (event) => {
    assertTrustedSender(event)
    requireIpcAccess(IPC_CHANNELS.LICENSE_GET_HWID)
    return getHardwareInfo()
  })

  // Update APIs
  ipcMain.handle(IPC_CHANNELS.UPDATE_GET_STATE, (event) => {
    assertTrustedSender(event)
    requireIpcAccess(IPC_CHANNELS.UPDATE_GET_STATE)
    return updateManager.getState()
  })

  ipcMain.handle(IPC_CHANNELS.UPDATE_CHECK, (event) => {
    assertTrustedSender(event)
    requireIpcAccess(IPC_CHANNELS.UPDATE_CHECK)
    return updateManager.check(true)
  })

  ipcMain.handle(IPC_CHANNELS.UPDATE_DOWNLOAD, (event) => {
    assertTrustedSender(event)
    requireIpcAccess(IPC_CHANNELS.UPDATE_DOWNLOAD)
    return updateManager.download()
  })

  ipcMain.handle(IPC_CHANNELS.UPDATE_INSTALL, (event) => {
    assertTrustedSender(event)
    requireIpcAccess(IPC_CHANNELS.UPDATE_INSTALL)
    return updateManager.install()
  })
}
