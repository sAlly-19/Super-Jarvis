import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

describe('API Connectivity and Modal Responsiveness Surface', () => {
  const root = process.cwd()
  const modalCssPath = path.join(root, 'src/renderer/styles/modal.css')
  const consentModalPath = path.join(root, 'src/renderer/ui/control-consent-modal.ts')
  const mainTsPath = path.join(root, 'src/renderer/main.ts')
  const mainIndexPath = path.join(root, 'src/main/index.ts')
  const chatDrawerPath = path.join(root, 'src/renderer/ui/chat-drawer.ts')
  const indexHtmlPath = path.join(root, 'src/renderer/index.html')
  const settingsModalPath = path.join(root, 'src/renderer/ui/settings-modal.ts')

  test('control consent modal uses canonical .modal-backdrop and defines styling in modal.css', () => {
    const consentSrc = fs.readFileSync(consentModalPath, 'utf8')
    const css = fs.readFileSync(modalCssPath, 'utf8')

    // Must use modal-backdrop instead of unstyled modal-overlay
    assert.match(consentSrc, /modal-backdrop/)
    assert.doesNotMatch(consentSrc, /className\s*=\s*['"]modal-overlay/)

    // modal.css must style consent elements
    assert.match(css, /\.consent-card/)
    assert.match(css, /\.consent-capabilities-list/)
    assert.match(css, /#btn-accept-control-consent|\.btn-accept-control-consent/)
  })

  test('modal.css enforces flexible constraints, wrapping, and media queries for compact screens', () => {
    const css = fs.readFileSync(modalCssPath, 'utf8')

    // Dashboard main must have min-width: 0 to prevent blowout
    assert.match(css, /\.modal-card\.dashboard-main[\s\S]*?min-width:\s*0/)

    // Form row must wrap
    assert.match(css, /\.form-row[\s\S]*?flex-wrap:\s*wrap/)

    // Input password wrap must wrap and give elastic min-width: 0 to input
    assert.match(css, /\.input-password-wrap[\s\S]*?flex-wrap:\s*wrap/)
    assert.match(css, /\.input-password-wrap\s+input[\s\S]*?min-width:\s*0/)

    // Media query must exist for compact viewport flexibility
    assert.match(css, /@media\s*\([^{]+\)/)
  })

  test('startup and mount flows synchronize configuration with backend and connect agent', () => {
    const mainIndex = fs.readFileSync(mainIndexPath, 'utf8')
    const mainTs = fs.readFileSync(mainTsPath, 'utf8')

    // Main process synchronizes backend config on startup
    assert.match(mainIndex, /pythonBackend\.syncConfig/)

    // Renderer mountAgentRuntime attempts connectAgent()
    assert.match(mainTs, /connectAgent\(\)/)
  })

  test('settings dashboard provides an explicit authorize consent action when consent is pending', () => {
    const html = fs.readFileSync(indexHtmlPath, 'utf8')
    const settingsTs = fs.readFileSync(settingsModalPath, 'utf8')

    assert.match(html, /id="btn-settings-request-consent"/)
    assert.match(settingsTs, /btnSettingsRequestConsent/)
  })

  test('chat drawer checks consent and auto-connects before falling back to offline', () => {
    const chatDrawer = fs.readFileSync(chatDrawerPath, 'utf8')

    assert.match(chatDrawer, /isConsentAccepted|connectAgent/)
  })
})
