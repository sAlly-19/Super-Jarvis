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
  licenseLastTrustedAt?: string
  // Commercial Operational Consent
  controlConsentAcceptedAt?: string
  controlConsentInstallationId?: string
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
  licenseLastTrustedAt?: string
  // Commercial Operational Consent
  controlConsentAcceptedAt?: string
  controlConsentInstallationId?: string
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
  // Commercial Operational Consent
  controlConsentAccepted?: boolean
  controlConsentAcceptedAt?: string
}
