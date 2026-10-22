import { app, safeStorage } from 'electron'
import { join } from 'path'
import fs from 'fs'
import dotenv from 'dotenv'
import type { JasperConfig, UpdateConfigPayload, ConfigSummary } from '@shared'
import { getHardwareInfo } from '../services/hwid'

export const DEFAULT_LIVE_MODEL = 'gemini/gemini-2.5-flash'
export const RETIRED_LIVE_MODELS = new Set([
  'gemini-2.0-flash-exp',
  'gemini-2.0-flash-live-001',
  'gemini-live-2.5-flash-preview',
  'gemini-3.8-live'
])

export function normalizeLiveModel(model?: string): string {
  const value = model?.trim()
  return !value || RETIRED_LIVE_MODELS.has(value) ? DEFAULT_LIVE_MODEL : value
}

// Load environment variables from .env only in development/unpackaged mode
if (typeof app === 'undefined' || !app.isPackaged) {
  dotenv.config()
}

function encryptSecret(val: string): string {
  if (!val) return ''
  if (val.startsWith('enc:')) return val // already encrypted
  try {
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      return `enc:${safeStorage.encryptString(val).toString('base64')}`
    }
  } catch (err) {
    console.error('[ConfigStore] [FAIL-CLOSED] safeStorage encryption failed:', err)
    return ''
  }
  console.warn('[ConfigStore] [FAIL-CLOSED] safeStorage is unavailable. Secret cannot be saved in plaintext.')
  return ''
}

function decryptSecret(val: string): string {
  if (!val) return ''
  if (val.startsWith('enc:')) {
    try {
      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        const buf = Buffer.from(val.slice(4), 'base64')
        return safeStorage.decryptString(buf)
      } else {
        console.warn('[ConfigStore] [FAIL-CLOSED] safeStorage is not available yet to decrypt secret.')
        return ''
      }
    } catch (err) {
      console.warn('[ConfigStore] [FAIL-CLOSED] safeStorage decryption failed:', err)
      return ''
    }
  }
  // If not prefixed with enc:, it is a legacy plaintext secret
  return val
}

function atomicWriteFileSync(filePath: string, data: string): void {
  const tmpPath = `${filePath}.tmp.${Date.now()}`
  fs.writeFileSync(tmpPath, data, 'utf-8')
  try {
    fs.renameSync(tmpPath, filePath)
  } catch (err) {
    // Windows fallback if destination is locked
    try {
      fs.copyFileSync(tmpPath, filePath)
      fs.unlinkSync(tmpPath)
    } catch (fallbackError) {
      try { fs.unlinkSync(tmpPath) } catch {}
      throw fallbackError
    }
  }
}

class ConfigStore {
  private config: JasperConfig = {
    apiKey: process.env.GOOGLE_API_KEY || '',
    voiceName: process.env.GEMINI_VOICE || 'Charon',
    model: normalizeLiveModel(process.env.GEMINI_MODEL),
    enableSystemTools: true,
    enableMediaTools: true,
    agentName: process.env.AGENT_NAME || 'Jasper',
    enableWakeWord: true,
    enableBloom: true,
    enableNeuralBg: true,
    enableEyeTracking: true,
    // Autonomy services
    enableScreenAwareness: true,
    enableWindowTracker: true,
    enableClipboardWatcher: true,
    enableCronEngine: true,
    enableDailyBriefing: true,
    enableSystemHealth: true,
    enableSemanticMemory: true,
    enableKnowledgeGraph: true,
    enableHeadlessBrowser: true,
    enableGitWatcher: true,
    enableFolderOrganizer: true,
    enableSubagents: true,
    enableReflexionLoop: true,
    enableCalendarEmail: true,
    enableWebhooks: true,
    enableSmartHome: true,
    enableProcessManager: true,
    enableUiAutomation: true,
    enableMediaController: true,
    enableReportGenerator: true,
    enableFileSummarizer: true,
    enableQrService: true,
    enableOcrService: true,
    enablePresentationMode: true,
    enableFocusMode: true,
    confirmationMode: 'strict',
    checkUpdatesDaily: true,
    // Module specific configurations
    hassUrl: process.env.HASS_URL || 'http://homeassistant.local:8123',
    hassToken: process.env.HASS_TOKEN || '',
    gitRepoPath: process.cwd(),
    webhookDefaultUrl: '',
    emailUser: '',
    emailImapHost: 'imap.gmail.com',
    emailImapPort: 993,
    emailPassword: '',
    folderDefaultTarget: 'downloads'
  }

  private isInitialized: boolean = false

  constructor() {
    this.loadEnvDefaults()
  }

  private loadEnvDefaults(): void {
    this.config.apiKey = process.env.GOOGLE_API_KEY || ''
    this.config.voiceName = process.env.GEMINI_VOICE || 'Charon'
    this.config.model = normalizeLiveModel(process.env.GEMINI_MODEL)
    this.config.agentName = process.env.AGENT_NAME || 'Jasper'
    this.config.hassUrl = process.env.HASS_URL || 'http://homeassistant.local:8123'
    this.config.hassToken = process.env.HASS_TOKEN || ''
  }

  public initialize(): JasperConfig {
    if (this.isInitialized) return this.config
    console.log('[ConfigStore] Initializing ConfigStore and decrypting credentials after app.ready...')
    this.loadPersistedConfig()
    this.isInitialized = true
    return this.config
  }

  private getConfigFilePath(): string {
    return join(app.getPath('userData'), 'jasper-config.json')
  }

  public loadPersistedConfig(): JasperConfig {
    // 1. .env defaults
    this.loadEnvDefaults()

    // 2. Overlay persisted settings from userData
    try {
      const cfgPath = this.getConfigFilePath()
      if (fs.existsSync(cfgPath)) {
        const data = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'))
        if (data.apiKey !== undefined) this.config.apiKey = decryptSecret(data.apiKey)
        if (data.voiceName) this.config.voiceName = data.voiceName
        if (data.model) this.config.model = normalizeLiveModel(data.model)
        if (data.enableSystemTools !== undefined) this.config.enableSystemTools = data.enableSystemTools
        if (data.enableMediaTools !== undefined) this.config.enableMediaTools = data.enableMediaTools
        if (data.agentName) this.config.agentName = data.agentName
        if (data.enableWakeWord !== undefined) this.config.enableWakeWord = data.enableWakeWord
        if (data.enableBloom !== undefined) this.config.enableBloom = data.enableBloom
        if (data.enableNeuralBg !== undefined) this.config.enableNeuralBg = data.enableNeuralBg
        if (data.enableEyeTracking !== undefined) this.config.enableEyeTracking = data.enableEyeTracking
        if (data.enableScreenAwareness !== undefined) this.config.enableScreenAwareness = data.enableScreenAwareness
        if (data.enableWindowTracker !== undefined) this.config.enableWindowTracker = data.enableWindowTracker
        if (data.enableClipboardWatcher !== undefined) this.config.enableClipboardWatcher = data.enableClipboardWatcher
        if (data.enableCronEngine !== undefined) this.config.enableCronEngine = data.enableCronEngine
        if (data.enableDailyBriefing !== undefined) this.config.enableDailyBriefing = data.enableDailyBriefing
        if (data.enableSystemHealth !== undefined) this.config.enableSystemHealth = data.enableSystemHealth
        if (data.enableSemanticMemory !== undefined) this.config.enableSemanticMemory = data.enableSemanticMemory
        if (data.enableKnowledgeGraph !== undefined) this.config.enableKnowledgeGraph = data.enableKnowledgeGraph
        if (data.enableHeadlessBrowser !== undefined) this.config.enableHeadlessBrowser = data.enableHeadlessBrowser
        if (data.enableGitWatcher !== undefined) this.config.enableGitWatcher = data.enableGitWatcher
        if (data.enableFolderOrganizer !== undefined) this.config.enableFolderOrganizer = data.enableFolderOrganizer
        if (data.enableSubagents !== undefined) this.config.enableSubagents = data.enableSubagents
        if (data.enableReflexionLoop !== undefined) this.config.enableReflexionLoop = data.enableReflexionLoop
        if (data.enableCalendarEmail !== undefined) this.config.enableCalendarEmail = data.enableCalendarEmail
        if (data.enableWebhooks !== undefined) this.config.enableWebhooks = data.enableWebhooks
        if (data.enableSmartHome !== undefined) this.config.enableSmartHome = data.enableSmartHome
        if (data.enableProcessManager !== undefined) this.config.enableProcessManager = data.enableProcessManager
        if (data.enableUiAutomation !== undefined) this.config.enableUiAutomation = data.enableUiAutomation
        if (data.enableMediaController !== undefined) this.config.enableMediaController = data.enableMediaController
        if (data.enableReportGenerator !== undefined) this.config.enableReportGenerator = data.enableReportGenerator
        if (data.enableFileSummarizer !== undefined) this.config.enableFileSummarizer = data.enableFileSummarizer
        if (data.enableQrService !== undefined) this.config.enableQrService = data.enableQrService
        if (data.enableOcrService !== undefined) this.config.enableOcrService = data.enableOcrService
        if (data.enablePresentationMode !== undefined) this.config.enablePresentationMode = data.enablePresentationMode
        if (data.enableFocusMode !== undefined) this.config.enableFocusMode = data.enableFocusMode
        if (['strict', 'common', 'all'].includes(data.confirmationMode)) this.config.confirmationMode = data.confirmationMode
        if (typeof data.checkUpdatesDaily === 'boolean') this.config.checkUpdatesDaily = data.checkUpdatesDaily

        // Module-specific configs
        if (data.hassUrl !== undefined) this.config.hassUrl = data.hassUrl
        if (data.hassToken !== undefined) this.config.hassToken = decryptSecret(data.hassToken)
        if (data.gitRepoPath !== undefined) this.config.gitRepoPath = data.gitRepoPath
        if (data.webhookDefaultUrl !== undefined) this.config.webhookDefaultUrl = data.webhookDefaultUrl
        if (data.emailUser !== undefined) this.config.emailUser = data.emailUser
        if (data.emailImapHost !== undefined) this.config.emailImapHost = data.emailImapHost
        if (data.emailImapPort !== undefined) this.config.emailImapPort = data.emailImapPort
        if (data.emailPassword !== undefined) this.config.emailPassword = decryptSecret(data.emailPassword)
        if (data.folderDefaultTarget !== undefined) this.config.folderDefaultTarget = data.folderDefaultTarget

        // License fields
        if (data.licenseKey !== undefined) this.config.licenseKey = decryptSecret(data.licenseKey)
        if (data.licenseStatus !== undefined) this.config.licenseStatus = data.licenseStatus
        if (data.licenseMachineId !== undefined) this.config.licenseMachineId = data.licenseMachineId
        if (data.licenseActivatedAt !== undefined) this.config.licenseActivatedAt = data.licenseActivatedAt
        if (data.licenseLastCheckedAt !== undefined) this.config.licenseLastCheckedAt = data.licenseLastCheckedAt
        if (data.licenseInstallationId !== undefined) this.config.licenseInstallationId = data.licenseInstallationId
        if (data.licenseDeviceId !== undefined) this.config.licenseDeviceId = data.licenseDeviceId
        if (data.licenseDeviceSecret !== undefined) this.config.licenseDeviceSecret = decryptSecret(data.licenseDeviceSecret)
        if (data.licenseLeaseToken !== undefined) this.config.licenseLeaseToken = decryptSecret(data.licenseLeaseToken)
        if (data.licenseLeaseExpiresAt !== undefined) this.config.licenseLeaseExpiresAt = data.licenseLeaseExpiresAt
        if (data.licenseLastTrustedAt !== undefined) this.config.licenseLastTrustedAt = data.licenseLastTrustedAt

        console.log('[ConfigStore] Loaded settings from userData/jasper-config.json')
      }
    } catch (err) {
      console.warn('[ConfigStore] Error reading config from userData:', err)
    }

    return this.config
  }

  public savePersistedConfig(): void {
    try {
      const cfgPath = this.getConfigFilePath()
      const dataToPersist = {
        ...this.config,
        apiKey: encryptSecret(this.config.apiKey),
        hassToken: encryptSecret(this.config.hassToken || ''),
        emailPassword: encryptSecret(this.config.emailPassword || ''),
        licenseKey: encryptSecret(this.config.licenseKey || ''),
        licenseDeviceSecret: encryptSecret(this.config.licenseDeviceSecret || ''),
        licenseLeaseToken: encryptSecret(this.config.licenseLeaseToken || '')
      }
      const content = JSON.stringify(dataToPersist, null, 2)
      atomicWriteFileSync(cfgPath, content)
      console.log('[ConfigStore] Saved configuration successfully.')
    } catch (err) {
      console.error('[ConfigStore] Error saving config to userData:', err)
      throw new Error('Não foi possível persistir a configuração local.')
    }
  }

  public getConfig(): JasperConfig {
    return { ...this.config }
  }

  public updateConfig(payload: UpdateConfigPayload): JasperConfig {
    const previous = { ...this.config }
    if (payload.apiKey !== undefined) this.config.apiKey = payload.apiKey.trim()
    if (payload.voiceName !== undefined) this.config.voiceName = payload.voiceName.trim()
    if (payload.model !== undefined) this.config.model = normalizeLiveModel(payload.model)
    if (payload.enableSystemTools !== undefined) this.config.enableSystemTools = payload.enableSystemTools
    if (payload.enableMediaTools !== undefined) this.config.enableMediaTools = payload.enableMediaTools
    if (payload.agentName !== undefined) this.config.agentName = payload.agentName.trim()
    if (payload.enableWakeWord !== undefined) this.config.enableWakeWord = payload.enableWakeWord
    if (payload.enableBloom !== undefined) this.config.enableBloom = payload.enableBloom
    if (payload.enableNeuralBg !== undefined) this.config.enableNeuralBg = payload.enableNeuralBg
    if (payload.enableEyeTracking !== undefined) this.config.enableEyeTracking = payload.enableEyeTracking
    if (payload.enableScreenAwareness !== undefined) this.config.enableScreenAwareness = payload.enableScreenAwareness
    if (payload.enableWindowTracker !== undefined) this.config.enableWindowTracker = payload.enableWindowTracker
    if (payload.enableClipboardWatcher !== undefined) this.config.enableClipboardWatcher = payload.enableClipboardWatcher
    if (payload.enableCronEngine !== undefined) this.config.enableCronEngine = payload.enableCronEngine
    if (payload.enableDailyBriefing !== undefined) this.config.enableDailyBriefing = payload.enableDailyBriefing
    if (payload.enableSystemHealth !== undefined) this.config.enableSystemHealth = payload.enableSystemHealth
    if (payload.enableSemanticMemory !== undefined) this.config.enableSemanticMemory = payload.enableSemanticMemory
    if (payload.enableKnowledgeGraph !== undefined) this.config.enableKnowledgeGraph = payload.enableKnowledgeGraph
    if (payload.enableHeadlessBrowser !== undefined) this.config.enableHeadlessBrowser = payload.enableHeadlessBrowser
    if (payload.enableGitWatcher !== undefined) this.config.enableGitWatcher = payload.enableGitWatcher
    if (payload.enableFolderOrganizer !== undefined) this.config.enableFolderOrganizer = payload.enableFolderOrganizer
    if (payload.enableSubagents !== undefined) this.config.enableSubagents = payload.enableSubagents
    if (payload.enableReflexionLoop !== undefined) this.config.enableReflexionLoop = payload.enableReflexionLoop
    if (payload.enableCalendarEmail !== undefined) this.config.enableCalendarEmail = payload.enableCalendarEmail
    if (payload.enableWebhooks !== undefined) this.config.enableWebhooks = payload.enableWebhooks
    if (payload.enableSmartHome !== undefined) this.config.enableSmartHome = payload.enableSmartHome
    if (payload.enableProcessManager !== undefined) this.config.enableProcessManager = payload.enableProcessManager
    if (payload.enableUiAutomation !== undefined) this.config.enableUiAutomation = payload.enableUiAutomation
    if (payload.enableMediaController !== undefined) this.config.enableMediaController = payload.enableMediaController
    if (payload.enableReportGenerator !== undefined) this.config.enableReportGenerator = payload.enableReportGenerator
    if (payload.enableFileSummarizer !== undefined) this.config.enableFileSummarizer = payload.enableFileSummarizer
    if (payload.enableQrService !== undefined) this.config.enableQrService = payload.enableQrService
    if (payload.enableOcrService !== undefined) this.config.enableOcrService = payload.enableOcrService
    if (payload.enablePresentationMode !== undefined) this.config.enablePresentationMode = payload.enablePresentationMode
    if (payload.enableFocusMode !== undefined) this.config.enableFocusMode = payload.enableFocusMode
    if (payload.confirmationMode !== undefined) this.config.confirmationMode = payload.confirmationMode
    if (payload.checkUpdatesDaily !== undefined) this.config.checkUpdatesDaily = payload.checkUpdatesDaily

    // Module-specific configs
    if (payload.hassUrl !== undefined) this.config.hassUrl = payload.hassUrl.trim()
    if (payload.hassToken !== undefined) this.config.hassToken = payload.hassToken.trim()
    if (payload.gitRepoPath !== undefined) this.config.gitRepoPath = payload.gitRepoPath.trim()
    if (payload.webhookDefaultUrl !== undefined) this.config.webhookDefaultUrl = payload.webhookDefaultUrl.trim()
    if (payload.emailUser !== undefined) this.config.emailUser = payload.emailUser.trim()
    if (payload.emailImapHost !== undefined) this.config.emailImapHost = payload.emailImapHost.trim()
    if (payload.emailImapPort !== undefined) this.config.emailImapPort = payload.emailImapPort
    if (payload.emailPassword !== undefined) this.config.emailPassword = payload.emailPassword.trim()
    if (payload.folderDefaultTarget !== undefined) this.config.folderDefaultTarget = payload.folderDefaultTarget.trim()

    // License fields
    if (payload.licenseKey !== undefined) this.config.licenseKey = payload.licenseKey.trim()
    if (payload.licenseStatus !== undefined) this.config.licenseStatus = payload.licenseStatus
    if (payload.licenseMachineId !== undefined) this.config.licenseMachineId = payload.licenseMachineId.trim()
    if (payload.licenseActivatedAt !== undefined) this.config.licenseActivatedAt = payload.licenseActivatedAt
    if (payload.licenseLastCheckedAt !== undefined) this.config.licenseLastCheckedAt = payload.licenseLastCheckedAt
    if (payload.licenseInstallationId !== undefined) this.config.licenseInstallationId = payload.licenseInstallationId.trim()
    if (payload.licenseDeviceId !== undefined) this.config.licenseDeviceId = payload.licenseDeviceId.trim()
    if (payload.licenseDeviceSecret !== undefined) this.config.licenseDeviceSecret = payload.licenseDeviceSecret.trim()
    if (payload.licenseLeaseToken !== undefined) this.config.licenseLeaseToken = payload.licenseLeaseToken.trim()
    if (payload.licenseLeaseExpiresAt !== undefined) this.config.licenseLeaseExpiresAt = payload.licenseLeaseExpiresAt
    if (payload.licenseLastTrustedAt !== undefined) this.config.licenseLastTrustedAt = payload.licenseLastTrustedAt

    try {
      this.savePersistedConfig()
    } catch (error) {
      this.config = previous
      throw error
    }
    return this.getConfig()
  }

  public getConfigSummary(isConnected: boolean): ConfigSummary {
    const hw = getHardwareInfo()
    return {
      apiKey: this.config.apiKey
        ? `${this.config.apiKey.slice(0, 6)}...${this.config.apiKey.slice(-4)}`
        : '',
      hasFullKey: Boolean(this.config.apiKey && this.config.apiKey.length > 10),
      voiceName: this.config.voiceName,
      model: this.config.model,
      enableSystemTools: this.config.enableSystemTools,
      enableMediaTools: this.config.enableMediaTools,
      agentName: this.config.agentName,
      enableWakeWord: this.config.enableWakeWord,
      enableBloom: this.config.enableBloom,
      enableNeuralBg: this.config.enableNeuralBg,
      enableEyeTracking: this.config.enableEyeTracking,
      enableScreenAwareness: this.config.enableScreenAwareness,
      enableWindowTracker: this.config.enableWindowTracker,
      enableClipboardWatcher: this.config.enableClipboardWatcher,
      enableCronEngine: this.config.enableCronEngine,
      enableDailyBriefing: this.config.enableDailyBriefing,
      enableSystemHealth: this.config.enableSystemHealth,
      enableSemanticMemory: this.config.enableSemanticMemory,
      enableKnowledgeGraph: this.config.enableKnowledgeGraph,
      enableHeadlessBrowser: this.config.enableHeadlessBrowser,
      enableGitWatcher: this.config.enableGitWatcher,
      enableFolderOrganizer: this.config.enableFolderOrganizer,
      enableSubagents: this.config.enableSubagents,
      enableReflexionLoop: this.config.enableReflexionLoop,
      enableCalendarEmail: this.config.enableCalendarEmail,
      enableWebhooks: this.config.enableWebhooks,
      enableSmartHome: this.config.enableSmartHome,
      enableProcessManager: this.config.enableProcessManager,
      enableUiAutomation: this.config.enableUiAutomation,
      enableMediaController: this.config.enableMediaController,
      enableReportGenerator: this.config.enableReportGenerator,
      enableFileSummarizer: this.config.enableFileSummarizer,
      enableQrService: this.config.enableQrService,
      enableOcrService: this.config.enableOcrService,
      enablePresentationMode: this.config.enablePresentationMode,
      enableFocusMode: this.config.enableFocusMode,
      confirmationMode: this.config.confirmationMode,
      checkUpdatesDaily: this.config.checkUpdatesDaily,
      // Module-specific configs
      hassUrl: this.config.hassUrl || 'http://homeassistant.local:8123',
      hasHassToken: Boolean(this.config.hassToken && this.config.hassToken.length > 5),
      gitRepoPath: this.config.gitRepoPath || process.cwd(),
      webhookDefaultUrl: this.config.webhookDefaultUrl || 'http://localhost:5678/webhook/jasper',
      emailUser: this.config.emailUser || '',
      emailImapHost: this.config.emailImapHost || 'imap.gmail.com',
      emailImapPort: this.config.emailImapPort || 993,
      hasEmailPassword: Boolean(this.config.emailPassword && this.config.emailPassword.length > 0),
      folderDefaultTarget: this.config.folderDefaultTarget || 'downloads',
      isConnected,
      // License & Node-Locking
      hasLicense: Boolean(this.config.licenseKey && this.config.licenseStatus === 'active'),
      licenseKeyMasked: this.config.licenseKey
        ? `${this.config.licenseKey.slice(0, 10)}...${this.config.licenseKey.slice(-4)}`
        : undefined,
      licenseStatus: this.config.licenseStatus || 'unlicensed',
      licenseMachineId: this.config.licenseMachineId,
      hwid: hw.machineId
    }
  }
}

export const configStore = new ConfigStore()
