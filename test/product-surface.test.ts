import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { OperationalAccess } from '../src/main/services/operational-access'
import { ConfigStore } from '../src/main/config/config-store'
import { LicenseGate } from '../src/main/services/license-gate'

describe('Commercial Operational Access & Obsolete Surface Elimination', () => {
  const supportedPublicConfigKeys = [
    'aiProvider',
    'geminiApiKey',
    'groqApiKey',
    'voiceName',
    'model',
    'agentName',
    'checkUpdatesDaily',
    'enableWakeWord',
    'enableBloom',
    'enableNeuralBg',
    'enableEyeTracking',
    'enableScreenAwareness'
  ].sort()

  let tmpDir: string
  const hwid = 'HWID-TEST-OP-1111'

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-op-test-'))
  })

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test('requireAgentAccess rejects if license is locked', () => {
    const configPath = path.join(tmpDir, 'config.json')
    const configStore = new ConfigStore(configPath)
    configStore.updateInternalConfig({
      controlConsentAcceptedAt: new Date().toISOString(),
      controlConsentInstallationId: hwid
    })

    const gate = {
      getSnapshot: () => ({ state: 'locked' as const }),
      requireUnlocked: () => {
        throw new Error('Licença ativa obrigatória para interagir com o agente.')
      }
    } as any

    const opAccess = new OperationalAccess(gate, configStore, () => hwid)

    assert.throws(
      () => opAccess.requireAgentAccess(),
      /Licen.*obrigat/i
    )
  })

  test('requireAgentAccess rejects if commercial consent is not accepted', () => {
    const configPath = path.join(tmpDir, 'config.json')
    const configStore = new ConfigStore(configPath)

    // Mock unlocked gate
    const gate = {
      getSnapshot: () => ({ state: 'unlocked' as const }),
      requireUnlocked: () => {}
    } as any

    const opAccess = new OperationalAccess(gate, configStore, () => hwid)
    assert.equal(opAccess.isConsentAccepted(), false)

    assert.throws(
      () => opAccess.requireAgentAccess(),
      /consent.*required/i
    )
  })

  test('requireAgentAccess rejects if consent belongs to a different installation ID', () => {
    const configPath = path.join(tmpDir, 'config.json')
    const configStore = new ConfigStore(configPath)
    configStore.updateInternalConfig({
      controlConsentAcceptedAt: new Date().toISOString(),
      controlConsentInstallationId: 'HWID-FOREIGN-9999'
    })

    const gate = {
      getSnapshot: () => ({ state: 'unlocked' as const }),
      requireUnlocked: () => {}
    } as any

    const opAccess = new OperationalAccess(gate, configStore, () => hwid)
    assert.equal(opAccess.isConsentAccepted(), false)

    assert.throws(
      () => opAccess.requireAgentAccess(),
      /consent.*required/i
    )
  })

  test('acceptConsent records current installation ID and unlocks operational access', () => {
    const configPath = path.join(tmpDir, 'config.json')
    const configStore = new ConfigStore(configPath)

    const gate = {
      getSnapshot: () => ({ state: 'unlocked' as const }),
      requireUnlocked: () => {}
    } as any

    const opAccess = new OperationalAccess(gate, configStore, () => hwid)
    assert.equal(opAccess.isConsentAccepted(), false)

    opAccess.acceptConsent()
    assert.equal(opAccess.isConsentAccepted(), true)
    assert.doesNotThrow(() => opAccess.requireAgentAccess())

    const cfg = configStore.getConfig()
    assert.equal(cfg.controlConsentInstallationId, hwid)
    assert.ok(cfg.controlConsentAcceptedAt)
  })

  test('obsolete ConfirmationMode and fake module card files are removed from codebase', () => {
    const root = process.cwd()
    assert.ok(
      !fs.existsSync(path.join(root, 'src/renderer/ui/module-info-modal.ts')),
      'module-info-modal.ts should be deleted'
    )

    const configSrc = fs.readFileSync(path.join(root, 'src/shared/types/config.ts'), 'utf-8')
    assert.ok(!configSrc.includes(['Confirmation', 'Mode'].join('')), 'confirmation mode type should be deleted')
    assert.ok(!configSrc.includes(['confirmation', 'Mode'].join('')), 'confirmation mode property should be deleted')

    const htmlSrc = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf-8')
    assert.ok(!htmlSrc.includes('name="confirmation-mode"'), 'Confirmation mode radios must be removed')
    assert.ok(!htmlSrc.includes('btn-module-info'), 'Fake module info buttons must be removed')
  })

  test('public configuration exposes exactly the implemented commercial settings', async () => {
    const shared = await import('../src/shared/types/config')
    assert.deepEqual([...shared.PUBLIC_CONFIG_KEYS].sort(), supportedPublicConfigKeys)
  })

  test('customer-facing sources contain no unsupported commercial feature surface', () => {
    const root = process.cwd()
    const sourceFiles = [
      'src/shared/types/config.ts',
      'src/preload/index.ts',
      'src/preload/index.d.ts',
      'src/renderer/index.html',
      'src/renderer/ui/dom.ts',
      'src/renderer/ui/settings-modal.ts'
    ]
    const forbidden = [
      'enableSystemTools',
      'enableMediaTools',
      'enableSmartHome',
      'enableWebhooks',
      'enableSubagents',
      'enableSemanticMemory',
      'confirmation-mode',
      'check-system-tools',
      'check-media-tools',
      'testSmartHomeConnection',
      'testWebhook',
      'onAutonomyNotification'
    ]

    for (const relativePath of sourceFiles) {
      const source = fs.readFileSync(path.join(root, relativePath), 'utf8')
      for (const token of forbidden) {
        assert.ok(!source.includes(token), `${relativePath} must not expose ${token}`)
      }
    }
  })

  test('activation UI states the signed 72-hour license validation window', () => {
    const html = fs.readFileSync(path.join(process.cwd(), 'src/renderer/index.html'), 'utf8')
    assert.match(html, /validação contínua a cada 72 horas/i)
    assert.doesNotMatch(html, /validação contínua a cada 24 horas/i)
  })
})
