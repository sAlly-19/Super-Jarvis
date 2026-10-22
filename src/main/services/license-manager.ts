import crypto, { webcrypto } from 'crypto'
import { app } from 'electron'
import { configStore } from '../config/config-store'
import { getHardwareInfo } from './hwid'
import type { LicenseValidationResult, LicenseInfo } from '@shared'

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

export const PINNED_PRODUCTION_PUBLIC_JWK: JsonWebKey = {
  kty: 'OKP',
  crv: 'Ed25519',
  x: '6m25tI8dGf9mP3H7kR1yV5uW9xZ8bA2cD4eF6gH8jK0'
}

function decodeJsonSegment(segment: string): Record<string, any> {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf-8'))
}

export class LicenseManager {
  private revocationListeners: Array<(result: LicenseValidationResult) => void> = []
  private apiBaseUrl = (
    typeof app !== 'undefined' && app.isPackaged
      ? DEFAULT_LICENSE_API_URL
      : (process.env.JASPER_API_URL || DEFAULT_LICENSE_API_URL)
  ).replace(/\/+$/, '')

  public setCustomBaseUrl(url: string | null): void {
    if (typeof app !== 'undefined' && app.isPackaged) {
      console.warn('[LicenseManager] [SEC-01] Custom license URL is prohibited in packaged production mode.')
      return
    }
    this.apiBaseUrl = (url || '').replace(/\/+$/, '')
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

  private machineHash(): string {
    return crypto.createHash('sha256').update(getHardwareInfo().machineId).digest('base64url')
  }

  private async verifyLease(token: string, publicJwkJson: string, installationId: string): Promise<boolean> {
    try {
      const parts = token.split('.')
      if (parts.length !== 3) return false
      const [encodedHeader, encodedPayload, encodedSignature] = parts
      if (!encodedHeader || !encodedPayload || !encodedSignature) return false
      const header = decodeJsonSegment(encodedHeader)
      const payload = decodeJsonSegment(encodedPayload)
      if (header.alg !== 'EdDSA' || payload.iss !== 'jasper-license-api' || payload.aud !== 'jasper-avatar-desktop') return false
      if (payload.installationId !== installationId || payload.machineHash !== this.machineHash()) return false
      const nowSeconds = Math.floor(Date.now() / 1000)
      if (!Number.isFinite(payload.iat) || !Number.isFinite(payload.exp)) return false
      if (payload.iat > nowSeconds + 300 || payload.exp <= nowSeconds || payload.exp - payload.iat > 259_200) return false

      let jwk: JsonWebKey
      if (typeof app !== 'undefined' && app.isPackaged) {
        jwk = PINNED_PRODUCTION_PUBLIC_JWK
      } else {
        try {
          jwk = publicJwkJson ? (JSON.parse(publicJwkJson) as JsonWebKey) : PINNED_PRODUCTION_PUBLIC_JWK
        } catch {
          jwk = PINNED_PRODUCTION_PUBLIC_JWK
        }
      }
      if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519') return false
      const key = await webcrypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['verify'])
      return webcrypto.subtle.verify(
        { name: 'Ed25519' },
        key,
        Buffer.from(encodedSignature, 'base64url'),
        Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf-8')
      )
    } catch {
      return false
    }
  }

  private async storeActiveLease(
    key: string,
    installationId: string,
    publicJwk: string,
    response: ActivationResponse
  ): Promise<LicenseValidationResult> {
    if (!await this.verifyLease(response.lease.token, publicJwk, installationId)) {
      return { valid: false, error: 'INVALID_LEASE', message: 'O servidor retornou uma autorização de licença inválida.' }
    }

    const cfg = configStore.getConfig()
    const now = new Date().toISOString()
    configStore.updateConfig({
      licenseKey: key,
      licenseStatus: 'active',
      licenseMachineId: getHardwareInfo().machineId,
      licenseActivatedAt: cfg.licenseActivatedAt || now,
      licenseLastCheckedAt: now,
      licenseInstallationId: installationId,
      licenseDeviceId: response.deviceId,
      licenseDeviceSecret: response.deviceSecret || cfg.licenseDeviceSecret || '',
      licenseLeaseToken: response.lease.token,
      licenseLeaseExpiresAt: response.lease.expiresAt,
      licensePublicJwk: publicJwk
    })
    return {
      valid: true,
      status: cfg.licenseDeviceId ? 'ACTIVE' : 'ACTIVATED',
      message: 'Licença ativa e vinculada a esta instalação.',
      machineId: getHardwareInfo().machineId,
      activatedAt: cfg.licenseActivatedAt || now,
      lastSeenAt: now
    }
  }

  public async activateLicense(key: string): Promise<LicenseValidationResult> {
    const cleanKey = key.trim().toUpperCase()
    if (!this.validateKeyFormat(cleanKey)) {
      return { valid: false, error: 'INVALID_FORMAT', message: 'Formato de chave inválido.' }
    }

    const cfg = configStore.getConfig()
    const installationId = cfg.licenseInstallationId || crypto.randomUUID()
    try {
      const publicKeyResponse = await this.requestJson<{ key: JsonWebKey }>('/v1/licenses/public-key')
      const publicJwk = JSON.stringify(publicKeyResponse.key)
      const response = await this.requestJson<ActivationResponse>('/v1/licenses/activate', {
        licenseKey: cleanKey,
        installationId,
        machineHash: this.machineHash(),
        deviceSecret: cfg.licenseKey === cleanKey ? cfg.licenseDeviceSecret : undefined
      })
      return this.storeActiveLease(cleanKey, installationId, publicJwk, response)
    } catch (error: any) {
      const code = error?.name || 'NETWORK_ERROR'
      const isNetwork = ['AbortError', 'TimeoutError', 'TypeError', 'LICENSE_API_NOT_CONFIGURED'].includes(code)
      if (code === 'license_already_bound' || code === 'activation_conflict') {
        configStore.updateConfig({ licenseStatus: 'disabled' })
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
    if (!cfg.licenseDeviceId || !cfg.licenseDeviceSecret || !cfg.licenseInstallationId || !cfg.licenseKey || !cfg.licensePublicJwk) {
      return this.activateLicense(cfg.licenseKey || '')
    }
    try {
      const response = await this.requestJson<{ status: 'active'; lease: LeaseResponse }>('/v1/licenses/heartbeat', {
        deviceId: cfg.licenseDeviceId,
        deviceSecret: cfg.licenseDeviceSecret,
        nonce: crypto.randomUUID()
      })
      return this.storeActiveLease(cfg.licenseKey, cfg.licenseInstallationId, cfg.licensePublicJwk, {
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

  private async offlineLeaseResult(): Promise<LicenseValidationResult | null> {
    const cfg = configStore.getConfig()
    if (!cfg.licenseLeaseToken || !cfg.licenseInstallationId) return null
    const jwkToUse = cfg.licensePublicJwk || JSON.stringify(PINNED_PRODUCTION_PUBLIC_JWK)
    if (!await this.verifyLease(cfg.licenseLeaseToken, jwkToUse, cfg.licenseInstallationId)) return null
    return {
      valid: true,
      status: 'ACTIVE',
      message: 'Licença válida em modo offline dentro da janela assinada de até 72 horas.',
      machineId: getHardwareInfo().machineId,
      lastSeenAt: cfg.licenseLastCheckedAt
    }
  }

  public async verifyCurrentLicense(): Promise<LicenseValidationResult> {
    const cfg = configStore.getConfig()
    if (!cfg.licenseKey) return { valid: false, error: 'NO_LICENSE', message: 'Nenhuma chave de licença configurada.' }
    if (cfg.licenseMachineId && cfg.licenseMachineId !== getHardwareInfo().machineId) {
      configStore.updateConfig({ licenseStatus: 'disabled' })
      return { valid: false, error: 'MACHINE_MISMATCH', message: 'O hardware atual não corresponde à instalação licenciada.' }
    }

    const onlineResult = await this.heartbeat()
    if (onlineResult.valid) return onlineResult
    if (onlineResult.error === 'NETWORK_ERROR') {
      const offline = await this.offlineLeaseResult()
      if (offline) return offline
    }
    configStore.updateConfig({ licenseStatus: onlineResult.error === 'LICENSE_UNAVAILABLE' ? 'revoked' : 'disabled' })
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
    const cfg = configStore.getConfig()
    if (!cfg.licenseKey) {
      const result = { valid: false, error: 'NO_LICENSE', message: 'Nenhuma chave de licença configurada.' }
      this.notifyRevoked(result)
      return result
    }
    const lastChecked = cfg.licenseLastCheckedAt ? Date.parse(cfg.licenseLastCheckedAt) : NaN
    const now = Date.now()

    if (
      !force &&
      !isNaN(lastChecked) &&
      lastChecked <= now &&
      now - lastChecked < 24 * 60 * 60 * 1000
    ) {
      const offline = await this.offlineLeaseResult()
      if (offline) return offline
    }
    return this.verifyCurrentLicense()
  }

  public getLicenseInfo(): LicenseInfo {
    const cfg = configStore.getConfig()
    const hw = getHardwareInfo()
    return {
      isLicensed: Boolean(cfg.licenseKey && cfg.licenseStatus === 'active'),
      status: cfg.licenseStatus || 'unlicensed',
      keyMasked: cfg.licenseKey ? `${cfg.licenseKey.slice(0, 10)}...${cfg.licenseKey.slice(-4)}` : undefined,
      machineId: cfg.licenseMachineId,
      currentHwid: hw.machineId,
      activatedAt: cfg.licenseActivatedAt,
      lastSeenAt: cfg.licenseLastCheckedAt
    }
  }
}

export const licenseManager = new LicenseManager()
