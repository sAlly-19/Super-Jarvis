import { afterEach, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { safeStorage } from 'electron'
import { ConfigStore } from '../src/main/config/config-store'

describe('ConfigStore public boundary and migration', () => {
  let tempDir: string
  let configPath: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-config-test-'))
    configPath = path.join(tempDir, 'jasper-config.json')
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  test('rejects unknown public keys before changing or persisting configuration', () => {
    const store = new ConfigStore(configPath)

    assert.throws(
      () => store.updateConfig({ enableSmartHome: true } as never),
      /chave de configura.*n.*o suportada/i
    )
    assert.equal(fs.existsSync(configPath), false)
  })

  test('migration drops obsolete keys while preserving public, license and consent state', () => {
    fs.writeFileSync(configPath, JSON.stringify({
      agentName: 'Jasper Comercial',
      enableScreenAwareness: false,
      enableSmartHome: true,
      webhookDefaultUrl: 'https://obsolete.invalid/hook',
      licenseStatus: 'active',
      licenseKey: 'enc:TE9DLVRFU1Q=',
      licenseInstallationId: 'installation-1',
      controlConsentAcceptedAt: '2026-10-23T10:00:00.000Z',
      controlConsentInstallationId: 'installation-1'
    }), 'utf8')

    const store = new ConfigStore(configPath)
    const loaded = store.initialize()

    assert.equal(loaded.agentName, 'Jasper Comercial')
    assert.equal(loaded.enableScreenAwareness, false)
    assert.equal(loaded.licenseStatus, 'active')
    assert.equal(loaded.controlConsentInstallationId, 'installation-1')

    const persisted = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    assert.equal(persisted.enableSmartHome, undefined)
    assert.equal(persisted.webhookDefaultUrl, undefined)
    assert.equal(persisted.licenseStatus, 'active')
    assert.equal(persisted.licenseInstallationId, 'installation-1')
    assert.equal(persisted.controlConsentAcceptedAt, '2026-10-23T10:00:00.000Z')
    assert.equal(persisted.controlConsentInstallationId, 'installation-1')
  })

  test('encryption failure aborts atomically without erasing the previous file', () => {
    const store = new ConfigStore(configPath)
    store.updateConfig({ agentName: 'Persistido' })
    const previousFile = fs.readFileSync(configPath, 'utf8')
    const originalAvailability = safeStorage.isEncryptionAvailable
    ;(safeStorage as any).isEncryptionAvailable = () => false

    try {
      assert.throws(
        () => store.updateInternalConfig({ licenseDeviceSecret: 'must-not-be-lost' }),
        /persistir a configura/i
      )
      assert.equal(fs.readFileSync(configPath, 'utf8'), previousFile)
      assert.equal(store.getConfig().licenseDeviceSecret, undefined)
    } finally {
      ;(safeStorage as any).isEncryptionAvailable = originalAvailability
    }
  })

  test('unavailable decryption never rewrites existing ciphertext during migration or unrelated updates', () => {
    const originalFile = JSON.stringify({
      agentName: 'Protegido',
      enableSmartHome: true,
      licenseDeviceSecret: `enc:${Buffer.from('existing-device-secret').toString('base64')}`
    }, null, 2)
    fs.writeFileSync(configPath, originalFile, 'utf8')
    const originalAvailability = safeStorage.isEncryptionAvailable
    ;(safeStorage as any).isEncryptionAvailable = () => false

    try {
      const store = new ConfigStore(configPath)
      store.initialize()
      assert.equal(fs.readFileSync(configPath, 'utf8'), originalFile)
      assert.throws(() => store.updateConfig({ agentName: 'Outro nome' }), /persistir a configura/i)
      assert.equal(fs.readFileSync(configPath, 'utf8'), originalFile)
    } finally {
      ;(safeStorage as any).isEncryptionAvailable = originalAvailability
    }
  })
})
