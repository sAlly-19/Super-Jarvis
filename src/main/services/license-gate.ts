import { licenseManager } from './license-manager'
import { pythonBackend } from './python-backend'
import type {
  LicenseState,
  LicenseGateSnapshot,
  LicenseValidationResult,
  LicenseActivationOutcome
} from '@shared'

export interface LicenseAuthority {
  verifyCurrentLicense(forceOnline?: boolean): Promise<LicenseValidationResult>
  activateLicense(key: string): Promise<LicenseValidationResult>
  onRevoked(listener: (result: LicenseValidationResult) => void): () => void
}

export interface BackendLifecycle {
  start(): Promise<void | boolean>
  stop(reason?: string): Promise<void>
}

export interface LicenseGateTimers {
  now(): number
  setTimeout(callback: () => void, delayMs: number): NodeJS.Timeout
  clearTimeout(handle: NodeJS.Timeout): void
}

const DEFAULT_TIMERS: LicenseGateTimers = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle)
}

export class LicenseError extends Error {
  public readonly code = 'LICENSE_REQUIRED'
  constructor(message: string) {
    super(`LICENSE_REQUIRED: ${message}`)
    this.name = 'LicenseError'
  }
}

export class LicenseGate {
  private snapshot: LicenseGateSnapshot = {
    state: 'locked',
    message: 'Sistema bloqueado aguardando validação de licença.'
  }
  private listeners: Array<(snapshot: LicenseGateSnapshot) => void> = []
  private inFlightTransition: Promise<LicenseGateSnapshot> | null = null
  private unsubscribeRevocation: (() => void) | null = null
  private expiryTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly licenseAuthority: LicenseAuthority,
    private readonly backend: BackendLifecycle,
    private readonly timers: LicenseGateTimers = DEFAULT_TIMERS
  ) {
    this.unsubscribeRevocation = this.licenseAuthority.onRevoked((result) => {
      this.handleRevocationEvent(result)
    })
  }

  public getSnapshot(): LicenseGateSnapshot {
    return { ...this.snapshot }
  }

  public onStateChanged(listener: (snapshot: LicenseGateSnapshot) => void): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }

  private transitionTo(state: LicenseState, message: string, expiresAt?: string): LicenseGateSnapshot {
    this.snapshot = { state, message, expiresAt }
    for (const listener of this.listeners) {
      try {
        listener(this.getSnapshot())
      } catch (err) {
        console.error('[LicenseGate] Falha no ouvinte de estado:', err)
      }
    }
    this.syncExpiryTimer()
    return this.getSnapshot()
  }

  private clearExpiryTimer(): void {
    if (this.expiryTimer) {
      this.timers.clearTimeout(this.expiryTimer)
      this.expiryTimer = null
    }
  }

  private syncExpiryTimer(): void {
    this.clearExpiryTimer()
    if (this.snapshot.state !== 'unlocked' || !this.snapshot.expiresAt) return

    const expiresAt = this.snapshot.expiresAt
    const expiresAtMs = Date.parse(expiresAt)
    if (!Number.isFinite(expiresAtMs)) return

    this.expiryTimer = this.timers.setTimeout(() => {
      this.expiryTimer = null
      if (this.snapshot.state !== 'unlocked' || this.snapshot.expiresAt !== expiresAt) return

      const remainingMs = expiresAtMs - this.timers.now()
      if (remainingMs > 0) {
        this.syncExpiryTimer()
        return
      }

      this.transitionTo('expired', 'A autorização offline da licença expirou.')
      void this.backend.stop('license_expired').catch(() => {})
    }, Math.max(0, expiresAtMs - this.timers.now()))
  }

  private handleRevocationEvent(result: LicenseValidationResult): void {
    void this.backend.stop(result.error || 'license_revoked').catch(() => {})
    const targetState: LicenseState = result.error === 'EXPIRED' ? 'expired' : 'revoked'
    this.transitionTo(targetState, result.message || 'Licença revogada ou expirada.')
  }

  public requireUnlocked(): void {
    if (this.snapshot.state !== 'unlocked') {
      throw new LicenseError(this.snapshot.message)
    }
  }

  public async initialize(): Promise<LicenseGateSnapshot> {
    if (this.inFlightTransition) {
      return this.inFlightTransition
    }

    this.inFlightTransition = (async () => {
      try {
        this.transitionTo('validating', 'Validando autorização de licença...')
        const validation = await this.licenseAuthority.verifyCurrentLicense(false)

        if (validation.valid) {
          try {
            await this.backend.start()
            return this.transitionTo('unlocked', validation.message || 'Licença comercial válida.', validation.expiresAt)
          } catch (err: any) {
            console.error('[LicenseGate] Erro ao iniciar backend na inicialização:', err)
            await this.backend.stop('backend_start_failure').catch(() => {})
            return this.transitionTo('backend_error', `Falha ao iniciar componente backend: ${err?.message || err}`)
          }
        }

        // Invalid / no lease
        await this.backend.stop(validation.error || 'unlicensed').catch(() => {})
        const state: LicenseState = validation.error === 'EXPIRED' ? 'expired' : (validation.error === 'REVOKED' ? 'revoked' : 'locked')
        return this.transitionTo(state, validation.message)
      } finally {
        this.inFlightTransition = null
      }
    })()

    return this.inFlightTransition
  }

  public async activate(key: string): Promise<LicenseActivationOutcome> {
    this.transitionTo('validating', 'Ativando licença comercial...')
    const result = await this.licenseAuthority.activateLicense(key)
    let snapshot: LicenseGateSnapshot

    if (result.valid) {
      try {
        await this.backend.start()
        snapshot = this.transitionTo('unlocked', result.message || 'Licença ativada com sucesso.', result.expiresAt)
      } catch (err: any) {
        console.error('[LicenseGate] Erro ao iniciar backend após ativação:', err)
        await this.backend.stop('backend_start_failure').catch(() => {})
        snapshot = this.transitionTo('backend_error', `Erro ao iniciar backend após ativação: ${err?.message || err}`)
      }
    } else {
      await this.backend.stop('activation_failed').catch(() => {})
      const state: LicenseState = result.error === 'REVOKED' ? 'revoked' : 'locked'
      snapshot = this.transitionTo(state, result.message)
    }

    return { validation: result, snapshot }
  }

  public async refresh(forceOnline = false): Promise<LicenseGateSnapshot> {
    if (this.inFlightTransition) {
      return this.inFlightTransition
    }

    this.inFlightTransition = (async () => {
      try {
        const validation = await this.licenseAuthority.verifyCurrentLicense(forceOnline)

        if (validation.valid) {
          if (this.snapshot.state !== 'unlocked') {
            try {
              await this.backend.start()
            } catch (err: any) {
              await this.backend.stop('backend_start_failure').catch(() => {})
              return this.transitionTo('backend_error', `Falha no backend durante renovação: ${err?.message || err}`)
            }
          }
          return this.transitionTo('unlocked', validation.message || 'Licença ativa.', validation.expiresAt)
        }

        await this.backend.stop(validation.error || 'refresh_invalid').catch(() => {})
        const state: LicenseState = validation.error === 'EXPIRED' ? 'expired' : (validation.error === 'REVOKED' ? 'revoked' : 'locked')
        return this.transitionTo(state, validation.message)
      } finally {
        this.inFlightTransition = null
      }
    })()

    return this.inFlightTransition
  }

  public markBackendError(message: string): void {
    void this.backend.stop('backend_error_reported').catch(() => {})
    this.transitionTo('backend_error', message)
  }

  public async shutdown(): Promise<void> {
    if (this.unsubscribeRevocation) {
      this.unsubscribeRevocation()
      this.unsubscribeRevocation = null
    }
    await this.backend.stop('shutdown').catch(() => {})
    this.transitionTo('locked', 'Sistema encerrado.')
  }
}

export const licenseGate = new LicenseGate(licenseManager, pythonBackend)
pythonBackend.setExecutionAllowed(() => licenseGate.getSnapshot().state === 'unlocked')

