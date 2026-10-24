export type AIProvider = 'gemini' | 'groq' | 'ollama'
export type RemoteAIProvider = Exclude<AIProvider, 'ollama'>

export interface AIModelDefinition {
  readonly id: string
  readonly label: string
}

export interface AIProviderDefinition {
  readonly id: AIProvider
  readonly label: string
  readonly requiresApiKey: boolean
  readonly models: readonly AIModelDefinition[]
}

export const AI_PROVIDER_CATALOG: Readonly<Record<AIProvider, AIProviderDefinition>> = {
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    requiresApiKey: true,
    models: [{ id: 'gemini/gemini-3.8-flash', label: 'Gemini 3.8 Flash' }]
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    requiresApiKey: true,
    models: [{ id: 'groq/openai/gpt-oss-120b', label: 'GPT-OSS 120B' }]
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama Local',
    requiresApiKey: false,
    models: [{ id: 'ollama/qwen2.5:3b', label: 'Qwen 2.5 3B' }]
  }
}

export function isAIProvider(value: unknown): value is AIProvider {
  return typeof value === 'string' && Object.hasOwn(AI_PROVIDER_CATALOG, value)
}

export function isSupportedProviderModel(provider: AIProvider, model: string): boolean {
  if (!isAIProvider(provider)) return false
  return AI_PROVIDER_CATALOG[provider].models.some(({ id }) => id === model)
}

export function defaultModelForProvider(provider: AIProvider): string {
  if (!isAIProvider(provider)) {
    throw new Error('Provedor de IA não suportado.')
  }
  return AI_PROVIDER_CATALOG[provider].models[0].id
}

export function providerForModel(model: string): AIProvider | null {
  for (const provider of Object.keys(AI_PROVIDER_CATALOG) as AIProvider[]) {
    if (isSupportedProviderModel(provider, model)) return provider
  }
  return null
}
