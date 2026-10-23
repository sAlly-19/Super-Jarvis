import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import type { LicenseValidationResult, LicenseGateSnapshot } from '@shared'
// @ts-ignore - will be implemented in Step 3
import { LicenseGate, type LicenseAuthority, type BackendLifecycle } from '../src/main/services/license-gate'

class MockLicenseAuthority implements LicenseAuthority {
  public currentResult: LicenseValidationResult = {
    valid: false,
    error: 'NO_LICENSE',
    message: 'Nenhuma chave configurada'
  }
  public activationResult: LicenseValidationResult = {
    valid: true,
    status: 'ACTIVE',
    message: 'Ativação bem-sucedida',
    expiresAt: new Date(Date.now() + 3600000).toISOString()
  }
  public verifyCalls = 0
  public activateCalls = 0
  private revocationListeners: Array<(result: LicenseValidationResult) => void> = []

  async verifyCurrentLicense(_forceOnline?: boolean): Promise<LicenseValidationResult> {
    this.verifyCalls++
    return this.currentResult
  }

  async activateLicense(_key: string): Promise<LicenseValidationResult> {
    this.activateCalls++
    if (this.activationResult.valid) {
      this.currentResult = this.activationResult
    }
    return this.activationResult
  }

  onRevoked(listener: (result: LicenseValidationResult) => void): () => void {
    this.revocationListeners.push(listener)
    return () => {
      this.revocationListeners = this.revocationListeners.filter(l => l !== listener)
    }
  }

  triggerRevoked(result: LicenseValidationResult): void {
    for (const listener of this.revocationListeners) {
      listener(result)
    }
  }
}

class MockBackendLifecycle implements BackendLifecycle {
  public startCalls = 0
  public stopCalls = 0
  public stopReasons: string[] = []
  public shouldFailStart = false

  async start(): Promise<void> {
    this.startCalls++
    if (this.shouldFailStart) {
      throw new Error('Falha simulada ao iniciar backend')
    }
  }

  async stop(reason?: string): Promise<void> {
    this.stopCalls++
    if (reason) this.stopReasons.push(reason)
  }
}

class StartupGuardedBackendLifecycle extends MockBackendLifecycle {
  constructor(private readonly isStartupAllowed: () => boolean) {
    super()
  }

  override async start(): Promise<void> {
    if (!this.isStartupAllowed()) {
      throw new Error('Sidecar execution not allowed by license gate.')
    }
    await super.start()
  }
}

class ControlledStartupBackendLifecycle extends StartupGuardedBackendLifecycle {
  private releaseFirstStart!: () => void
  public readonly firstStartEntered: Promise<void>
  private readonly firstStartRelease: Promise<void>

  constructor(isStartupAllowed: () => boolean) {
    super(isStartupAllowed)
    this.firstStartEntered = new Promise((resolve) => {
      this.signalFirstStartEntered = resolve
    })
    this.firstStartRelease = new Promise((resolve) => {
      this.releaseFirstStart = resolve
    })
  }

  private signalFirstStartEntered!: () => void

  override async start(): Promise<void> {
    await super.start()
    if (this.startCalls === 1) {
      this.signalFirstStartEntered()
      await this.firstStartRelease
    }
  }

  completeFirstStart(): void {
    this.releaseFirstStart()
  }
}

class FakeGateTimers {
  public callback: (() => void) | null = null
  public delayMs: number | null = null

  constructor(public nowMs: number) {}

  now = (): number => this.nowMs

  setTimeout = (callback: () => void, delayMs: number): NodeJS.Timeout => {
    this.callback = callback
    this.delayMs = delayMs
    return {} as NodeJS.Timeout
  }

  clearTimeout = (_handle: NodeJS.Timeout): void => {
    this.callback = null
    this.delayMs = null
  }
}

describe('LicenseGate State Machine & Backend Lifecycle', () => {
  test('boot without lease never calls backend start and ends in locked', async () => {
    const auth = new MockLicenseAuthority()
    const backend = new MockBackendLifecycle()
    const gate = new LicenseGate(auth, backend)

    const snapshot = await gate.initialize()
    assert.equal(snapshot.state, 'locked')
    assert.equal(backend.startCalls, 0)
    assert.throws(() => gate.requireUnlocked(), {
      name: 'LicenseError',
      message: /LICENSE_REQUIRED/
    })
  })

  test('valid boot calls backend start once and ends in unlocked', async () => {
    const auth = new MockLicenseAuthority()
    auth.currentResult = {
      valid: true,
      status: 'ACTIVE',
      message: 'Licença ativa',
      expiresAt: new Date(Date.now() + 72 * 3600000).toISOString()
    }
    let gate!: LicenseGate
    const backend = new StartupGuardedBackendLifecycle(() => {
      const startupGate = gate as unknown as { isBackendStartupAllowed?: () => boolean }
      return startupGate.isBackendStartupAllowed?.() === true
    })
    gate = new LicenseGate(auth, backend)

    const snapshot = await gate.initialize()
    assert.equal(snapshot.state, 'unlocked')
    assert.equal(backend.startCalls, 1)
    assert.doesNotThrow(() => gate.requireUnlocked())
  })

  test('valid refresh from locked authorizes backend startup before unlocking', async () => {
    const auth = new MockLicenseAuthority()
    let gate!: LicenseGate
    const backend = new StartupGuardedBackendLifecycle(() => {
      const startupGate = gate as unknown as { isBackendStartupAllowed?: () => boolean }
      return startupGate.isBackendStartupAllowed?.() === true
    })
    gate = new LicenseGate(auth, backend)

    await gate.initialize()
    auth.currentResult = {
      valid: true,
      status: 'ACTIVE',
      message: 'Licença renovada',
      expiresAt: new Date(Date.now() + 72 * 3600000).toISOString()
    }

    const snapshot = await gate.refresh(true)

    assert.equal(snapshot.state, 'unlocked')
    assert.equal(backend.startCalls, 1)
  })

  test('concurrent initialize calls share one in-flight promise and start backend once', async () => {
    const auth = new MockLicenseAuthority()
    auth.currentResult = {
      valid: true,
      status: 'ACTIVE',
      message: 'Licença ativa'
    }
    const backend = new MockBackendLifecycle()
    const gate = new LicenseGate(auth, backend)

    const [snap1, snap2] = await Promise.all([gate.initialize(), gate.initialize()])
    assert.equal(snap1.state, 'unlocked')
    assert.equal(snap2.state, 'unlocked')
    assert.equal(backend.startCalls, 1)
  })

  test('failed backend start transitions to backend_error and stops backend', async () => {
    const auth = new MockLicenseAuthority()
    auth.currentResult = {
      valid: true,
      status: 'ACTIVE',
      message: 'Licença válida'
    }
    const backend = new MockBackendLifecycle()
    backend.shouldFailStart = true
    const gate = new LicenseGate(auth, backend)

    const snapshot = await gate.initialize()
    assert.equal(snapshot.state, 'backend_error')
    assert.throws(() => gate.requireUnlocked(), {
      name: 'LicenseError'
    })
  })

  test('successful activation starts backend and transitions from locked to unlocked', async () => {
    const auth = new MockLicenseAuthority()
    const backend = new MockBackendLifecycle()
    const gate = new LicenseGate(auth, backend)

    await gate.initialize()
    assert.equal(gate.getSnapshot().state, 'locked')
    assert.equal(backend.startCalls, 0)

    const actResult = await gate.activate('JASPER-ABCDE-FGHJK-LMNPQ-RSTUV-WXYZ2-34')
    assert.equal(actResult.validation.valid, true)
    assert.equal(actResult.snapshot.state, 'unlocked')
    assert.equal(gate.getSnapshot().state, 'unlocked')
    assert.equal(backend.startCalls, 1)
  })

  test('valid activation authorizes backend startup before publishing unlocked state', async () => {
    const auth = new MockLicenseAuthority()
    let gate!: LicenseGate
    const backend = new ControlledStartupBackendLifecycle(() => {
      const startupGate = gate as unknown as { isBackendStartupAllowed?: () => boolean }
      return startupGate.isBackendStartupAllowed?.() === true
    })
    gate = new LicenseGate(auth, backend)

    const activation = gate.activate('JASPER-ABCDE-FGHJK-LMNPQ-RSTUV-WXYZ2-34')
    await backend.firstStartEntered

    assert.equal(gate.getSnapshot().state, 'validating')
    assert.throws(() => gate.requireUnlocked(), { name: 'LicenseError' })
    assert.equal(gate.isBackendStartupAllowed(), true)

    backend.completeFirstStart()
    const outcome = await activation

    assert.equal(outcome.snapshot.state, 'unlocked')
    assert.equal(backend.startCalls, 1)
    assert.equal(gate.isBackendStartupAllowed(), true)
  })

  test('concurrent activations cannot publish unlocked before the first backend handshake completes', async () => {
    const auth = new MockLicenseAuthority()
    let gate!: LicenseGate
    const backend = new ControlledStartupBackendLifecycle(() => {
      const startupGate = gate as unknown as { isBackendStartupAllowed?: () => boolean }
      return startupGate.isBackendStartupAllowed?.() === true
    })
    gate = new LicenseGate(auth, backend)

    const firstActivation = gate.activate('JASPER-ABCDE-FGHJK-LMNPQ-RSTUV-WXYZ2-34')
    await backend.firstStartEntered
    let secondSettled = false
    const secondActivation = gate.activate('JASPER-ABCDE-FGHJK-LMNPQ-RSTUV-WXYZ2-34')
      .finally(() => { secondSettled = true })
    await new Promise<void>((resolve) => setImmediate(resolve))

    assert.equal(secondSettled, false)
    assert.equal(gate.getSnapshot().state, 'validating')
    assert.throws(() => gate.requireUnlocked(), { name: 'LicenseError' })

    backend.completeFirstStart()
    const [firstOutcome, secondOutcome] = await Promise.all([firstActivation, secondActivation])
    assert.equal(firstOutcome.snapshot.state, 'unlocked')
    assert.equal(secondOutcome.snapshot.state, 'unlocked')
  })

  test('activation reports backend_error when a valid lease cannot start the backend', async () => {
    const auth = new MockLicenseAuthority()
    const backend = new MockBackendLifecycle()
    backend.shouldFailStart = true
    const gate = new LicenseGate(auth, backend)

    const outcome = await gate.activate('JASPER-ABCDE-FGHJK-LMNPQ-RSTUV-WXYZ2-34')

    assert.equal(outcome.validation.valid, true)
    assert.equal(outcome.snapshot.state, 'backend_error')
    assert.equal(gate.getSnapshot().state, 'backend_error')
    assert.equal(backend.stopCalls, 1)
    assert.equal(gate.isBackendStartupAllowed(), false)
    assert.throws(() => gate.requireUnlocked(), { name: 'LicenseError' })
  })

  test('successful activation emits each canonical state once and never fabricates revocation', async () => {
    const auth = new MockLicenseAuthority()
    const backend = new MockBackendLifecycle()
    const gate = new LicenseGate(auth, backend)
    const states: string[] = []
    gate.onStateChanged((snapshot) => states.push(snapshot.state))

    const outcome = await gate.activate('JASPER-ABCDE-FGHJK-LMNPQ-RSTUV-WXYZ2-34')

    assert.equal(outcome.snapshot.state, 'unlocked')
    assert.deepEqual(states, ['validating', 'unlocked'])
  })

  test('locks at signed expiry using an exact timer instead of waiting for refresh', async () => {
    const nowMs = 1_800_000_000_000
    const auth = new MockLicenseAuthority()
    auth.currentResult = {
      valid: true,
      status: 'ACTIVE',
      message: 'Licença ativa',
      expiresAt: new Date(nowMs + 5_000).toISOString()
    }
    const backend = new MockBackendLifecycle()
    const timers = new FakeGateTimers(nowMs)
    const gate = new LicenseGate(auth, backend, timers)

    const snapshot = await gate.initialize()
    assert.equal(snapshot.state, 'unlocked')
    assert.equal(timers.delayMs, 5_000)
    assert.ok(timers.callback, 'expiry callback must be scheduled')

    timers.nowMs += 5_000
    timers.callback()
    await Promise.resolve()

    assert.equal(gate.getSnapshot().state, 'expired')
    assert.equal(backend.stopReasons.at(-1), 'license_expired')
  })

  test('expiry or revocation stops backend and transitions correctly', async () => {
    const auth = new MockLicenseAuthority()
    auth.currentResult = {
      valid: true,
      status: 'ACTIVE',
      message: 'Licença ativa'
    }
    const backend = new MockBackendLifecycle()
    const gate = new LicenseGate(auth, backend)

    await gate.initialize()
    assert.equal(gate.getSnapshot().state, 'unlocked')
    assert.equal(backend.startCalls, 1)

    // Simulate expiry on refresh
    auth.currentResult = {
      valid: false,
      error: 'EXPIRED',
      message: 'Lease expirou'
    }
    const expiredSnap = await gate.refresh(true)
    assert.equal(expiredSnap.state, 'expired')
    assert.equal(backend.stopCalls, 1)
    assert.throws(() => gate.requireUnlocked(), {
      name: 'LicenseError'
    })

    // Simulate revocation event
    auth.triggerRevoked({
      valid: false,
      error: 'REVOKED',
      message: 'Licença revogada'
    })
    assert.equal(gate.getSnapshot().state, 'revoked')
  })
})

