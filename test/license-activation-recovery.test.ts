import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import { webcrypto } from 'node:crypto'
import path from 'node:path'
import { app, safeStorage } from 'electron'
import { configStore } from '../src/main/config/config-store'
import { LicenseManager } from '../src/main/services/license-manager'

describe('license activation credential recovery', () => {
  const licenseKey = 'JASPER-ABCDE-FGHJK-LMNPQ-RSTUV-WXYZ2-34'
  const requests: Array<Record<string, unknown>> = []
  let responseMode: 'lease' | 'missing-secret' = 'lease'
  let server: http.Server
  let baseUrl: string

  before(async () => {
    server = http.createServer((request, response) => {
      let raw = ''
      request.on('data', (chunk) => { raw += chunk })
      request.on('end', () => {
        requests.push(JSON.parse(raw || '{}'))
        response.setHeader('content-type', 'application/json')
        if (responseMode === 'missing-secret') {
          response.statusCode = 409
          response.end(JSON.stringify({
            error: { code: 'device_secret_required', message: 'Segredo do dispositivo obrigatório.' }
          }))
          return
        }
        response.end(JSON.stringify({
          status: 'active',
          deviceId: 'device-recovery-1',
          deviceSecret: 'device-secret-recovery-1',
          lease: { token: 'invalid.signed.lease', expiresAt: '2099-01-01T00:00:00.000Z' }
        }))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  })

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  test('persists activation credentials before lease verification so retry can authenticate', async () => {
    responseMode = 'lease'
    const requestStart = requests.length
    configStore.updateInternalConfig({
      licenseKey: '',
      licenseStatus: 'unlicensed',
      licenseInstallationId: '',
      licenseDeviceId: '',
      licenseDeviceSecret: '',
      licenseLeaseToken: ''
    })
    const manager = new LicenseManager()
    manager.setCustomBaseUrl(baseUrl)

    const first = await manager.activateLicense(licenseKey)
    assert.equal(first.valid, false)

    configStore.loadPersistedConfig()
    const recovered = configStore.getConfig()
    assert.equal(recovered.licenseStatus, 'disabled')
    assert.equal(recovered.licenseKey, licenseKey)
    assert.equal(recovered.licenseDeviceId, 'device-recovery-1')
    assert.equal(recovered.licenseDeviceSecret, 'device-secret-recovery-1')
    assert.ok(recovered.licenseInstallationId)

    const second = await manager.activateLicense(licenseKey)
    assert.equal(second.valid, false)
    assert.equal(requests.length, requestStart + 2)
    assert.equal(requests[requestStart + 1].installationId, requests[requestStart].installationId)
    assert.equal(requests[requestStart + 1].deviceSecret, 'device-secret-recovery-1')
  })

  test('clears an older lease before verifying a new activation lease', async () => {
    responseMode = 'lease'
    const manager = new LicenseManager()
    manager.setCustomBaseUrl(baseUrl)
    const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair
    const publicJwk = await webcrypto.subtle.exportKey('jwk', pair.publicKey)
    manager.setTestKeyring({ 'old-valid-key': publicJwk })
    const now = Math.floor(Date.now() / 1000)
    const installationId = 'installation-with-old-lease'
    const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid: 'old-valid-key' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({
      iss: 'jasper-license-api',
      aud: 'jasper-avatar-desktop',
      installationId,
      machineHash: manager.machineHash(),
      iat: now,
      exp: now + 3600
    })).toString('base64url')
    const signature = await webcrypto.subtle.sign(
      { name: 'Ed25519' },
      pair.privateKey,
      Buffer.from(`${header}.${payload}`, 'utf8')
    )
    const oldLease = `${header}.${payload}.${Buffer.from(signature).toString('base64url')}`
    configStore.updateInternalConfig({
      licenseKey,
      licenseStatus: 'active',
      licenseInstallationId: installationId,
      licenseDeviceId: 'old-device',
      licenseDeviceSecret: 'old-device-secret',
      licenseLeaseToken: oldLease,
      licenseLeaseExpiresAt: new Date((now + 3600) * 1000).toISOString()
    })

    const activation = await manager.activateLicense(licenseKey)
    assert.equal(activation.valid, false)
    const offline = await manager.offlineLeaseResult()
    assert.equal(offline.valid, false)
    assert.equal(offline.error, 'NO_LICENSE')
  })

  test('turns an orphaned server binding into actionable recovery guidance', async () => {
    responseMode = 'missing-secret'
    configStore.updateInternalConfig({
      licenseKey: '',
      licenseStatus: 'unlicensed',
      licenseInstallationId: '',
      licenseDeviceId: '',
      licenseDeviceSecret: ''
    })
    const manager = new LicenseManager()
    manager.setCustomBaseUrl(baseUrl)

    const result = await manager.activateLicense(licenseKey)

    assert.equal(result.valid, false)
    assert.equal(result.error, 'DEVICE_RECOVERY_REQUIRED')
    assert.match(result.message, /Liberar m[aá]quina/i)
  })

  test('does not contact the activation server when secrets cannot be persisted', async () => {
    responseMode = 'lease'
    const requestStart = requests.length
    const originalAvailability = safeStorage.isEncryptionAvailable
    ;(safeStorage as any).isEncryptionAvailable = () => false
    try {
      const manager = new LicenseManager()
      manager.setCustomBaseUrl(baseUrl)
      const result = await manager.activateLicense(licenseKey)
      assert.equal(result.valid, false)
      assert.equal(result.error, 'DEVICE_STORAGE_UNAVAILABLE')
      assert.equal(requests.length, requestStart)
    } finally {
      ;(safeStorage as any).isEncryptionAvailable = originalAvailability
    }
  })

  test('does not contact the activation server when the encryption probe throws', async () => {
    responseMode = 'lease'
    const requestStart = requests.length
    const originalEncrypt = safeStorage.encryptString
    ;(safeStorage as any).encryptString = () => { throw new Error('simulated DPAPI failure') }
    try {
      const manager = new LicenseManager()
      manager.setCustomBaseUrl(baseUrl)
      const result = await manager.activateLicense(licenseKey)
      assert.equal(result.valid, false)
      assert.equal(result.error, 'DEVICE_STORAGE_UNAVAILABLE')
      assert.equal(requests.length, requestStart)
    } finally {
      ;(safeStorage as any).encryptString = originalEncrypt
    }
  })

  test('does not contact the activation server when an existing encrypted secret is unreadable', async () => {
    responseMode = 'lease'
    const requestStart = requests.length
    const configPath = path.join(app.getPath('userData'), 'jasper-config.json')
    const originalDecrypt = safeStorage.decryptString
    const unreadableCiphertext = Buffer.from('unreadable-existing-secret', 'utf8')
    fs.writeFileSync(configPath, JSON.stringify({
      licenseDeviceSecret: `enc:${unreadableCiphertext.toString('base64')}`
    }), 'utf8')
    ;(safeStorage as any).decryptString = (encrypted: Buffer) => {
      if (encrypted.equals(unreadableCiphertext)) throw new Error('simulated foreign DPAPI ciphertext')
      return originalDecrypt(encrypted)
    }

    try {
      configStore.loadPersistedConfig()
      const manager = new LicenseManager()
      manager.setCustomBaseUrl(baseUrl)

      const result = await manager.activateLicense(licenseKey)

      assert.equal(result.valid, false)
      assert.equal(result.error, 'DEVICE_STORAGE_UNAVAILABLE')
      assert.equal(requests.length, requestStart)
    } finally {
      ;(safeStorage as any).decryptString = originalDecrypt
      fs.unlinkSync(configPath)
      configStore.loadPersistedConfig()
    }
  })
})
