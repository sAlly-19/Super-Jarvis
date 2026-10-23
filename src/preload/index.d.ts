import type {
  ConfigSummary,
  ConfigSaveResult,
  RemoteAIProvider,
  UpdateConfigPayload,
  JasperMemory,
  LicenseInfo,
  LicenseActivationOutcome,
  LicenseGateSnapshot,
  UpdateState,
  AgentStatusPayload,
  AgentAudioPayload,
  ToolExecutionPayload,
  ToolResultPayload
} from '@shared'

export interface ElectronAPI {
  // High-level Agent APIs
  connectAgent: (config?: UpdateConfigPayload) => Promise<{ success: boolean; error?: string }>
  disconnectAgent: () => Promise<void>
  sendText: (text: string) => void
  sendAudio: (chunk: ArrayBuffer) => void
  interruptAgent: () => void
  getAgentStatus: () => Promise<{ state: string; healthy: boolean }>

  // Agent Event Listeners
  onAgentStatus: (callback: (status: AgentStatusPayload) => void) => () => void
  onAgentText: (callback: (text: string) => void) => () => void
  onUserTranscript: (callback: (text: string) => void) => () => void
  onAgentAudio: (callback: (audio: AgentAudioPayload) => void) => () => void
  onToolExecution: (callback: (tool: ToolExecutionPayload) => void) => () => void
  onToolResult: (callback: (result: ToolResultPayload) => void) => () => void
  onTurnComplete: (callback: () => void) => () => void
  onInterrupted: (callback: () => void) => () => void

  // Configuration
  getConfig: () => Promise<ConfigSummary>
  saveConfig: (config: UpdateConfigPayload) => Promise<ConfigSaveResult>
  removeProviderCredential: (provider: RemoteAIProvider) => Promise<ConfigSaveResult>
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

  // License & Node-Locking
  getLicenseStatus: () => Promise<LicenseInfo>
  activateLicense: (key: string) => Promise<LicenseActivationOutcome>
  getHwid: () => Promise<{ machineId: string; machineName: string; platform: string }>
  onLicenseState: (callback: (snapshot: LicenseGateSnapshot) => void) => () => void

  // Commercial Control Consent
  isConsentAccepted: () => Promise<boolean>
  acceptControlConsent: () => Promise<{ success: boolean }>

  // Dialog
  selectDirectory: () => Promise<string | null>

}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
