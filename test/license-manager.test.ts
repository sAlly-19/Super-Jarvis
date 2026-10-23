import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { webcrypto } from 'node:crypto'
import type { LicenseState, LicenseGateSnapshot, LeaseClaims, LicenseValidationResult, LicenseInfo } from '@shared'
// @ts-ignore - will be implemented in Step 3
import { LICENSE_KEYRING, PRODUCTION_KEY_ID } from '../src/main/services/license-keyring'
// @ts-ignore - will be implemented in Step 3
import { verifySignedLease, type LeaseVerificationContext } from '../src/main/services/lease-verifier'

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
    assert.equal(
      runTestsScript.includes("in: 'license-manager.test.ts'"),
      false,
      'run-tests.mjs não deve ter license-manager.test.ts fixo no código'
    )
    assert.match(
      runTestsScript,
      /readdirSync|findTestFiles|testFiles\s*=.*fs\./,
      'run-tests.mjs deve descobrir arquivos de teste dinamicamente no diretório test/'
    )
  })
})

describe('Compiled Ed25519 keyring and strict lease verifier', () => {
  let testKeyPair: CryptoKeyPair
  let testPublicJwk: JsonWebKey
  let testKeyring: Record<string, JsonWebKey>

  const installationId = 'test-install-uuid-1234'
  const machineHash = 'test-machine-hash-5678'
  const testKid = 'test-key-2026'

  before(async () => {
    testKeyPair = await webcrypto.subtle.generateKey(
      { name: 'Ed25519' },
      true,
      ['sign', 'verify']
    ) as CryptoKeyPair
    testPublicJwk = await webcrypto.subtle.exportKey('jwk', testKeyPair.publicKey)
    testKeyring = {
      [testKid]: testPublicJwk
    }
  })

  async function createSignedToken(
    payload: Record<string, any>,
    kid: string = testKid,
    key: CryptoKey = testKeyPair.privateKey,
    alg: string = 'EdDSA'
  ): Promise<string> {
    const headerObj = { alg, typ: 'JWT', kid }
    const encHeader = Buffer.from(JSON.stringify(headerObj)).toString('base64url')
    const encPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const signature = await webcrypto.subtle.sign(
      { name: 'Ed25519' },
      key,
      Buffer.from(`${encHeader}.${encPayload}`, 'utf-8')
    )
    const encSig = Buffer.from(signature).toString('base64url')
    return `${encHeader}.${encPayload}.${encSig}`
  }

  test('production keyring contains prod-2026-01 with expected coordinate', () => {
    assert.ok(LICENSE_KEYRING['prod-2026-01'], 'prod-2026-01 deve existir no keyring')
    assert.equal(LICENSE_KEYRING['prod-2026-01'].kty, 'OKP')
    assert.equal(LICENSE_KEYRING['prod-2026-01'].crv, 'Ed25519')
    assert.equal(
      LICENSE_KEYRING['prod-2026-01'].x,
      'P_BiXYVYZ7nJ7Awagp-Q-qQBGEJ5w_4wJEr5qZ1JVCs',
      'Coordenada pública da chave de produção deve ser exata'
    )
  })

  test('production keyring recognizes the live server kid with the compiled production key', () => {
    assert.equal(PRODUCTION_KEY_ID, 'jasper-lease-1')
    assert.deepEqual(LICENSE_KEYRING['jasper-lease-1'], {
      kty: 'OKP',
      crv: 'Ed25519',
      x: 'P_BiXYVYZ7nJ7Awagp-Q-qQBGEJ5w_4wJEr5qZ1JVCs'
    })
    assert.equal(
      LICENSE_KEYRING['prod-2026-01'].x,
      LICENSE_KEYRING['jasper-lease-1'].x,
      'the previous kid remains a compatibility alias for the same public key'
    )
  })

  test('valid claims pass verification and return typed claims', async () => {
    const now = Math.floor(Date.now() / 1000)
    const claims = {
      iss: 'jasper-license-api',
      aud: 'jasper-avatar-desktop',
      installationId,
      machineHash,
      iat: now - 10,
      exp: now + 3600
    }
    const token = await createSignedToken(claims)
    const context: LeaseVerificationContext = {
      keyring: testKeyring,
      installationId,
      machineHash,
      nowSeconds: now,
      lastTrustedTimeMs: (now - 20) * 1000
    }

    const verified = await verifySignedLease(token, context)
    assert.equal(verified.valid, true)
    assert.equal(verified.kid, testKid)
    assert.equal(verified.claims.installationId, installationId)
    assert.equal(verified.trustedServerTime, (now - 10) * 1000)
  })

  test('fails when duration exp - iat > 259200 (72h)', async () => {
    const now = Math.floor(Date.now() / 1000)
    const claims = {
      iss: 'jasper-license-api',
      aud: 'jasper-avatar-desktop',
      installationId,
      machineHash,
      iat: now,
      exp: now + 259201 // 72h + 1s
    }
    const token = await createSignedToken(claims)
    const context: LeaseVerificationContext = {
      keyring: testKeyring,
      installationId,
      machineHash,
      nowSeconds: now
    }
    const result = await verifySignedLease(token, context)
    assert.equal(result.valid, false)
    assert.equal(result.error, 'INVALID_LEASE')
  })

  test('fails when lease is expired (exp <= now)', async () => {
    const now = Math.floor(Date.now() / 1000)
    const claims = {
      iss: 'jasper-license-api',
      aud: 'jasper-avatar-desktop',
      installationId,
      machineHash,
      iat: now - 7200,
      exp: now - 10
    }
    const token = await createSignedToken(claims)
    const context: LeaseVerificationContext = {
      keyring: testKeyring,
      installationId,
      machineHash,
      nowSeconds: now
    }
    const result = await verifySignedLease(token, context)
    assert.equal(result.valid, false)
    assert.equal(result.error, 'EXPIRED')
  })

  test('fails when iat is in the future > now + 300', async () => {
    const now = Math.floor(Date.now() / 1000)
    const claims = {
      iss: 'jasper-license-api',
      aud: 'jasper-avatar-desktop',
      installationId,
      machineHash,
      iat: now + 301,
      exp: now + 3600
    }
    const token = await createSignedToken(claims)
    const context: LeaseVerificationContext = {
      keyring: testKeyring,
      installationId,
      machineHash,
      nowSeconds: now
    }
    const result = await verifySignedLease(token, context)
    assert.equal(result.valid, false)
    assert.equal(result.error, 'INVALID_LEASE')
  })

  test('fails when kid is missing or unknown in keyring', async () => {
    const now = Math.floor(Date.now() / 1000)
    const claims = {
      iss: 'jasper-license-api',
      aud: 'jasper-avatar-desktop',
      installationId,
      machineHash,
      iat: now - 10,
      exp: now + 3600
    }
    const token = await createSignedToken(claims, 'unknown-kid-xyz')
    const context: LeaseVerificationContext = {
      keyring: testKeyring,
      installationId,
      machineHash,
      nowSeconds: now
    }
    const result = await verifySignedLease(token, context)
    assert.equal(result.valid, false)
    assert.equal(result.error, 'INVALID_LEASE')
  })

  test('fails when installationId does not match context', async () => {
    const now = Math.floor(Date.now() / 1000)
    const claims = {
      iss: 'jasper-license-api',
      aud: 'jasper-avatar-desktop',
      installationId: 'other-install-uuid',
      machineHash,
      iat: now - 10,
      exp: now + 3600
    }
    const token = await createSignedToken(claims)
    const context: LeaseVerificationContext = {
      keyring: testKeyring,
      installationId,
      machineHash,
      nowSeconds: now
    }
    const result = await verifySignedLease(token, context)
    assert.equal(result.valid, false)
    assert.equal(result.error, 'INVALID_LEASE')
  })

  test('fails when machineHash does not match context', async () => {
    const now = Math.floor(Date.now() / 1000)
    const claims = {
      iss: 'jasper-license-api',
      aud: 'jasper-avatar-desktop',
      installationId,
      machineHash: 'other-machine-hash',
      iat: now - 10,
      exp: now + 3600
    }
    const token = await createSignedToken(claims)
    const context: LeaseVerificationContext = {
      keyring: testKeyring,
      installationId,
      machineHash,
      nowSeconds: now
    }
    const result = await verifySignedLease(token, context)
    assert.equal(result.valid, false)
    assert.equal(result.error, 'INVALID_LEASE')
  })

  test('fails when signature is forged or invalid', async () => {
    const now = Math.floor(Date.now() / 1000)
    const claims = {
      iss: 'jasper-license-api',
      aud: 'jasper-avatar-desktop',
      installationId,
      machineHash,
      iat: now - 10,
      exp: now + 3600
    }
    // Sign with another key
    const otherKeyPair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair
    const token = await createSignedToken(claims, testKid, otherKeyPair.privateKey)
    const context: LeaseVerificationContext = {
      keyring: testKeyring,
      installationId,
      machineHash,
      nowSeconds: now
    }
    const result = await verifySignedLease(token, context)
    assert.equal(result.valid, false)
    assert.equal(result.error, 'INVALID_LEASE')
  })

  test('fails on malformed token string', async () => {
    const context: LeaseVerificationContext = {
      keyring: testKeyring,
      installationId,
      machineHash
    }
    const result1 = await verifySignedLease('not-a-jwt', context)
    assert.equal(result1.valid, false)
    assert.equal(result1.error, 'INVALID_LEASE')

    const result2 = await verifySignedLease('a.b', context)
    assert.equal(result2.valid, false)
    assert.equal(result2.error, 'INVALID_LEASE')

    const result3 = await verifySignedLease('a.b.c.d', context)
    assert.equal(result3.valid, false)
    assert.equal(result3.error, 'INVALID_LEASE')
  })

  test('fails on clock rollback where now is behind lastTrustedTimeMs', async () => {
    const now = Math.floor(Date.now() / 1000)
    const claims = {
      iss: 'jasper-license-api',
      aud: 'jasper-avatar-desktop',
      installationId,
      machineHash,
      iat: now - 100,
      exp: now + 3600
    }
    const token = await createSignedToken(claims)
    const context: LeaseVerificationContext = {
      keyring: testKeyring,
      installationId,
      machineHash,
      nowSeconds: now,
      lastTrustedTimeMs: (now + 1000) * 1000 // Clock rolled back 1000 seconds
    }
    const result = await verifySignedLease(token, context)
    assert.equal(result.valid, false)
    assert.equal(result.error, 'CLOCK_ROLLBACK')
  })
})

