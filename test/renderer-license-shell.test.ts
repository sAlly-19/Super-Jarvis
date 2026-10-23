import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

describe('Renderer Clean Migration & License Shell (No WebSocket / Local Ports)', () => {
  const rendererDir = path.resolve(process.cwd(), 'src/renderer')
  const legacySocketPath = path.join(rendererDir, ['src', 'services', ['jasper', 'Socket.ts'].join('')].join('/'))
  const mainTsPath = path.join(rendererDir, 'main.ts')
  const chatDrawerPath = path.join(rendererDir, 'ui/chat-drawer.ts')

  test('source hygiene: legacy socket is deleted and zero WebSocket references remain in renderer', () => {
    assert.equal(
      fs.existsSync(legacySocketPath),
      false,
      'legacy socket must be completely removed'
    )

    const mainTs = fs.readFileSync(mainTsPath, 'utf-8')
    assert.doesNotMatch(mainTs, new RegExp(['jasper', 'Socket'].join(''), 'i'), 'main.ts must not reference legacy socket')
    assert.doesNotMatch(mainTs, /new WebSocket/i, 'main.ts must not instantiate WebSocket')
    assert.doesNotMatch(mainTs, /8765/, 'main.ts must not reference port 8765')
    assert.doesNotMatch(mainTs, /ws:\/\//i, 'main.ts must not reference ws:// protocol')

    const chatDrawer = fs.readFileSync(chatDrawerPath, 'utf-8')
    assert.doesNotMatch(chatDrawer, new RegExp(['jasper', 'Socket'].join(''), 'i'), 'chat-drawer.ts must not reference legacy socket')
    assert.doesNotMatch(chatDrawer, /new WebSocket/i, 'chat-drawer.ts must not instantiate WebSocket')
  })

  test('main.ts exports or implements applyLicenseSnapshot and mountAgentRuntime lifecycle', () => {
    const mainTs = fs.readFileSync(mainTsPath, 'utf-8')
    assert.ok(
      mainTs.includes('applyLicenseSnapshot') || mainTs.includes('mountAgentRuntime'),
      'main.ts must implement explicit license state snapshot application or runtime mount lifecycle'
    )
    assert.ok(
      mainTs.includes('window.electronAPI.onLicenseState'),
      'main.ts must listen for the canonical license state event from Main'
    )
    assert.equal(
      mainTs.includes('window.electronAPI.onLicenseRevoked'),
      false,
      'main.ts must not subscribe to a competing revocation event'
    )
  })
})
