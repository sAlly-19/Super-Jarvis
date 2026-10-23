import { afterEach, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { safeStorage } from 'electron'
import {
  ConfigStore,
  resolveActiveAIConfig
} from '../src/main/config/config-store'

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

  test('persists Gemini and Groq credentials independently and exposes only masked summaries', () => {
    const store = new ConfigStore(configPath)
    store.updateConfig({
      aiProvider: 'gemini',
      model: 'gemini/gemini-2.5-flash',
      geminiApiKey: 'google-secret-1234',
      groqApiKey: 'gsk_groq-secret-5678'
    })

    const persisted = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    assert.match(persisted.geminiApiKey, /^enc:/)
    assert.match(persisted.groqApiKey, /^enc:/)
    assert.doesNotMatch(fs.readFileSync(configPath, 'utf8'), /google-secret-1234|gsk_groq-secret-5678/)

    const summary = store.getConfigSummary(false)
    assert.deepEqual(summary.credentials, {
      gemini: { configured: true, masked: '•••1234' },
      groq: { configured: true, masked: '•••5678' }
    })
    assert.equal('apiKey' in summary, false)
    assert.equal('geminiApiKey' in summary, false)
    assert.equal('groqApiKey' in summary, false)
    assert.equal('hasFullKey' in summary, false)

    store.updateConfig({ geminiApiKey: 'google-replacement-9999', groqApiKey: '' })
    const updated = store.getConfig()
    assert.equal(updated.geminiApiKey, 'google-replacement-9999')
    assert.equal(updated.groqApiKey, 'gsk_groq-secret-5678')
  })

  test('derives only the active provider credential and reports missing credentials', () => {
    const store = new ConfigStore(configPath)
    store.updateConfig({
      geminiApiKey: 'gemini-active',
      groqApiKey: 'groq-inactive'
    })

    assert.deepEqual(resolveActiveAIConfig(store.getConfig()), {
      provider: 'gemini',
      model: 'gemini/gemini-2.5-flash',
      apiKey: 'gemini-active',
      ready: true
    })

    const groq = store.updateConfig({ model: 'groq/llama-3.3-70b-versatile' })
    assert.deepEqual(resolveActiveAIConfig(groq), {
      provider: 'groq',
      model: 'groq/llama-3.3-70b-versatile',
      apiKey: 'groq-inactive',
      ready: true
    })

    store.removeProviderCredential('groq')
    const missing = resolveActiveAIConfig(store.getConfig())
    assert.equal(missing.ready, false)
    assert.equal(missing.apiKey, '')
    assert.match(missing.error || '', /credencial.*Groq/i)

    const local = store.updateConfig({ aiProvider: 'ollama' })
    assert.deepEqual(resolveActiveAIConfig(local), {
      provider: 'ollama',
      model: 'ollama/qwen2.5:3b',
      apiKey: '',
      ready: true
    })
  })

  test('rejects unsupported providers and mismatched provider/model pairs atomically', () => {
    const store = new ConfigStore(configPath)
    store.updateConfig({ agentName: 'Antes' })
    const before = fs.readFileSync(configPath, 'utf8')

    assert.throws(
      () => store.updateConfig({ aiProvider: 'openai' } as never),
      /provedor.*n.*o suportado/i
    )
    assert.throws(
      () => store.updateConfig({
        aiProvider: 'gemini',
        model: 'groq/llama-3.3-70b-versatile'
      }),
      /modelo.*provedor/i
    )
    assert.throws(
      () => store.updateConfig({ model: 'openai/gpt-5' }),
      /modelo.*n.*o suportado/i
    )

    assert.equal(fs.readFileSync(configPath, 'utf8'), before)
    assert.equal(store.getConfig().agentName, 'Antes')
  })

  test('migrates legacy keys by prefix or selected model and is idempotent', () => {
    const cases = [
      {
        name: 'Gemini',
        key: 'legacy-google-key',
        model: 'gemini/gemini-2.5-flash',
        provider: 'gemini',
        destination: 'geminiApiKey'
      },
      {
        name: 'Groq prefix',
        key: 'gsk_legacy-groq-key',
        model: 'gemini/gemini-2.5-flash',
        provider: 'gemini',
        destination: 'groqApiKey'
      },
      {
        name: 'Groq model',
        key: 'legacy-without-prefix',
        model: 'groq/llama-3.3-70b-versatile',
        provider: 'groq',
        destination: 'groqApiKey'
      },
      {
        name: 'Ollama selection preserves key as Gemini',
        key: 'legacy-kept-for-remote-use',
        model: 'ollama/qwen2.5:3b',
        provider: 'ollama',
        destination: 'geminiApiKey'
      }
    ] as const

    for (const migration of cases) {
      const migrationPath = path.join(tempDir, `${migration.name.replace(/\s+/g, '-')}.json`)
      fs.writeFileSync(migrationPath, JSON.stringify({
        apiKey: `enc:${Buffer.from(migration.key).toString('base64')}`,
        model: migration.model,
        agentName: 'Jasper legado'
      }, null, 2), 'utf8')

      const firstStore = new ConfigStore(migrationPath)
      const first = firstStore.initialize()
      assert.equal(first.aiProvider, migration.provider, migration.name)
      assert.equal(first[migration.destination], migration.key, migration.name)

      const migratedFile = fs.readFileSync(migrationPath, 'utf8')
      const migratedJson = JSON.parse(migratedFile)
      assert.equal(migratedJson.apiKey, undefined, migration.name)
      assert.match(migratedJson[migration.destination], /^enc:/, migration.name)

      const secondStore = new ConfigStore(migrationPath)
      secondStore.initialize()
      assert.equal(fs.readFileSync(migrationPath, 'utf8'), migratedFile, migration.name)
    }
  })

  test('an undecryptable legacy key leaves the original file byte-for-byte unchanged', () => {
    const originalFile = JSON.stringify({
      apiKey: 'enc:not-decryptable-here',
      model: 'groq/llama-3.3-70b-versatile',
      enableSmartHome: true
    }, null, 2)
    fs.writeFileSync(configPath, originalFile, 'utf8')
    const originalAvailability = safeStorage.isEncryptionAvailable
    ;(safeStorage as any).isEncryptionAvailable = () => false

    try {
      const store = new ConfigStore(configPath)
      store.initialize()
      assert.equal(fs.readFileSync(configPath, 'utf8'), originalFile)
    } finally {
      ;(safeStorage as any).isEncryptionAvailable = originalAvailability
    }
  })

  test('infers environment provider from an allow-listed JASPER_MODEL', () => {
    const previousModel = process.env.JASPER_MODEL
    const previousGeminiKey = process.env.GEMINI_API_KEY
    const previousGroqKey = process.env.GROQ_API_KEY
    process.env.JASPER_MODEL = 'groq/llama-3.3-70b-versatile'
    process.env.GEMINI_API_KEY = 'gemini-env'
    process.env.GROQ_API_KEY = 'groq-env'

    try {
      const config = new ConfigStore(configPath).getConfig()
      assert.equal(config.aiProvider, 'groq')
      assert.equal(config.model, 'groq/llama-3.3-70b-versatile')
      assert.equal(config.geminiApiKey, 'gemini-env')
      assert.equal(config.groqApiKey, 'groq-env')
    } finally {
      if (previousModel === undefined) delete process.env.JASPER_MODEL
      else process.env.JASPER_MODEL = previousModel
      if (previousGeminiKey === undefined) delete process.env.GEMINI_API_KEY
      else process.env.GEMINI_API_KEY = previousGeminiKey
      if (previousGroqKey === undefined) delete process.env.GROQ_API_KEY
      else process.env.GROQ_API_KEY = previousGroqKey
    }
  })
})
