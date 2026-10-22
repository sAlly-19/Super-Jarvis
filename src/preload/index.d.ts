import {
  ConfigSummary,
  UpdateConfigPayload,
  JasperMemory,
  AutonomyNotification,
  type WebhookTriggerResult,
  type LicenseInfo,
  type LicenseValidationResult,
  type UpdateState
} from '@shared'

export interface ElectronAPI {
  // Audio & Text streaming
  sendAudioChunk: (chunk: ArrayBuffer) => void
  sendTextMessage: (text: string) => void
  onAudioChunk: (callback: (base64Audio: string) => void) => () => void
  onInterrupted: (callback: () => void) => () => void
  onTurnComplete: (callback: () => void) => () => void
  onTextChunk: (callback: (text: string) => void) => () => void
  onStatusChange: (callback: (status: string, message?: string) => void) => () => void

  // Gemini connection & configuration
  connectGemini: (config?: UpdateConfigPayload) => Promise<{ success: boolean; error?: string }>
  disconnectGemini: () => Promise<void>
  getConfig: () => Promise<ConfigSummary>
  saveConfig: (config: UpdateConfigPayload) => Promise<{ success: boolean }>
  onAgentNameUpdated: (callback: (name: string) => void) => () => void

  // Application updates
  getUpdateState: () => Promise<UpdateState>
  checkForUpdates: () => Promise<UpdateState>
  downloadUpdate: () => Promise<UpdateState>
  installUpdate: () => Promise<{ success: boolean; message: string }>
  onUpdateStatus: (callback: (state: UpdateState) => void) => () => void

  // Memory APIs
  getMemory: () => Promise<JasperMemory>
  clearMemory: () => Promise<boolean>

  // Frameless window controls & PIP
  windowMinimize: () => void
  windowMaximize: () => void
  windowClose: () => void
  togglePip: () => Promise<boolean>
  onPipChange: (callback: (isPip: boolean) => void) => () => void
  toggleFullscreen: () => Promise<boolean>
  onFullscreenChange: (callback: (isFullscreen: boolean) => void) => () => void

  // Autonomy & Proactive Services
  confirmReflexionAction: (confirmationId: string) => Promise<boolean>
  testSmartHomeConnection: (url?: string, token?: string) => Promise<{ success: boolean; message: string }>
  testWebhook: (url: string) => Promise<WebhookTriggerResult>
  selectDirectory: () => Promise<string | null>
  onAutonomyNotification: (callback: (notif: AutonomyNotification) => void) => () => void

  // License & Node-Locking
  getLicenseStatus: () => Promise<LicenseInfo>
  activateLicense: (key: string) => Promise<LicenseValidationResult>
  getHwid: () => Promise<{ machineId: string; machineName: string; platform: string }>
  onLicenseRevoked: (callback: (payload: { status: string; message: string }) => void) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
