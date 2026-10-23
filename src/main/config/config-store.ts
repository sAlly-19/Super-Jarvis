import { app, safeStorage } from 'electron'
import fs from 'fs'
import { dirname, join } from 'path'
import dotenv from 'dotenv'
import {
  INTERNAL_CONFIG_KEYS,
  PUBLIC_CONFIG_KEYS,
  type ConfigSummary,
  type InternalConfigKey,
  type InternalConfigUpdatePayload,
  type JasperConfig,
  type PublicConfigKey,
  type UpdateConfigPayload
} from '@shared'

export const DEFAULT_LIVE_MODEL = 'gemini/gemini-2.5-flash'
export const RETIRED_LIVE_MODELS = new Set([
  'gemini-2.0-flash-exp',
  'gemini-2.0-flash-live-001',
  'gemini-live-2.5-flash-preview',
  'gemini-3.8-live'
])

const PUBLIC_KEY_SET = new Set<string>(PUBLIC_CONFIG_KEYS)
const INTERNAL_KEY_SET = new Set<string>(INTERNAL_CONFIG_KEYS)
const PUBLIC_BOOLEAN_KEYS = new Set<PublicConfigKey>([
  'checkUpdatesDaily',
  'enableWakeWord',
  'enableBloom',
  'enableNeuralBg',
  'enableEyeTracking',
  'enableScreenAwareness'
])
const SECRET_KEYS = new Set<InternalConfigKey | PublicConfigKey>([
  'apiKey',
  'licenseKey',
  'licenseDeviceSecret',
  'licenseLeaseToken'
])

export function normalizeLiveModel(model?: string): string {
  const value = model?.trim()
  return !value || RETIRED_LIVE_MODELS.has(value) ? DEFAULT_LIVE_MODEL : value
}

if (typeof app === 'undefined' || !app.isPackaged) dotenv.config()

function encryptSecret(value: string): string {
  if (!value || value.startsWith('enc:')) return value
  try {
    if (safeStorage?.isEncryptionAvailable()) {
      return `enc:${safeStorage.encryptString(value).toString('base64')}`
    }
  } catch (error) {
    console.error('[ConfigStore] [FAIL-CLOSED] safeStorage encryption failed:', error)
    throw new Error('Não foi possível criptografar a configuração local.')
  }
  throw new Error('Não foi possível criptografar a configuração local: safeStorage indisponível.')
}

function decryptSecret(value: string): string {
  if (!value || !value.startsWith('enc:')) return value
  try {
    if (safeStorage?.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'))
    }
  } catch (error) {
    console.warn('[ConfigStore] [FAIL-CLOSED] safeStorage decryption failed:', error)
    throw new Error('Não foi possível descriptografar a configuração local.')
  }
  throw new Error('Não foi possível descriptografar a configuração local: safeStorage indisponível.')
}

function atomicWriteFileSync(filePath: string, data: string): void {
  fs.mkdirSync(dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`
  fs.writeFileSync(tmpPath, data, 'utf8')
  try {
    fs.renameSync(tmpPath, filePath)
  } catch {
    try {
      fs.copyFileSync(tmpPath, filePath)
      fs.unlinkSync(tmpPath)
    } catch (error) {
      try { fs.unlinkSync(tmpPath) } catch {}
      throw error
    }
  }
}

function createDefaults(): JasperConfig {
  return {
    apiKey: process.env.GOOGLE_API_KEY || '',
    voiceName: process.env.GEMINI_VOICE || 'Charon',
    model: normalizeLiveModel(process.env.GEMINI_MODEL),
    agentName: process.env.AGENT_NAME || 'Jasper',
    checkUpdatesDaily: true,
    enableWakeWord: true,
    enableBloom: true,
    enableNeuralBg: true,
    enableEyeTracking: true,
    enableScreenAwareness: true
  }
}

function assertPublicPayload(payload: unknown): asserts payload is UpdateConfigPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Configuração pública inválida.')
  }
  for (const [key, value] of Object.entries(payload)) {
    if (!PUBLIC_KEY_SET.has(key)) throw new Error(`Chave de configuração não suportada: ${key}.`)
    if (value === undefined) continue
    if (PUBLIC_BOOLEAN_KEYS.has(key as PublicConfigKey)) {
      if (typeof value !== 'boolean') throw new Error(`Valor de configuração inválido: ${key}.`)
    } else if (typeof value !== 'string' || value.includes('\0')) {
      throw new Error(`Valor de configuração inválido: ${key}.`)
    }
  }
}

function assertInternalPayload(payload: unknown): asserts payload is InternalConfigUpdatePayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Configuração interna inválida.')
  }
  for (const [key, value] of Object.entries(payload)) {
    if (!INTERNAL_KEY_SET.has(key)) throw new Error(`Chave interna de configuração não suportada: ${key}.`)
    if (value === undefined) continue
    if (key === 'licenseStatus') {
      if (!['active', 'disabled', 'revoked', 'unlicensed'].includes(String(value))) {
        throw new Error('Estado interno de licença inválido.')
      }
    } else if (typeof value !== 'string' || value.includes('\0')) {
      throw new Error(`Valor interno de configuração inválido: ${key}.`)
    }
  }
}

export class ConfigStore {
  private config: JasperConfig = createDefaults()
  private isInitialized = false
  private hasUndecryptablePersistedSecrets = false

  constructor(private readonly explicitConfigPath?: string) {}

  private getConfigFilePath(): string {
    return this.explicitConfigPath || join(app.getPath('userData'), 'jasper-config.json')
  }

  public initialize(): JasperConfig {
    if (!this.isInitialized) {
      this.loadPersistedConfig()
      this.isInitialized = true
    }
    return this.getConfig()
  }

  public loadPersistedConfig(): JasperConfig {
    this.config = createDefaults()
    this.hasUndecryptablePersistedSecrets = false
    try {
      const configPath = this.getConfigFilePath()
      if (!fs.existsSync(configPath)) return this.getConfig()
      const persisted = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>
      const needsMigration = Object.keys(persisted).some(
        (key) => !PUBLIC_KEY_SET.has(key) && !INTERNAL_KEY_SET.has(key)
      )

      for (const key of PUBLIC_CONFIG_KEYS) {
        const value = persisted[key]
        if (value === undefined) continue
        if (PUBLIC_BOOLEAN_KEYS.has(key) && typeof value === 'boolean') {
          ;(this.config as unknown as Record<string, unknown>)[key] = value
        } else if (!PUBLIC_BOOLEAN_KEYS.has(key) && typeof value === 'string') {
          let decoded = value
          if (SECRET_KEYS.has(key)) {
            try {
              decoded = decryptSecret(value)
            } catch (error) {
              this.hasUndecryptablePersistedSecrets = true
              console.warn(`[ConfigStore] Preserving encrypted value for ${key} without rewriting it:`, error)
              continue
            }
          }
          ;(this.config as unknown as Record<string, unknown>)[key] = key === 'model'
            ? normalizeLiveModel(decoded)
            : decoded
        }
      }

      for (const key of INTERNAL_CONFIG_KEYS) {
        const value = persisted[key]
        if (typeof value !== 'string') continue
        if (SECRET_KEYS.has(key)) {
          try {
            ;(this.config as unknown as Record<string, unknown>)[key] = decryptSecret(value)
          } catch (error) {
            this.hasUndecryptablePersistedSecrets = true
            console.warn(`[ConfigStore] Preserving encrypted value for ${key} without rewriting it:`, error)
          }
        } else {
          ;(this.config as unknown as Record<string, unknown>)[key] = value
        }
      }
      console.log('[ConfigStore] Loaded supported settings from jasper-config.json')
      if (needsMigration && !this.hasUndecryptablePersistedSecrets) {
        this.savePersistedConfig()
        console.log('[ConfigStore] Removed obsolete persisted configuration keys.')
      } else if (needsMigration) {
        console.warn('[ConfigStore] Migration deferred because encrypted values could not be decrypted safely.')
      }
    } catch (error) {
      console.warn('[ConfigStore] Error reading configuration:', error)
    }
    return this.getConfig()
  }

  public savePersistedConfig(): void {
    try {
      if (this.hasUndecryptablePersistedSecrets) {
        throw new Error('Existem segredos persistidos que não puderam ser descriptografados com segurança.')
      }
      const persisted: Record<string, unknown> = {}
      for (const key of [...PUBLIC_CONFIG_KEYS, ...INTERNAL_CONFIG_KEYS]) {
        const value = this.config[key]
        if (value === undefined) continue
        persisted[key] = SECRET_KEYS.has(key) ? encryptSecret(String(value)) : value
      }
      atomicWriteFileSync(this.getConfigFilePath(), JSON.stringify(persisted, null, 2))
      console.log('[ConfigStore] Saved supported configuration successfully.')
    } catch (error) {
      console.error('[ConfigStore] Error saving configuration:', error)
      throw new Error('Não foi possível persistir a configuração local.')
    }
  }

  public getConfig(): JasperConfig {
    return { ...this.config }
  }

  public canPersistSecrets(): boolean {
    try {
      if (this.hasUndecryptablePersistedSecrets) return false
      if (!safeStorage?.isEncryptionAvailable()) return false
      const probe = `jasper-safe-storage-probe:${process.pid}:${Date.now()}`
      const encrypted = safeStorage.encryptString(probe)
      return safeStorage.decryptString(encrypted) === probe
    } catch {
      return false
    }
  }

  public updateConfig(payload: UpdateConfigPayload): JasperConfig {
    assertPublicPayload(payload)
    return this.applyUpdate(payload)
  }

  public updateInternalConfig(payload: InternalConfigUpdatePayload): JasperConfig {
    assertInternalPayload(payload)
    return this.applyUpdate(payload)
  }

  private applyUpdate(payload: UpdateConfigPayload | InternalConfigUpdatePayload): JasperConfig {
    const previous = { ...this.config }
    for (const [key, rawValue] of Object.entries(payload)) {
      if (rawValue === undefined) continue
      const value = typeof rawValue === 'string' ? rawValue.trim() : rawValue
      ;(this.config as unknown as Record<string, unknown>)[key] = key === 'model'
        ? normalizeLiveModel(String(value))
        : value
    }
    try {
      this.savePersistedConfig()
    } catch (error) {
      this.config = previous
      throw error
    }
    return this.getConfig()
  }

  public getConfigSummary(isConnected: boolean): ConfigSummary {
    return {
      apiKey: this.config.apiKey
        ? `${this.config.apiKey.slice(0, 6)}...${this.config.apiKey.slice(-4)}`
        : '',
      hasFullKey: this.config.apiKey.length > 10,
      voiceName: this.config.voiceName,
      model: this.config.model,
      agentName: this.config.agentName,
      checkUpdatesDaily: this.config.checkUpdatesDaily,
      enableWakeWord: this.config.enableWakeWord,
      enableBloom: this.config.enableBloom,
      enableNeuralBg: this.config.enableNeuralBg,
      enableEyeTracking: this.config.enableEyeTracking,
      enableScreenAwareness: this.config.enableScreenAwareness,
      isConnected
    }
  }
}

export const configStore = new ConfigStore()
