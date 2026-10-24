import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { autoUpdater } from 'electron-updater'
import {
  updateManager,
  assertValidUpdateFeedUrl,
  assertPackagedAppUpdateConfig,
  APPROVED_WINDOWS_PUBLISHER,
  OFFICIAL_RELEASE_FEED_URL
} from '../src/main/services/update-manager'

describe('Commercial Update Policy & Authenticode Verification (Task 7)', () => {
  const root = process.cwd()
  const approvedPublisher = 'CN=Jasper Team, O=Jasper Team, L=Sao Paulo, C=BR'

  test('security-broker.ts is permanently deleted', () => {
    const brokerPath = path.join(root, 'src', 'main', 'services', 'security-broker.ts')
    assert.equal(fs.existsSync(brokerPath), false, 'security-broker.ts must be deleted')
  })

  test('assertValidUpdateFeedUrl accepts valid HTTPS official release feeds and rejects HTTP, third-party or channel overrides', () => {
    assert.doesNotThrow(() => {
      assertValidUpdateFeedUrl('https://github.com/sAlly-19/jasper-avatar-releases/releases/latest/download')
    })

    assert.throws(() => {
      assertValidUpdateFeedUrl('http://github.com/sAlly-19/jasper-avatar-releases/releases/latest/download')
    }, /HTTPS/i)

    assert.throws(() => {
      assertValidUpdateFeedUrl('https://untrusted-domain.com/releases')
    }, /release origin/i)

    assert.throws(() => {
      assertValidUpdateFeedUrl('https://github.com/other-owner/other-repository/releases/latest/download')
    }, /official release feed/i)

    assert.throws(() => {
      assertValidUpdateFeedUrl('https://github.com/sAlly-19/jasper-avatar-releases/releases/beta/download')
    }, /official release feed/i)

    assert.throws(() => {
      updateManager.initialize({ url: 'https://evil.example/releases' })
    }, /Runtime update feed overrides are forbidden/i)
  })

  test('assertPackagedAppUpdateConfig validates publisherName and official feed URL in app-update.yml', () => {
    assert.equal(APPROVED_WINDOWS_PUBLISHER, approvedPublisher)
    assert.doesNotThrow(() => {
      assertPackagedAppUpdateConfig(
        [
          'provider: generic',
          `url: ${OFFICIAL_RELEASE_FEED_URL}`,
          `publisherName: "${approvedPublisher}"`
        ].join('\n')
      )
    })

    assert.throws(() => {
      assertPackagedAppUpdateConfig(
        [
          'provider: generic',
          `url: ${OFFICIAL_RELEASE_FEED_URL}`,
          'publisherName: "CN=Jasper Team, O=Jasper Team, L=Sao Paulo, C=BR, OU=Spoof"'
        ].join('\n')
      )
    }, /publisherName mismatch/i)
  })

  test('updateManager install does not require per-operation SecurityBroker approval', async () => {
    const originalVerifier = (updateManager as any).signatureVerifier
    const originalDownloadedUpdatePath = (updateManager as any).downloadedUpdatePath
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
    ;(updateManager as any).downloadedUpdatePath = 'C:\\Temp\\Jasper-AI-Setup-1.0.3.exe'
    ;(updateManager as any).signatureVerifier = async () => undefined

    try {
      const resDownloaded = await updateManager.install()
      await new Promise<void>((resolve) => setImmediate(resolve))
      assert.equal(resDownloaded.success, true)
      assert.match(resDownloaded.message, /iniciada/i)
    } finally {
      ;(updateManager as any).signatureVerifier = originalVerifier
      ;(updateManager as any).downloadedUpdatePath = originalDownloadedUpdatePath
    }
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
    assert.ok(content.includes(approvedPublisher), 'must document the exact approved certificate subject')
  })

  test('electron-builder.yml configures HTTPS publisher and no portable target', () => {
    const builderConfigPath = path.join(root, 'electron-builder.yml')
    const content = fs.readFileSync(builderConfigPath, 'utf-8')
    assert.match(content, /provider:\s*generic/, 'must configure generic provider')
    assert.match(content, /url:\s*https:\/\//, 'feed URL must use HTTPS')
    assert.match(
      content,
      new RegExp(`publisherName:\\s*["']${approvedPublisher.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`),
      'publisherName must be mandatory and exactly match the approved certificate subject'
    )
    assert.doesNotMatch(content, /target:\s*portable/i, 'portable target must not exist')
  })

  test('rejects a downloaded update with a different signer before installation', async () => {
    const originalState = { ...(updateManager as any).state }
    const originalVerifier = (updateManager as any).signatureVerifier
    const originalQuitAndInstall = autoUpdater.quitAndInstall
    let installCalls = 0
    let verifiedPaths: string[] = []
    ;(autoUpdater as any).quitAndInstall = () => { installCalls += 1 }
    ;(updateManager as any).state = {
      phase: 'downloaded',
      currentVersion: '1.0.2',
      availableVersion: '1.0.3',
      message: 'Pronto'
    }
    ;(updateManager as any).downloadedUpdatePath = 'C:\\Temp\\Jasper-AI-Setup-1.0.3.exe'
    ;(updateManager as any).signatureVerifier = async (paths: string[]) => {
      verifiedPaths = paths
      throw new Error('Publisher mismatch: CN=Different Vendor')
    }

    try {
      const result = await updateManager.install()
      await new Promise<void>((resolve) => setImmediate(resolve))

      assert.equal(result.success, false)
      assert.match(result.message, /assinatura|publicador/i)
      assert.equal(installCalls, 0)
      assert.deepEqual(verifiedPaths, [process.execPath, 'C:\\Temp\\Jasper-AI-Setup-1.0.3.exe'])
    } finally {
      ;(updateManager as any).state = originalState
      ;(updateManager as any).signatureVerifier = originalVerifier
      ;(updateManager as any).downloadedUpdatePath = null
      ;(autoUpdater as any).quitAndInstall = originalQuitAndInstall
    }
  })
})
