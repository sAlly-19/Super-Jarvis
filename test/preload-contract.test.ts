import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

describe('preload API contract', () => {
  test('exposes only the canonical agent API and no compatibility aliases or stubs', () => {
    const root = process.cwd()
    const sources = [
      fs.readFileSync(path.join(root, 'src/preload/index.ts'), 'utf8'),
      fs.readFileSync(path.join(root, 'src/preload/index.d.ts'), 'utf8')
    ]
    const obsoleteMembers = [
      'sendAudioChunk',
      'sendTextMessage',
      'onAudioChunk',
      'onTextChunk',
      'onStatusChange',
      'connectGemini',
      'disconnectGemini',
      'testSmartHomeConnection',
      'testWebhook',
      'onAutonomyNotification'
    ]

    for (const source of sources) {
      for (const member of obsoleteMembers) {
        assert.ok(!source.includes(member), `preload must not expose ${member}`)
      }
    }
  })

  test('exposes typed credential removal, agent error listener, and save results without returning secrets', () => {
    const root = process.cwd()
    const implementation = fs.readFileSync(path.join(root, 'src/preload/index.ts'), 'utf8')
    const declaration = fs.readFileSync(path.join(root, 'src/preload/index.d.ts'), 'utf8')

    assert.match(implementation, /removeProviderCredential/)
    assert.match(implementation, /CONFIG_REMOVE_CREDENTIAL/)
    assert.match(implementation, /onAgentError/)
    assert.match(implementation, /AGENT_ERROR/)
    assert.match(declaration, /removeProviderCredential:\s*\(provider:\s*RemoteAIProvider\)\s*=>\s*Promise<ConfigSaveResult>/)
    assert.match(declaration, /onAgentError:\s*\(callback:\s*\(error:\s*\{\s*message:\s*string\s*\}\)\s*=>\s*void\)\s*=>\s*\(\)\s*=>\s*void/)
    assert.match(declaration, /saveConfig:\s*\(config:\s*UpdateConfigPayload\)\s*=>\s*Promise<ConfigSaveResult>/)
    assert.doesNotMatch(declaration, /Promise<[^>]*(geminiApiKey|groqApiKey|apiKey)/)
  })
})
