import crypto from 'crypto'
import { app } from 'electron'
import { configStore } from '../config/config-store'
import { getHardwareInfo } from './hwid'
import type { LicenseValidationResult, LicenseInfo } from '@shared'
import { verifySignedLease, type LeaseVerificationContext } from './lease-verifier'
import { LICENSE_KEYRING, PRODUCTION_KEY_ID } from './license-keyring'

interface LeaseResponse {
  token: string
  expiresAt: string
}

interface ActivationResponse {
  status: 'active'
  deviceId: string
  deviceSecret?: string
  lease: LeaseResponse
}

interface ApiErrorBody {
  error?: { code?: string; message?: string }
}

export const DEFAULT_LICENSE_API_URL = 'https://jasper-api-production.jasper-avatar.workers.dev'
export { LICENSE_KEYRING, PRODUCTION_KEY_ID }

export class LicenseManager {
  private revocationListeners: Array<(result: LicenseValidationResult) => void> = []
  private customKeyring: Record<string, JsonWebKey> | null = null
  private apiBaseUrl = (
    typeof app !== 'undefined' && app.isPackaged
      ? DEFAULT_LICENSE_API_URL
      : (process.env.JASPER_API_URL || DEFAULT_LICENSE_API_URL)
  ).replace(/\/+$/, '')

  constructor(private readonly now: () => number = () => Date.now()) {}

  public setCustomBaseUrl(url: string | null): void {
    if (typeof app !== 'undefined' && app.isPackaged) {
      console.warn('[LicenseManager] [SEC-01] Custom license URL is prohibited in packaged production mode.')
      return
    }
    this.apiBaseUrl = (url || '').replace(/\/+$/, '')
  }

  public setTestKeyring(keyring: Record<string, JsonWebKey> | null): void {
    if (typeof app !== 'undefined' && app.isPackaged) {
      console.warn('[LicenseManager] Custom keyring is prohibited in packaged production mode.')
      return
    }
    this.customKeyring = keyring
  }

  public validateKeyFormat(key: string): boolean {
    if (typeof key !== 'string') return false
    const normalized = key.trim().toUpperCase()
    if (!/^JASPER-(?:[A-HJ-NP-Z2-9]{5}-){5}[A-HJ-NP-Z2-9]{2}$/.test(normalized)) return false

    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    const body = normalized.slice('JASPER-'.length).replace(/-/g, '')
    const randomBody = body.slice(0, -1)
    const checksumIndex = [...randomBody].reduce(
      (sum, character, index) => (sum + (index + 1) * alphabet.indexOf(character)) % 32,
      0
    )
    return body.at(-1) === alphabet[checksumIndex]
  }

  private async requestJson<T>(path: string, body?: unknown): Promise<T> {
    if (!this.apiBaseUrl) throw new Error('LICENSE_API_NOT_CONFIGURED')
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000)
    })
    const result = await response.json().catch(() => ({})) as T & ApiErrorBody
    if (!response.ok) {
      const error = new Error(result.error?.message || `Falha no servidor de licenças (HTTP ${response.status}).`)
      error.name = result.error?.code || `HTTP_${response.status}`
      throw error
    }
    return result
  }

  public machineHash(): string {
    return crypto.createHash('sha256').update(getHardwareInfo().machineId).digest('base64url')
  }

  private getVerificationContext(): LeaseVerificationContext {
    const cfg = configStore.getConfig()
    const lastTrusted = cfg.licenseLastTrustedAt ? Date.parse(cfg.licenseLastTrustedAt) : undefined
    const lastObserved = cfg.licenseLastObservedAt ? Date.parse(cfg.licenseLastObservedAt) : undefined
    const nowMs = this.now()
    return {
      keyring: this.customKeyring ?? undefined,
      installationId: cfg.licenseInstallationId || '',
      machineHash: this.machineHash(),
      nowMs,
      nowSeconds: Math.floor(nowMs / 1000),
      lastTrustedTimeMs: isNaN(lastTrusted as number) ? undefined : lastTrusted,
      lastObservedTimeMs: isNaN(lastObserved as number) ? undefined : lastObserved
    }
  }

  private async storeActiveLease(
    key: string,
    installationId: string,
    response: ActivationResponse,
    activationStatus?: 'ACTIVATED' | 'ACTIVE'
  ): Promise<LicenseValidationResult> {
    const context = this.getVerificationContext()
    context.installationId = installationId

    const verified = await verifySignedLease(response.lease.token, context)
    if (!verified.valid) {
      return {
        valid: false,
        error: verified.error,
        message: verified.message || 'O servidor retornou uma autorização de licença inválida.'
      }
    }

    const cfg = configStore.getConfig()
    const nowMs = this.now()
    const now = new Date(nowMs).toISOString()
    const trustedTimeIso = new Date(verified.trustedServerTime).toISOString()
    const signedExpiresAt = new Date(verified.claims.exp * 1000).toISOString()
    const previousObserved = cfg.licenseLastObservedAt ? Date.parse(cfg.licenseLastObservedAt) : 0
    const observedTimeIso = new Date(Math.max(Number.isFinite(previousObserved) ? previousObserved : 0, nowMs)).toISOString()

    configStore.updateInternalConfig({
      licenseKey: key,
      licenseStatus: 'active',
      licenseMachineId: getHardwareInfo().machineId,
      licenseActivatedAt: cfg.licenseActivatedAt || now,
      licenseLastCheckedAt: now,
      licenseInstallationId: installationId,
      licenseDeviceId: response.deviceId,
      licenseDeviceSecret: response.deviceSecret || cfg.licenseDeviceSecret || '',
      licenseLeaseToken: response.lease.token,
      licenseLeaseExpiresAt: signedExpiresAt,
      licenseLastTrustedAt: trustedTimeIso,
      licenseLastObservedAt: observedTimeIso
    })

    return {
      valid: true,
      status: activationStatus || (cfg.licenseDeviceId ? 'ACTIVE' : 'ACTIVATED'),
      message: 'Licença ativa e vinculada a esta instalação.',
      machineId: getHardwareInfo().machineId,
      activatedAt: cfg.licenseActivatedAt || now,
      lastSeenAt: now,
      expiresAt: signedExpiresAt,
      trustedServerTime: verified.trustedServerTime
    }
  }

  public async activateLicense(key: string): Promise<LicenseValidationResult> {
    const cleanKey = key.trim().toUpperCase()
    if (!this.validateKeyFormat(cleanKey)) {
      return { valid: false, error: 'INVALID_FORMAT', message: 'Formato de chave inválido.' }
    }

    const cfg = configStore.getConfig()
    const installationId = cfg.licenseInstallationId || crypto.randomUUID()
    const wasAlreadyBound = Boolean(
      cfg.licenseKey === cleanKey &&
      cfg.licenseDeviceId &&
      cfg.licenseDeviceSecret
    )
    if (!configStore.canPersistSecrets()) {
      return {
        valid: false,
        error: 'DEVICE_STORAGE_UNAVAILABLE',
        message: 'O armazenamento seguro do Windows está indisponível. A ativação não foi enviada para evitar perder o vínculo da licença.'
      }
    }
    try {
      const response = await this.requestJson<ActivationResponse>('/v1/licenses/activate', {
        licenseKey: cleanKey,
        installationId,
        machineHash: this.machineHash(),
        deviceSecret: cfg.licenseKey === cleanKey ? cfg.licenseDeviceSecret : undefined
      })
      const deviceSecret = response.deviceSecret || (cfg.licenseKey === cleanKey ? cfg.licenseDeviceSecret : '')
      if (!response.deviceId || !deviceSecret) {
        return {
          valid: false,
          error: 'DEVICE_CREDENTIALS_MISSING',
          message: 'O servidor não retornou as credenciais obrigatórias do dispositivo.'
        }
      }

      // The server binding already exists after a successful activation response.
      // Persist its recovery credentials before lease verification so a rejected
      // lease cannot orphan the installation and make the next attempt impossible.
      configStore.updateInternalConfig({
        licenseKey: cleanKey,
        licenseStatus: 'disabled',
        licenseInstallationId: installationId,
        licenseDeviceId: response.deviceId,
        licenseDeviceSecret: deviceSecret,
        licenseLeaseToken: '',
        licenseLeaseExpiresAt: ''
      })

      return this.storeActiveLease(
        cleanKey,
        installationId,
        { ...response, deviceSecret },
        wasAlreadyBound ? 'ACTIVE' : 'ACTIVATED'
      )
    } catch (error: any) {
      const code = error?.name || 'NETWORK_ERROR'
      const isNetwork = ['AbortError', 'TimeoutError', 'TypeError', 'LICENSE_API_NOT_CONFIGURED'].includes(code)
      const needsDeviceRecovery = /device[_ -]?secret/i.test(code) || /segredo do dispositivo|device secret/i.test(error?.message || '')
      if (needsDeviceRecovery) {
        return {
          valid: false,
          error: 'DEVICE_RECOVERY_REQUIRED',
          message: 'Esta licença já está vinculada, mas este aplicativo não possui mais o segredo do dispositivo. No painel comercial, use “Liberar máquina” e ative novamente.'
        }
      }
      if (/persistir a configuração|criptografar a configuração/i.test(error?.message || '')) {
        return {
          valid: false,
          error: 'DEVICE_RECOVERY_REQUIRED',
          message: 'O servidor vinculou a licença, mas o segredo do dispositivo não pôde ser salvo. No painel comercial, use “Liberar máquina” após restaurar o armazenamento seguro do Windows.'
        }
      }
      if (code === 'license_already_bound' || code === 'activation_conflict') {
        configStore.updateInternalConfig({ licenseStatus: 'disabled' })
        return { valid: false, error: 'MACHINE_MISMATCH', message: error.message }
      }
      return {
        valid: false,
        error: isNetwork ? 'NETWORK_ERROR' : code.toUpperCase(),
        message: isNetwork ? 'Não foi possível comunicar com o servidor de licenças.' : error.message
      }
    }
  }

  private async heartbeat(): Promise<LicenseValidationResult> {
    const cfg = configStore.getConfig()
    if (!cfg.licenseDeviceId || !cfg.licenseDeviceSecret || !cfg.licenseInstallationId || !cfg.licenseKey) {
      return this.activateLicense(cfg.licenseKey || '')
    }
    try {
      const response = await this.requestJson<{ status: 'active'; lease: LeaseResponse }>('/v1/licenses/heartbeat', {
        deviceId: cfg.licenseDeviceId,
        deviceSecret: cfg.licenseDeviceSecret,
        nonce: crypto.randomUUID()
      })
      return this.storeActiveLease(cfg.licenseKey, cfg.licenseInstallationId, {
        status: 'active',
        deviceId: cfg.licenseDeviceId,
        lease: response.lease
      })
    } catch (error: any) {
      const code = error?.name || 'NETWORK_ERROR'
      const isNetwork = ['AbortError', 'TimeoutError', 'TypeError', 'LICENSE_API_NOT_CONFIGURED'].includes(code)
      return {
        valid: false,
        error: isNetwork ? 'NETWORK_ERROR' : code.toUpperCase(),
        message: isNetwork ? 'Não foi possível comunicar com o servidor de licenças.' : error.message
      }
    }
  }

  public async offlineLeaseResult(): Promise<LicenseValidationResult> {
    const cfg = configStore.getConfig()
    if (!cfg.licenseLeaseToken || !cfg.licenseInstallationId) {
      return { valid: false, error: 'NO_LICENSE', message: 'Nenhuma autorização de licença encontrada.' }
    }

    const context = this.getVerificationContext()
    const verified = await verifySignedLease(cfg.licenseLeaseToken, context)
    if (!verified.valid) {
      if (verified.error === 'EXPIRED') {
        configStore.updateInternalConfig({ licenseStatus: 'disabled' })
        return { valid: false, error: 'EXPIRED', message: 'A autorização offline da licença expirou.' }
      }
      return { valid: false, error: verified.error, message: verified.message }
    }

    const nowMs = context.nowMs ?? this.now()
    const previousObserved = cfg.licenseLastObservedAt ? Date.parse(cfg.licenseLastObservedAt) : 0
    const observedTimeIso = new Date(Math.max(Number.isFinite(previousObserved) ? previousObserved : 0, nowMs)).toISOString()
    const signedExpiresAt = new Date(verified.claims.exp * 1000).toISOString()
    configStore.updateInternalConfig({
      licenseLastObservedAt: observedTimeIso,
      licenseLeaseExpiresAt: signedExpiresAt
    })

    return {
      valid: true,
      status: 'ACTIVE',
      message: 'Licença válida em modo offline dentro da janela assinada de até 72 horas.',
      machineId: getHardwareInfo().machineId,
      lastSeenAt: cfg.licenseLastCheckedAt,
      expiresAt: signedExpiresAt,
      trustedServerTime: verified.trustedServerTime
    }
  }

  public async verifyCurrentLicense(forceOnline = false): Promise<LicenseValidationResult> {
    const cfg = configStore.getConfig()
    if (!cfg.licenseKey) {
      const result: LicenseValidationResult = { valid: false, error: 'NO_LICENSE', message: 'Nenhuma chave de licença configurada.' }
      this.notifyRevoked(result)
      return result
    }
    if (cfg.licenseMachineId && cfg.licenseMachineId !== getHardwareInfo().machineId) {
      configStore.updateInternalConfig({ licenseStatus: 'disabled' })
      return { valid: false, error: 'MACHINE_MISMATCH', message: 'O hardware atual não corresponde à instalação licenciada.' }
    }

    if (!forceOnline) {
      const offline = await this.offlineLeaseResult()
      if (offline.valid) {
        return offline
      }
      if (offline.error === 'CLOCK_ROLLBACK') {
        console.warn('[LicenseManager] Relógio regressivo detectado; forçando validação online.')
      }
    }

    const onlineResult = await this.heartbeat()
    if (onlineResult.valid) {
      return onlineResult
    }

    if (onlineResult.error === 'NETWORK_ERROR') {
      const offline = await this.offlineLeaseResult()
      if (offline.valid) return offline
      return offline
    }

    const isRevoked = ['REVOKED', 'LICENSE_REVOKED', 'LICENSE_UNAVAILABLE', 'DISABLED'].includes(onlineResult.error || '')
    configStore.updateInternalConfig({ licenseStatus: isRevoked ? 'revoked' : 'disabled' })
    this.notifyRevoked(onlineResult)
    return onlineResult
  }

  public onRevoked(listener: (result: LicenseValidationResult) => void): () => void {
    this.revocationListeners.push(listener)
    return () => { this.revocationListeners = this.revocationListeners.filter((item) => item !== listener) }
  }

  public notifyRevoked(result: LicenseValidationResult): void {
    for (const listener of this.revocationListeners) {
      try { listener(result) } catch (error) { console.error('[LicenseManager] Listener de revogação falhou:', error) }
    }
  }

  public async checkAccess24h(force = false): Promise<LicenseValidationResult> {
    return this.verifyCurrentLicense(force)
  }

  public getLicenseInfo(): LicenseInfo {
    const cfg = configStore.getConfig()
    const hw = getHardwareInfo()
    return {
      isLicensed: Boolean(cfg.licenseKey && cfg.licenseStatus === 'active'),
      status: (cfg.licenseStatus as any) || 'unlicensed',
      keyMasked: cfg.licenseKey ? `${cfg.licenseKey.slice(0, 10)}...${cfg.licenseKey.slice(-4)}` : undefined,
      machineId: cfg.licenseMachineId,
      currentHwid: hw.machineId,
      activatedAt: cfg.licenseActivatedAt,
      lastSeenAt: cfg.licenseLastCheckedAt,
      expiresAt: cfg.licenseLeaseExpiresAt
    }
  }
}

export const licenseManager = new LicenseManager()
