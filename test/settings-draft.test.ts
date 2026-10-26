import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { ConfigSummary } from '../src/shared/types/config'
import {
  createSettingsDraft,
  modelsForProvider,
  switchDraftProvider,
  classifySettingsChanges,
  buildSettingsUpdate,
  rollbackSettingsDraft
} from '../src/renderer/ui/settings-draft'

function sampleSummary(overrides: Partial<ConfigSummary> = {}): ConfigSummary {
  return {
    aiProvider: 'gemini',
    model: 'gemini/gemini-3.8-flash',
    voiceName: 'pt-BR-AntonioNeural',
    agentName: 'Jasper',
    checkUpdatesDaily: true,
    enableWakeWord: true,
    enableBloom: true,
    enableNeuralBg: false,
    enableEyeTracking: true,
    enableScreenAwareness: true,
    credentials: {
      gemini: { configured: true, masked: 'AIza...7890' },
      groq: { configured: false, masked: '' }
    },
    isConnected: true,
    ...overrides
  }
}

describe('SettingsDraft pure helpers', () => {
  test('modelsForProvider and switchDraftProvider enforce legal provider models', () => {
    const initial = createSettingsDraft(sampleSummary())
    assert.equal(initial.aiProvider, 'gemini')
    assert.equal(initial.model, 'gemini/gemini-3.8-flash')

    assert.deepEqual(
      modelsForProvider('groq').map((m) => m.id),
      ['groq/openai/gpt-oss-120b', 'groq/openai/gpt-oss-20b']
    )
    assert.deepEqual(
      modelsForProvider('ollama').map((m) => m.id),
      ['ollama/qwen2.5:3b']
    )

    const switchedGroq = switchDraftProvider(initial, 'groq')
    assert.equal(switchedGroq.aiProvider, 'groq')
    assert.equal(switchedGroq.model, 'groq/openai/gpt-oss-120b')

    const switchedOllama = switchDraftProvider(switchedGroq, 'ollama')
    assert.equal(switchedOllama.aiProvider, 'ollama')
    assert.equal(switchedOllama.model, 'ollama/qwen2.5:3b')
  })

  test('buildSettingsUpdate emits only changed fields and omits blank credential inputs', () => {
    const before = createSettingsDraft(sampleSummary())
    const afterVisualOnly = {
      ...before,
      enableBloom: false,
      enableNeuralBg: true
    }

    const updateVisual = buildSettingsUpdate(before, afterVisualOnly, {
      geminiApiKey: '   ',
      groqApiKey: ''
    })
    assert.deepEqual(updateVisual, {
      enableBloom: false,
      enableNeuralBg: true
    })
    assert.equal('geminiApiKey' in updateVisual, false)
    assert.equal('groqApiKey' in updateVisual, false)

    const updateWithGroqKey = buildSettingsUpdate(
      before,
      switchDraftProvider(before, 'groq'),
      { geminiApiKey: '', groqApiKey: '  gsk_new_key_12345  ' }
    )
    assert.deepEqual(updateWithGroqKey, {
      aiProvider: 'groq',
      model: 'groq/openai/gpt-oss-120b',
      groqApiKey: 'gsk_new_key_12345'
    })
  })

  test('classifySettingsChanges distinguishes visual-only updates from backend-sync updates', () => {
    const before = createSettingsDraft(sampleSummary())
    const visualAfter = { ...before, enableBloom: false, enableEyeTracking: false }
    const visualClassification = classifySettingsChanges(before, visualAfter, {})
    assert.equal(visualClassification.hasChanges, true)
    assert.equal(visualClassification.requiresBackendSync, false)

    const providerAfter = switchDraftProvider(before, 'ollama')
    const providerClassification = classifySettingsChanges(before, providerAfter, {})
    assert.equal(providerClassification.hasChanges, true)
    assert.equal(providerClassification.requiresBackendSync, true)

    const keyOnlyClassification = classifySettingsChanges(before, before, {
      geminiApiKey: 'AIzaSyUpdatedKey12345'
    })
    assert.equal(keyOnlyClassification.hasChanges, true)
    assert.equal(keyOnlyClassification.requiresBackendSync, true)
  })

  test('rollbackSettingsDraft restores the opening snapshot without mutating it', () => {
    const opening = createSettingsDraft(sampleSummary(), 'neutral')
    const mutated = {
      ...opening,
      agentName: 'TempName',
      enableBloom: false,
      enableNeuralBg: true,
      enableEyeTracking: false,
      avatarMood: 'surprised' as const
    }

    const restored = rollbackSettingsDraft(opening)
    assert.notEqual(mutated.agentName, restored.agentName)
    assert.deepEqual(restored, opening)
  })
})
