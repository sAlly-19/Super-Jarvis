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
    const backend = new MockBackendLifecycle()
    const gate = new LicenseGate(auth, backend)

    const snapshot = await gate.initialize()
    assert.equal(snapshot.state, 'unlocked')
    assert.equal(backend.startCalls, 1)
    assert.doesNotThrow(() => gate.requireUnlocked())
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

