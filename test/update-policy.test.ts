import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { updateManager, assertValidUpdateFeedUrl } from '../src/main/services/update-manager'

describe('Commercial Update Policy & Authenticode Verification (Task 3)', () => {
  const root = process.cwd()

  test('security-broker.ts is permanently deleted', () => {
    const brokerPath = path.join(root, 'src', 'main', 'services', 'security-broker.ts')
    assert.equal(fs.existsSync(brokerPath), false, 'security-broker.ts must be deleted')
  })

  test('assertValidUpdateFeedUrl accepts valid HTTPS official release feeds and rejects HTTP or third-party feeds', () => {
    assert.doesNotThrow(() => {
      assertValidUpdateFeedUrl('https://github.com/sAlly-19/jasper-avatar-releases/releases/latest/download')
    })

    assert.throws(() => {
      assertValidUpdateFeedUrl('http://github.com/sAlly-19/jasper-avatar-releases/releases/latest/download')
    }, /HTTPS/i)

    assert.throws(() => {
      assertValidUpdateFeedUrl('https://untrusted-domain.com/releases')
    }, /release origin/i)
  })

  test('updateManager install does not require per-operation SecurityBroker approval', async () => {
    // If phase is not downloaded, returns error without broker
    const resNotDownloaded = await updateManager.install()
    assert.equal(resNotDownloaded.success, false)
    assert.match(resNotDownloaded.message, /Nenhuma atualização/i)

    // When phase is downloaded, installs directly without any confirmation prompt
    ;(updateManager as any).state = {
      phase: 'downloaded',
      currentVersion: '1.0.2',
      availableVersion: '1.0.3',
      message: 'Pronto'
    }

    const resDownloaded = await updateManager.install()
    assert.equal(resDownloaded.success, true)
    assert.match(resDownloaded.message, /iniciada/i)
  })

  test('scripts/verify-authenticode.ps1 exists and defines publisher validation', () => {
    const scriptPath = path.join(root, 'scripts', 'verify-authenticode.ps1')
    assert.ok(fs.existsSync(scriptPath), 'verify-authenticode.ps1 must exist')
    const content = fs.readFileSync(scriptPath, 'utf-8')
    assert.match(content, /Get-AuthenticodeSignature/, 'must use Get-AuthenticodeSignature')
    assert.match(content, /ExpectedPublisher/, 'must accept ExpectedPublisher parameter')
    assert.match(content, /Valid/, 'must verify Valid status')
  })

  test('docs/release/windows-signing.md exists with documentation for CI secrets', () => {
    const docPath = path.join(root, 'docs', 'release', 'windows-signing.md')
    assert.ok(fs.existsSync(docPath), 'windows-signing.md documentation must exist')
    const content = fs.readFileSync(docPath, 'utf-8')
    assert.match(content, /Authenticode/i, 'must document Authenticode signing')
    assert.match(content, /CSC_LINK|CERTIFICATE/i, 'must document certificate secret')
  })

  test('electron-builder.yml configures HTTPS publisher and no portable target', () => {
    const builderConfigPath = path.join(root, 'electron-builder.yml')
    const content = fs.readFileSync(builderConfigPath, 'utf-8')
    assert.match(content, /provider:\s*generic/, 'must configure generic provider')
    assert.match(content, /url:\s*https:\/\//, 'feed URL must use HTTPS')
    assert.doesNotMatch(content, /target:\s*portable/i, 'portable target must not exist')
  })
})
