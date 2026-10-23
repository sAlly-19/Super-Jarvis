import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

describe('Renderer Clean Migration & License Shell (No WebSocket / Local Ports)', () => {
  const rendererDir = path.resolve(process.cwd(), 'src/renderer')
  const jasperSocketPath = path.join(rendererDir, 'src/services/jasperSocket.ts')
  const mainTsPath = path.join(rendererDir, 'main.ts')
  const chatDrawerPath = path.join(rendererDir, 'ui/chat-drawer.ts')

  test('source hygiene: jasperSocket.ts is deleted and zero WebSocket references remain in renderer', () => {
    assert.equal(
      fs.existsSync(jasperSocketPath),
      false,
      'src/renderer/src/services/jasperSocket.ts must be completely removed'
    )

    const mainTs = fs.readFileSync(mainTsPath, 'utf-8')
    assert.doesNotMatch(mainTs, /jasperSocket/i, 'main.ts must not reference jasperSocket')
    assert.doesNotMatch(mainTs, /new WebSocket/i, 'main.ts must not instantiate WebSocket')
    assert.doesNotMatch(mainTs, /8765/, 'main.ts must not reference port 8765')
    assert.doesNotMatch(mainTs, /ws:\/\//i, 'main.ts must not reference ws:// protocol')

    const chatDrawer = fs.readFileSync(chatDrawerPath, 'utf-8')
    assert.doesNotMatch(chatDrawer, /jasperSocket/i, 'chat-drawer.ts must not reference jasperSocket')
    assert.doesNotMatch(chatDrawer, /new WebSocket/i, 'chat-drawer.ts must not instantiate WebSocket')
  })

  test('main.ts exports or implements applyLicenseSnapshot and mountAgentRuntime lifecycle', () => {
    const mainTs = fs.readFileSync(mainTsPath, 'utf-8')
    assert.ok(
      mainTs.includes('applyLicenseSnapshot') || mainTs.includes('mountAgentRuntime'),
      'main.ts must implement explicit license state snapshot application or runtime mount lifecycle'
    )
    assert.ok(
      mainTs.includes('window.electronAPI.onLicenseState') || mainTs.includes('window.electronAPI.onLicenseRevoked'),
      'main.ts must listen for license state changes from Main'
    )
  })
})
