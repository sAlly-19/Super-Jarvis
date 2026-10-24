import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createSmokeLicenseServer } from '../scripts/fixtures/license-server.mjs'

describe('Packaged Smoke Test Contract & Ephemeral Fixture Hygiene (Task 9)', () => {
  const root = process.cwd()
  const smokeScriptPath = path.join(root, 'scripts', 'smoke-packaged.ps1')
  const fixtureServerPath = path.join(root, 'scripts', 'fixtures', 'license-server.mjs')
  const fixtureKeypairPath = path.join(root, 'scripts', 'fixtures', 'smoke-license-keypair.mjs')

  test('scripts/fixtures contains loopback license server and smoke keypair fixtures', async () => {
    assert.equal(fs.existsSync(fixtureServerPath), true, 'scripts/fixtures/license-server.mjs must exist')
    assert.equal(fs.existsSync(fixtureKeypairPath), true, 'scripts/fixtures/smoke-license-keypair.mjs must exist')

    const fixtureServer = await createSmokeLicenseServer()
    try {
      assert.ok(fixtureServer.url.startsWith('http://127.0.0.1:'), 'fixture server must bind to 127.0.0.1')
      assert.equal(fixtureServer.keypair.keyId, 'smoke-ephemeral-2026')
      assert.equal(fixtureServer.keypair.publicKey.kty, 'OKP')
      assert.equal(fixtureServer.keypair.publicKey.crv, 'Ed25519')
    } finally {
      await fixtureServer.close()
    }
  })

  test('smoke-packaged.ps1 enforces clean machine constraints: no port 8765, no global python, and tree cleanup', () => {
    assert.equal(fs.existsSync(smokeScriptPath), true, 'scripts/smoke-packaged.ps1 must exist')
    const content = fs.readFileSync(smokeScriptPath, 'utf-8')

    assert.match(content, /8765/, 'must check port 8765')
    assert.match(content, /PATH/, 'must sanitize or verify PATH')
    assert.match(content, /Stop-Process|taskkill/i, 'must ensure cleanup of child processes')
  })

  test('tracked source tree never commits ephemeral private key material', () => {
    const srcDir = path.join(root, 'src')
    const entries = fs.readdirSync(srcDir, { recursive: true, withFileTypes: true })
    for (const e of entries) {
      if (e.isFile() && (e.name.endsWith('.ts') || e.name.endsWith('.js') || e.name.endsWith('.json'))) {
        const filePath = path.join(e.parentPath || srcDir, e.name)
        const text = fs.readFileSync(filePath, 'utf-8')
        assert.doesNotMatch(text, /-----BEGIN (?:PRIVATE|EC PRIVATE|RSA PRIVATE) KEY-----/, `Private key leaked in ${filePath}`)
      }
    }
  })
})

