import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

describe('Truthful Jasper Settings Dashboard Surface', () => {
  const root = process.cwd()
  const htmlPath = path.join(root, 'src/renderer/index.html')
  const domTsPath = path.join(root, 'src/renderer/ui/dom.ts')
  const modalCssPath = path.join(root, 'src/renderer/styles/modal.css')
  const settingsModalPath = path.join(root, 'src/renderer/ui/settings-modal.ts')
  const licenseModalPath = path.join(root, 'src/renderer/ui/license-modal.ts')

  test('renders a single sidebar navigation for the five truthful sections without duplicate top tabs', () => {
    const html = fs.readFileSync(htmlPath, 'utf8')

    assert.doesNotMatch(html, /class="[^"]*settings-tabs-nav[^"]*"/)
    assert.doesNotMatch(html, /class="[^"]*top-tab-btn[^"]*"/)

    for (const section of ['general', 'ai-voice', 'system', 'memory', 'license']) {
      const navMatches = html.match(new RegExp(`data-tab="${section}"`, 'g')) || []
      assert.equal(navMatches.length, 1, `Expected exactly one navigation control for ${section}`)
      assert.match(html, new RegExp(`id="tab-${section}"`), `Expected pane #tab-${section}`)
    }
  })

  test('presents Jasper product branding and dynamic section header controls', () => {
    const html = fs.readFileSync(htmlPath, 'utf8')

    assert.doesNotMatch(html, /<span class="sidebar-brand-title">\s*GEMINI\s*<\/span>/i)
    assert.match(html, /<span class="sidebar-brand-title">\s*JASPER\s*<\/span>/)
    assert.match(html, /id="settings-section-title"/)
    assert.match(html, /id="settings-section-description"/)
    assert.match(html, /id="settings-connection-status"/)
  })

  test('exposes provider selector, separate Gemini/Groq credential cards, Ollama local card, and no legacy single key', () => {
    const html = fs.readFileSync(htmlPath, 'utf8')
    const domTs = fs.readFileSync(domTsPath, 'utf8')

    for (const requiredId of [
      'select-ai-provider',
      'input-gemini-key',
      'input-groq-key',
      'gemini-credential-status',
      'groq-credential-status',
      'ollama-provider-status',
      'select-model'
    ]) {
      assert.match(html, new RegExp(`id="${requiredId}"`), `Missing #${requiredId} in index.html`)
    }

    assert.match(html, /id="input-gemini-key"[^>]*type="password"[^>]*autocomplete="off"|type="password"[^>]*id="input-gemini-key"[^>]*autocomplete="off"/)
    assert.match(html, /id="input-groq-key"[^>]*type="password"[^>]*autocomplete="off"|type="password"[^>]*id="input-groq-key"[^>]*autocomplete="off"/)
    assert.match(html, /id="gemini-credential-status"[^>]*aria-live="polite"/)
    assert.match(html, /id="groq-credential-status"[^>]*aria-live="polite"/)
    assert.match(html, /id="ollama-provider-status"[^>]*aria-live="polite"/)

    assert.doesNotMatch(html, /id="input-api-key"/)
    assert.doesNotMatch(html, /id="gemini-key-masked-display"/)
    assert.doesNotMatch(domTs, /inputApiKey/)
    assert.doesNotMatch(domTs, /geminiKeyMaskedDisplay/)
  })

  test('lists real implemented system capabilities, operational consent status, and 72-hour license lease copy', () => {
    const html = fs.readFileSync(htmlPath, 'utf8')

    assert.match(html, /id="operational-consent-status"/)
    assert.match(html, /PowerShell/i)
    assert.match(html, /teclado|mouse|GUI/i)
    assert.match(html, /volume/i)
    assert.match(html, /telemetria/i)
    assert.match(html, /captura de tela/i)
    assert.match(html, /72 horas/i)
  })

  test('provides provider-aware post-license onboarding controls and responsive provider card styles', () => {
    const html = fs.readFileSync(htmlPath, 'utf8')
    const css = fs.readFileSync(modalCssPath, 'utf8')

    for (const onboardingId of [
      'select-onboarding-provider',
      'input-onboarding-provider-key',
      'onboarding-provider-key-group',
      'onboarding-provider-feedback'
    ]) {
      assert.match(html, new RegExp(`id="${onboardingId}"`), `Missing #${onboardingId} in index.html`)
    }

    assert.match(css, /\.provider-credentials-grid/)
    assert.match(css, /\.provider-credential-card/)
  })

  test('settings-modal and license-modal share rollbackAndClose, clear transient credential inputs, and use removeProviderCredential', () => {
    const settingsModal = fs.readFileSync(settingsModalPath, 'utf8')
    const licenseModal = fs.readFileSync(licenseModalPath, 'utf8')

    assert.match(settingsModal, /rollbackAndClose/)
    assert.match(settingsModal, /btnCloseSettings\.addEventListener\('click',\s*rollbackAndClose\)/)
    assert.match(settingsModal, /btnCancelSettings\?\.addEventListener\('click',\s*rollbackAndClose\)/)
    assert.match(settingsModal, /clearCredentialInputs\(\)/)
    assert.match(settingsModal, /removeProviderCredential/)
    assert.doesNotMatch(settingsModal, /hasFullKey/)
    assert.doesNotMatch(licenseModal, /hasFullKey/)
  })
})
