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
})
