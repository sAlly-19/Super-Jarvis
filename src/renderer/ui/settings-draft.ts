import {
  AI_PROVIDER_CATALOG,
  defaultModelForProvider,
  isAIProvider,
  isSupportedProviderModel,
  type AIModelDefinition,
  type AIProvider,
  type ConfigSummary,
  type UpdateConfigPayload
} from '@shared'
import type { MoodType } from '../scene/avatar'

export interface SettingsDraft {
  aiProvider: AIProvider
  model: string
  voiceName: string
  agentName: string
  checkUpdatesDaily: boolean
  enableWakeWord: boolean
  enableBloom: boolean
  enableNeuralBg: boolean
  enableEyeTracking: boolean
  enableScreenAwareness: boolean
  avatarMood: MoodType
}

export interface TypedCredentials {
  geminiApiKey?: string
  groqApiKey?: string
}

export interface SettingsChangeClassification {
  hasChanges: boolean
  requiresBackendSync: boolean
  requiresWakeWordReinit: boolean
  changedKeys: string[]
}

const BACKEND_SYNC_DRAFT_KEYS: ReadonlyArray<keyof SettingsDraft> = [
  'aiProvider',
  'model',
  'agentName',
  'voiceName',
  'enableScreenAwareness'
]

const PERSISTED_DRAFT_KEYS: ReadonlyArray<Exclude<keyof SettingsDraft, 'avatarMood'>> = [
  'aiProvider',
  'model',
  'voiceName',
  'agentName',
  'checkUpdatesDaily',
  'enableWakeWord',
  'enableBloom',
  'enableNeuralBg',
  'enableEyeTracking',
  'enableScreenAwareness'
]

export function modelsForProvider(provider: AIProvider): readonly AIModelDefinition[] {
  const safeProvider: AIProvider = isAIProvider(provider) ? provider : 'gemini'
  return AI_PROVIDER_CATALOG[safeProvider].models
}

export function createSettingsDraft(
  summary: ConfigSummary,
  avatarMood: MoodType = 'neutral'
): SettingsDraft {
  const aiProvider: AIProvider = isAIProvider(summary.aiProvider) ? summary.aiProvider : 'gemini'
  const model = isSupportedProviderModel(aiProvider, summary.model)
    ? summary.model
    : defaultModelForProvider(aiProvider)

  return {
    aiProvider,
    model,
    voiceName: summary.voiceName || 'pt-BR-AntonioNeural',
    agentName: (summary.agentName || 'Jasper').trim() || 'Jasper',
    checkUpdatesDaily: summary.checkUpdatesDaily !== false,
    enableWakeWord: summary.enableWakeWord !== false,
    enableBloom: summary.enableBloom !== false,
    enableNeuralBg: Boolean(summary.enableNeuralBg),
    enableEyeTracking: summary.enableEyeTracking !== false,
    enableScreenAwareness: summary.enableScreenAwareness !== false,
    avatarMood
  }
}

export function switchDraftProvider(draft: SettingsDraft, nextProvider: AIProvider): SettingsDraft {
  const safeProvider: AIProvider = isAIProvider(nextProvider) ? nextProvider : 'gemini'
  const nextModel = isSupportedProviderModel(safeProvider, draft.model)
    ? draft.model
    : defaultModelForProvider(safeProvider)

  return {
    ...draft,
    aiProvider: safeProvider,
    model: nextModel
  }
}

export function buildSettingsUpdate(
  before: SettingsDraft,
  after: SettingsDraft,
  typedCredentials: TypedCredentials = {}
): UpdateConfigPayload {
  const update: UpdateConfigPayload = {}

  for (const key of PERSISTED_DRAFT_KEYS) {
    if (before[key] !== after[key]) {
      ;(update as Record<string, unknown>)[key] = after[key]
    }
  }

  const geminiKey = (typedCredentials.geminiApiKey || '').trim()
  if (geminiKey) {
    update.geminiApiKey = geminiKey
  }

  const groqKey = (typedCredentials.groqApiKey || '').trim()
  if (groqKey) {
    update.groqApiKey = groqKey
  }

  return update
}

export function classifySettingsChanges(
  before: SettingsDraft,
  after: SettingsDraft,
  typedCredentials: TypedCredentials = {}
): SettingsChangeClassification {
  const update = buildSettingsUpdate(before, after, typedCredentials)
  const changedKeys = Object.keys(update)
  const requiresBackendSync = changedKeys.some(
    (key) =>
      key === 'geminiApiKey' ||
      key === 'groqApiKey' ||
      BACKEND_SYNC_DRAFT_KEYS.includes(key as keyof SettingsDraft)
  )

  return {
    hasChanges: changedKeys.length > 0,
    requiresBackendSync,
    requiresWakeWordReinit: before.enableWakeWord !== after.enableWakeWord,
    changedKeys
  }
}

export function rollbackSettingsDraft(openingSnapshot: SettingsDraft): SettingsDraft {
  return { ...openingSnapshot }
}
