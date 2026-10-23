import { before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { verifySignedLease } from '../src/main/services/lease-verifier'

describe('Lease verifier monotonic clock', () => {
  let keyPair: CryptoKeyPair
  let publicJwk: JsonWebKey

  before(async () => {
    keyPair = await webcrypto.subtle.generateKey(
      { name: 'Ed25519' },
      true,
      ['sign', 'verify']
    ) as CryptoKeyPair
    publicJwk = await webcrypto.subtle.exportKey('jwk', keyPair.publicKey)
  })

  async function signedLease(iat: number, exp: number): Promise<string> {
    const header = Buffer.from(JSON.stringify({
      alg: 'EdDSA',
      typ: 'JWT',
      kid: 'monotonic-test'
    })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({
      iss: 'jasper-license-api',
      aud: 'jasper-avatar-desktop',
      installationId: 'installation-test',
      machineHash: 'machine-test',
      iat,
      exp
    })).toString('base64url')
    const signature = await webcrypto.subtle.sign(
      { name: 'Ed25519' },
      keyPair.privateKey,
      Buffer.from(`${header}.${payload}`, 'utf-8')
    )
    return `${header}.${payload}.${Buffer.from(signature).toString('base64url')}`
  }

  test('rejects rollback below the last locally observed instant even inside signed lease window', async () => {
    const token = await signedLease(1_000, 4_000)

    const result = await verifySignedLease(token, {
      keyring: { 'monotonic-test': publicJwk },
      installationId: 'installation-test',
      machineHash: 'machine-test',
      nowSeconds: 2_000,
      lastTrustedTimeMs: 1_000_000,
      lastObservedTimeMs: 2_500_000
    })

    assert.equal(result.valid, false)
    assert.equal(result.error, 'CLOCK_ROLLBACK')
  })
})
