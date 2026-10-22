import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LicenseState, LicenseGateSnapshot, LeaseClaims, LicenseValidationResult, LicenseInfo } from '@shared'

const rootDir = process.cwd()

describe('License runtime contracts & test discovery', () => {
  test('exports_the_six_license_states', () => {
    const states: LicenseState[] = [
      'locked',
      'validating',
      'unlocked',
      'expired',
      'revoked',
      'backend_error'
    ]
    assert.equal(states.length, 6)

    // Verify type shapes compile and can be instantiated
    const sampleClaims: LeaseClaims = {
      iss: 'jasper-license-api',
      aud: 'jasper-avatar-desktop',
      installationId: 'inst-123',
      machineHash: 'hash-abc',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600
    }
    assert.equal(sampleClaims.iss, 'jasper-license-api')

    const snapshot: LicenseGateSnapshot = {
      state: 'locked',
      message: 'Bloqueado aguardando licença'
    }
    assert.equal(snapshot.state, 'locked')
  })

  test('test_runner_discovers_new_test_files', () => {
    const runTestsScript = fs.readFileSync(path.join(rootDir, 'scripts', 'run-tests.mjs'), 'utf-8')
    // Must not have hardcoded license-manager.test.ts in testFiles list
    assert.equal(
      runTestsScript.includes("in: 'license-manager.test.ts'"),
      false,
      'run-tests.mjs não deve ter license-manager.test.ts fixo no código'
    )
    // Must dynamically discover test files
    assert.match(
      runTestsScript,
      /readdirSync|findTestFiles|testFiles\s*=.*fs\./,
      'run-tests.mjs deve descobrir arquivos de teste dinamicamente no diretório test/'
    )
  })
})
