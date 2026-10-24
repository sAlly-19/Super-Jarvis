import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { PythonBackendManager } from '../src/main/services/python-backend'
import type { JasperConfig } from '../src/shared/types/config'

function config(overrides: Partial<JasperConfig> = {}): JasperConfig {
  return {
    aiProvider: 'gemini',
    geminiApiKey: 'gemini-secret-value',
    groqApiKey: 'groq-secret-value',
    model: 'gemini/gemini-3.8-flash',
    voiceName: 'Charon',
    agentName: 'Jasper',
    checkUpdatesDaily: true,
    enableWakeWord: true,
    enableBloom: true,
    enableNeuralBg: true,
    enableEyeTracking: true,
    enableScreenAwareness: true,
    ...overrides
  }
}

function readyManager(): {
  manager: PythonBackendManager
  payloads: unknown[]
} {
  const manager = new PythonBackendManager()
  const payloads: unknown[] = []
  ;(manager as any).state = 'ready'
  manager.request = async (type: any, payload: unknown) => {
    assert.equal(type, 'config')
    payloads.push(payload)
    return { success: true } as any
  }
  return { manager, payloads }
}

describe('active provider sidecar configuration', () => {
  test('Gemini sends the provider and only the Gemini credential', async () => {
    const { manager, payloads } = readyManager()
    assert.equal(await manager.syncConfig(config()), true)
    assert.deepEqual(payloads, [{
      provider: 'gemini',
      model: 'gemini/gemini-3.8-flash',
      apiKey: 'gemini-secret-value',
      agent_name: 'Jasper',
      voice: 'Charon',
      vision: true
    }])
    assert.doesNotMatch(JSON.stringify(payloads), /groq-secret-value/)
  })

  test('Groq sends the provider and only the Groq credential', async () => {
    const { manager, payloads } = readyManager()
    assert.equal(await manager.syncConfig(config({
      aiProvider: 'groq',
      model: 'groq/openai/gpt-oss-120b'
    })), true)
    assert.deepEqual(payloads, [{
      provider: 'groq',
      model: 'groq/openai/gpt-oss-120b',
      apiKey: 'groq-secret-value',
      agent_name: 'Jasper',
      voice: 'Charon',
      vision: true
    }])
    assert.doesNotMatch(JSON.stringify(payloads), /gemini-secret-value/)
  })

  test('Ollama sends no credential', async () => {
    const { manager, payloads } = readyManager()
    assert.equal(await manager.syncConfig(config({
      aiProvider: 'ollama',
      model: 'ollama/qwen2.5:3b'
    })), true)
    assert.deepEqual(payloads, [{
      provider: 'ollama',
      model: 'ollama/qwen2.5:3b',
      apiKey: '',
      agent_name: 'Jasper',
      voice: 'Charon',
      vision: true
    }])
  })

  test('missing active remote credential returns false without sending a frame', async () => {
    const { manager, payloads } = readyManager()
    assert.equal(await manager.syncConfig(config({ geminiApiKey: '' })), false)
    assert.deepEqual(payloads, [])
  })
})
