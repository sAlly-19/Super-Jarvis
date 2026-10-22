export type ConfirmationMode = 'strict' | 'common' | 'all'

export interface JasperConfig {
  apiKey: string
  voiceName: string
  model: string
  enableSystemTools: boolean
  enableMediaTools: boolean
  agentName: string
  enableWakeWord: boolean
  enableBloom: boolean
  enableNeuralBg: boolean
  enableEyeTracking: boolean
  // Autonomy services
  enableScreenAwareness: boolean
  enableWindowTracker: boolean
  enableClipboardWatcher: boolean
  enableCronEngine: boolean
  enableDailyBriefing: boolean
  enableSystemHealth: boolean
  enableSemanticMemory: boolean
  enableKnowledgeGraph: boolean
  enableHeadlessBrowser: boolean
  enableGitWatcher: boolean
  enableFolderOrganizer: boolean
  enableSubagents: boolean
  enableReflexionLoop: boolean
  enableCalendarEmail: boolean
  enableWebhooks: boolean
  enableSmartHome: boolean
  enableProcessManager: boolean
  enableUiAutomation: boolean
  enableMediaController: boolean
  enableReportGenerator: boolean
  enableFileSummarizer: boolean
  enableQrService: boolean
  enableOcrService: boolean
  enablePresentationMode: boolean
  enableFocusMode: boolean
  confirmationMode: ConfirmationMode
  checkUpdatesDaily: boolean
  // Module specific configurations
  hassUrl?: string
  hassToken?: string
  gitRepoPath?: string
  webhookDefaultUrl?: string
  emailUser?: string
  emailImapHost?: string
  emailImapPort?: number
  emailPassword?: string
  folderDefaultTarget?: string
  // License & Node-Locking
  licenseKey?: string
  licenseStatus?: 'active' | 'disabled' | 'revoked' | 'unlicensed'
  licenseMachineId?: string
  licenseActivatedAt?: string
  licenseLastCheckedAt?: string
  licenseInstallationId?: string
  licenseDeviceId?: string
  licenseDeviceSecret?: string
  licenseLeaseToken?: string
  licenseLeaseExpiresAt?: string
  licensePublicJwk?: string
}

export interface UpdateConfigPayload {
  apiKey?: string
  voiceName?: string
  model?: string
  enableSystemTools?: boolean
  enableMediaTools?: boolean
  agentName?: string
  enableWakeWord?: boolean
  enableBloom?: boolean
  enableNeuralBg?: boolean
  enableEyeTracking?: boolean
  // Autonomy services
  enableScreenAwareness?: boolean
  enableWindowTracker?: boolean
  enableClipboardWatcher?: boolean
  enableCronEngine?: boolean
  enableDailyBriefing?: boolean
  enableSystemHealth?: boolean
  enableSemanticMemory?: boolean
  enableKnowledgeGraph?: boolean
  enableHeadlessBrowser?: boolean
  enableGitWatcher?: boolean
  enableFolderOrganizer?: boolean
  enableSubagents?: boolean
  enableReflexionLoop?: boolean
  enableCalendarEmail?: boolean
  enableWebhooks?: boolean
  enableSmartHome?: boolean
  enableProcessManager?: boolean
  enableUiAutomation?: boolean
  enableMediaController?: boolean
  enableReportGenerator?: boolean
  enableFileSummarizer?: boolean
  enableQrService?: boolean
  enableOcrService?: boolean
  enablePresentationMode?: boolean
  enableFocusMode?: boolean
  confirmationMode?: ConfirmationMode
  checkUpdatesDaily?: boolean
  // Module specific configurations
  hassUrl?: string
  hassToken?: string
  gitRepoPath?: string
  webhookDefaultUrl?: string
  emailUser?: string
  emailImapHost?: string
  emailImapPort?: number
  emailPassword?: string
  folderDefaultTarget?: string
  // License & Node-Locking
  licenseKey?: string
  licenseStatus?: 'active' | 'disabled' | 'revoked' | 'unlicensed'
  licenseMachineId?: string
  licenseActivatedAt?: string
  licenseLastCheckedAt?: string
  licenseInstallationId?: string
  licenseDeviceId?: string
  licenseDeviceSecret?: string
  licenseLeaseToken?: string
  licenseLeaseExpiresAt?: string
  licensePublicJwk?: string
}

export interface ConfigSummary {
  apiKey: string
  hasFullKey: boolean
  voiceName: string
  model: string
  enableSystemTools: boolean
  enableMediaTools: boolean
  agentName: string
  enableWakeWord: boolean
  enableBloom: boolean
  enableNeuralBg: boolean
  enableEyeTracking: boolean
  // Autonomy services
  enableScreenAwareness: boolean
  enableWindowTracker: boolean
  enableClipboardWatcher: boolean
  enableCronEngine: boolean
  enableDailyBriefing: boolean
  enableSystemHealth: boolean
  enableSemanticMemory: boolean
  enableKnowledgeGraph: boolean
  enableHeadlessBrowser: boolean
  enableGitWatcher: boolean
  enableFolderOrganizer: boolean
  enableSubagents: boolean
  enableReflexionLoop: boolean
  enableCalendarEmail: boolean
  enableWebhooks: boolean
  enableSmartHome: boolean
  enableProcessManager: boolean
  enableUiAutomation: boolean
  enableMediaController: boolean
  enableReportGenerator: boolean
  enableFileSummarizer: boolean
  enableQrService: boolean
  enableOcrService: boolean
  enablePresentationMode: boolean
  enableFocusMode: boolean
  confirmationMode: ConfirmationMode
  checkUpdatesDaily: boolean
  // Module specific configurations
  hassUrl?: string
  hasHassToken?: boolean
  gitRepoPath?: string
  webhookDefaultUrl?: string
  emailUser?: string
  emailImapHost?: string
  emailImapPort?: number
  hasEmailPassword?: boolean
  folderDefaultTarget?: string
  isConnected: boolean
  // License & Node-Locking
  hasLicense: boolean
  licenseKeyMasked?: string
  licenseStatus: 'active' | 'disabled' | 'revoked' | 'unlicensed'
  licenseMachineId?: string
  hwid: string
}

export interface LicenseValidationResult {
  valid: boolean
  status?: 'ACTIVATED' | 'ACTIVE' | 'DISABLED' | 'REVOKED'
  error?: string
  message: string
  client?: {
    name: string
    email: string
  }
  machineId?: string
  activatedAt?: string
  lastSeenAt?: string
}

export interface LicenseInfo {
  isLicensed: boolean
  status: 'active' | 'disabled' | 'revoked' | 'unlicensed'
  keyMasked?: string
  clientName?: string
  clientEmail?: string
  machineId?: string
  currentHwid: string
  activatedAt?: string
  lastSeenAt?: string
  error?: string
}


