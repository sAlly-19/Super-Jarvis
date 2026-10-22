import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  type UpdateConfigPayload,
  type ConfigSummary,
  type JasperMemory,
  type AutonomyNotification,
  type WebhookTriggerResult,
  type LicenseInfo,
  type LicenseValidationResult,
  type UpdateState
} from '@shared'

contextBridge.exposeInMainWorld('electronAPI', {
  // Audio & Text streaming
  sendAudioChunk: (chunk: ArrayBuffer): void => {
    ipcRenderer.send(IPC_CHANNELS.AUDIO_CHUNK, chunk)
  },
  sendTextMessage: (text: string): void => {
    ipcRenderer.send(IPC_CHANNELS.CHAT_SEND, text)
  },
  onAudioChunk: (callback: (base64Audio: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: string): void => callback(data)
    ipcRenderer.on(IPC_CHANNELS.GEMINI_AUDIO_CHUNK, handler)
    return (): void => {
      ipcRenderer.removeListener(IPC_CHANNELS.GEMINI_AUDIO_CHUNK, handler)
    }
  },
  onInterrupted: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on(IPC_CHANNELS.GEMINI_INTERRUPTED, handler)
    return (): void => {
      ipcRenderer.removeListener(IPC_CHANNELS.GEMINI_INTERRUPTED, handler)
    }
  },
  onTurnComplete: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on(IPC_CHANNELS.GEMINI_TURN_COMPLETE, handler)
    return (): void => {
      ipcRenderer.removeListener(IPC_CHANNELS.GEMINI_TURN_COMPLETE, handler)
    }
  },
  onTextChunk: (callback: (text: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, text: string): void => callback(text)
    ipcRenderer.on(IPC_CHANNELS.GEMINI_TEXT_CHUNK, handler)
    return (): void => {
      ipcRenderer.removeListener(IPC_CHANNELS.GEMINI_TEXT_CHUNK, handler)
    }
  },
  onStatusChange: (callback: (status: string, message?: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: string, message?: string): void => callback(status, message)
    ipcRenderer.on(IPC_CHANNELS.GEMINI_STATUS, handler)
    return (): void => {
      ipcRenderer.removeListener(IPC_CHANNELS.GEMINI_STATUS, handler)
    }
  },

  // Gemini & Configuration
  connectGemini: (config?: UpdateConfigPayload): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.GEMINI_CONNECT, config)
  },
  disconnectGemini: (): Promise<void> => {
    return ipcRenderer.invoke(IPC_CHANNELS.GEMINI_DISCONNECT)
  },
  getConfig: (): Promise<ConfigSummary> => {
    return ipcRenderer.invoke(IPC_CHANNELS.CONFIG_GET)
  },
  saveConfig: (config: UpdateConfigPayload): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.CONFIG_SAVE, config)
  },
  onAgentNameUpdated: (callback: (name: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, name: string): void => callback(name)
    ipcRenderer.on(IPC_CHANNELS.CONFIG_AGENT_NAME_UPDATED, handler)
    return (): void => {
      ipcRenderer.removeListener(IPC_CHANNELS.CONFIG_AGENT_NAME_UPDATED, handler)
    }
  },

  // Application updates
  getUpdateState: (): Promise<UpdateState> => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_GET_STATE),
  checkForUpdates: (): Promise<UpdateState> => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_CHECK),
  downloadUpdate: (): Promise<UpdateState> => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_DOWNLOAD),
  installUpdate: (): Promise<{ success: boolean; message: string }> => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_INSTALL),
  onUpdateStatus: (callback: (state: UpdateState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: UpdateState): void => callback(state)
    ipcRenderer.on(IPC_CHANNELS.UPDATE_STATUS, handler)
    return (): void => {
      ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_STATUS, handler)
    }
  },

  // Memory APIs
  getMemory: (): Promise<JasperMemory> => {
    return ipcRenderer.invoke(IPC_CHANNELS.MEMORY_GET)
  },
  clearMemory: (): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.MEMORY_CLEAR)
  },

  // Window & PIP Controls
  windowMinimize: (): void => {
    ipcRenderer.send(IPC_CHANNELS.WINDOW_MINIMIZE)
  },
  windowMaximize: (): void => {
    ipcRenderer.send(IPC_CHANNELS.WINDOW_MAXIMIZE)
  },
  windowClose: (): void => {
    ipcRenderer.send(IPC_CHANNELS.WINDOW_CLOSE)
  },
  togglePip: (): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.WINDOW_TOGGLE_PIP)
  },
  onPipChange: (callback: (isPip: boolean) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, isPip: boolean): void => callback(isPip)
    ipcRenderer.on(IPC_CHANNELS.WINDOW_PIP_CHANGE, handler)
    return (): void => {
      ipcRenderer.removeListener(IPC_CHANNELS.WINDOW_PIP_CHANGE, handler)
    }
  },
  toggleFullscreen: (): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.WINDOW_TOGGLE_FULLSCREEN)
  },
  onFullscreenChange: (callback: (isFullscreen: boolean) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, isFullscreen: boolean): void => callback(isFullscreen)
    ipcRenderer.on(IPC_CHANNELS.WINDOW_FULLSCREEN_CHANGE, handler)
    return (): void => {
      ipcRenderer.removeListener(IPC_CHANNELS.WINDOW_FULLSCREEN_CHANGE, handler)
    }
  },

  // Autonomy & Proactive Services
  confirmReflexionAction: (confirmationId: string): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.AUTONOMY_REFLEXION_CONFIRMATION, confirmationId)
  },
  testSmartHomeConnection: (url?: string, token?: string): Promise<{ success: boolean; message: string }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.AUTONOMY_SMART_HOME_TEST_CONNECTION, url, token)
  },
  testWebhook: (url: string): Promise<WebhookTriggerResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.AUTONOMY_WEBHOOK_TEST, url)
  },
  selectDirectory: (): Promise<string | null> => {
    return ipcRenderer.invoke(IPC_CHANNELS.DIALOG_SELECT_DIRECTORY)
  },
  onAutonomyNotification: (callback: (notif: AutonomyNotification) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, notif: AutonomyNotification): void => callback(notif)
    ipcRenderer.on(IPC_CHANNELS.AUTONOMY_NOTIFICATION, handler)
    return (): void => {
      ipcRenderer.removeListener(IPC_CHANNELS.AUTONOMY_NOTIFICATION, handler)
    }
  },

  // License & Node-Locking APIs
  getLicenseStatus: (): Promise<LicenseInfo> => {
    return ipcRenderer.invoke(IPC_CHANNELS.LICENSE_GET_STATUS)
  },
  activateLicense: (key: string): Promise<LicenseValidationResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.LICENSE_ACTIVATE, key)
  },
  getHwid: (): Promise<{ machineId: string; machineName: string; platform: string }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.LICENSE_GET_HWID)
  },
  onLicenseRevoked: (callback: (payload: { status: string; message: string }) => void): (() => void) => {
    const handler = (_event: any, payload: { status: string; message: string }): void => {
      callback(payload)
    }
    ipcRenderer.on(IPC_CHANNELS.LICENSE_REVOKED, handler)
    return (): void => {
      ipcRenderer.removeListener(IPC_CHANNELS.LICENSE_REVOKED, handler)
    }
  }
})
