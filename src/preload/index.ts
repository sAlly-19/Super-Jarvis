import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  type UpdateConfigPayload,
  type ConfigSummary,
  type JasperMemory,
  type LicenseInfo,
  type LicenseActivationOutcome,
  type LicenseGateSnapshot,
  type UpdateState,
  type AgentStatusPayload,
  type AgentAudioPayload,
  type ToolExecutionPayload,
  type ToolResultPayload
} from '@shared'

const electronAPI = {
  // High-level Agent APIs
  connectAgent: (config?: UpdateConfigPayload): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.AGENT_CONNECT, config)
  },
  disconnectAgent: (): Promise<void> => {
    return ipcRenderer.invoke(IPC_CHANNELS.AGENT_DISCONNECT)
  },
  sendText: (text: string): void => {
    ipcRenderer.send(IPC_CHANNELS.AGENT_SEND_TEXT, text)
  },
  sendAudio: (chunk: ArrayBuffer): void => {
    ipcRenderer.send(IPC_CHANNELS.AGENT_SEND_AUDIO, chunk)
  },
  interruptAgent: (): void => {
    ipcRenderer.send(IPC_CHANNELS.AGENT_INTERRUPT)
  },
  getAgentStatus: (): Promise<{ state: string; healthy: boolean }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.AGENT_GET_STATUS)
  },

  // Agent Event Listeners
  onAgentStatus: (callback: (status: AgentStatusPayload) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: AgentStatusPayload): void => callback(status)
    ipcRenderer.on(IPC_CHANNELS.AGENT_STATUS, handler)
    return (): void => {
      ipcRenderer.removeListener(IPC_CHANNELS.AGENT_STATUS, handler)
    }
  },
  onAgentText: (callback: (text: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, text: string): void => callback(text)
    ipcRenderer.on(IPC_CHANNELS.AGENT_TEXT, handler)
    return (): void => {
      ipcRenderer.removeListener(IPC_CHANNELS.AGENT_TEXT, handler)
    }
  },
  onUserTranscript: (callback: (text: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, text: string): void => callback(text)
    ipcRenderer.on(IPC_CHANNELS.AGENT_USER_TRANSCRIPT, handler)
    return (): void => {
      ipcRenderer.removeListener(IPC_CHANNELS.AGENT_USER_TRANSCRIPT, handler)
    }
  },
  onAgentAudio: (callback: (audio: AgentAudioPayload) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, audio: AgentAudioPayload): void => callback(audio)
    ipcRenderer.on(IPC_CHANNELS.AGENT_AUDIO, handler)
    return (): void => {
      ipcRenderer.removeListener(IPC_CHANNELS.AGENT_AUDIO, handler)
    }
  },
  onToolExecution: (callback: (tool: ToolExecutionPayload) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, tool: ToolExecutionPayload): void => callback(tool)
    ipcRenderer.on(IPC_CHANNELS.AGENT_TOOL_EXECUTION, handler)
    return (): void => {
      ipcRenderer.removeListener(IPC_CHANNELS.AGENT_TOOL_EXECUTION, handler)
    }
  },
  onToolResult: (callback: (result: ToolResultPayload) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, result: ToolResultPayload): void => callback(result)
    ipcRenderer.on(IPC_CHANNELS.AGENT_TOOL_RESULT, handler)
    return (): void => {
      ipcRenderer.removeListener(IPC_CHANNELS.AGENT_TOOL_RESULT, handler)
    }
  },
  onTurnComplete: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on(IPC_CHANNELS.AGENT_TURN_COMPLETE, handler)
    return (): void => {
      ipcRenderer.removeListener(IPC_CHANNELS.AGENT_TURN_COMPLETE, handler)
    }
  },
  onInterrupted: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on(IPC_CHANNELS.AGENT_INTERRUPTED, handler)
    return (): void => {
      ipcRenderer.removeListener(IPC_CHANNELS.AGENT_INTERRUPTED, handler)
    }
  },

  // Configuration
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

  // Memory
  getMemory: (): Promise<JasperMemory> => {
    return ipcRenderer.invoke(IPC_CHANNELS.MEMORY_GET)
  },
  clearMemory: (): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.MEMORY_CLEAR)
  },

  // License & Node-Locking
  getLicenseStatus: (): Promise<LicenseInfo> => {
    return ipcRenderer.invoke(IPC_CHANNELS.LICENSE_GET_STATUS)
  },
  activateLicense: (key: string): Promise<LicenseActivationOutcome> => {
    return ipcRenderer.invoke(IPC_CHANNELS.LICENSE_ACTIVATE, key)
  },
  getHwid: (): Promise<{ machineId: string; machineName: string; platform: string }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.LICENSE_GET_HWID)
  },
  onLicenseState: (callback: (snapshot: LicenseGateSnapshot) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: LicenseGateSnapshot): void => callback(snapshot)
    ipcRenderer.on(IPC_CHANNELS.LICENSE_STATUS_CHANGED, handler)
    return (): void => {
      ipcRenderer.removeListener(IPC_CHANNELS.LICENSE_STATUS_CHANGED, handler)
    }
  },
  // Application Updates
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

  // Window Controls
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

  // Commercial Control Consent
  isConsentAccepted: async (): Promise<boolean> => {
    const res = await ipcRenderer.invoke(IPC_CHANNELS.CONSENT_GET_STATUS)
    return Boolean(res?.accepted)
  },
  acceptControlConsent: async (): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.CONSENT_ACCEPT)
  },

  // Dialog
  selectDirectory: (): Promise<string | null> => {
    return ipcRenderer.invoke(IPC_CHANNELS.DIALOG_SELECT_DIRECTORY)
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
