import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AI_PROVIDER_CATALOG,
  defaultModelForProvider,
  isAIProvider,
  isSupportedProviderModel,
  providerForModel
} from '../src/shared/ai/provider-catalog'

describe('AI provider catalog', () => {
  test('contains exactly the supported providers and models', () => {
    assert.deepEqual(Object.keys(AI_PROVIDER_CATALOG), ['gemini', 'groq', 'ollama'])
    assert.deepEqual(
      AI_PROVIDER_CATALOG.gemini.models.map(({ id }) => id),
      ['gemini/gemini-3.8-flash', 'gemini/gemini-3.6-flash', 'gemini/gemini-3.5-flash-lite', 'gemini/gemini-3.1-flash-lite']
    )
    assert.deepEqual(
      AI_PROVIDER_CATALOG.groq.models.map(({ id }) => id),
      ['groq/openai/gpt-oss-120b', 'groq/openai/gpt-oss-20b']
    )
    assert.deepEqual(
      AI_PROVIDER_CATALOG.ollama.models.map(({ id }) => id),
      ['ollama/qwen2.5:3b']
    )
  })

  test('requires credentials only for remote providers', () => {
    assert.equal(AI_PROVIDER_CATALOG.gemini.requiresApiKey, true)
    assert.equal(AI_PROVIDER_CATALOG.groq.requiresApiKey, true)
    assert.equal(AI_PROVIDER_CATALOG.ollama.requiresApiKey, false)
  })

  test('validates provider names and provider/model pairs', () => {
    assert.equal(isAIProvider('gemini'), true)
    assert.equal(isAIProvider('groq'), true)
    assert.equal(isAIProvider('ollama'), true)
    assert.equal(isAIProvider('openai'), false)
    assert.equal(isAIProvider(null), false)
    assert.equal(isSupportedProviderModel('gemini', 'gemini/gemini-3.8-flash'), true)
    assert.equal(isSupportedProviderModel('gemini', 'gemini/gemini-2.5-flash'), false)
    assert.equal(isSupportedProviderModel('groq', 'groq/openai/gpt-oss-120b'), true)
    assert.equal(isSupportedProviderModel('groq', 'groq/llama-3.3-70b-versatile'), false)
    assert.equal(isSupportedProviderModel('gemini', 'groq/openai/gpt-oss-120b'), false)
    assert.equal(isSupportedProviderModel('ollama', 'unknown'), false)
  })

  test('returns defaults and infers providers only for catalog models', () => {
    assert.equal(defaultModelForProvider('gemini'), 'gemini/gemini-3.8-flash')
    assert.equal(defaultModelForProvider('groq'), 'groq/openai/gpt-oss-120b')
    assert.equal(defaultModelForProvider('ollama'), 'ollama/qwen2.5:3b')
    assert.equal(providerForModel('ollama/qwen2.5:3b'), 'ollama')
    assert.equal(providerForModel('openai/gpt-5'), null)
    assert.throws(() => defaultModelForProvider('openai' as never), /provedor/i)
  })
})
