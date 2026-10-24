// scripts/fixtures/smoke-license-keypair.mjs
// Generates ephemeral Ed25519 keypairs for isolated loopback smoke testing.

import crypto from 'node:crypto'

export async function generateSmokeKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  const jwkPublic = publicKey.export({ format: 'jwk' })
  const jwkPrivate = privateKey.export({ format: 'jwk' })

  return {
    keyId: 'smoke-ephemeral-2026',
    publicKey: jwkPublic,
    privateKey: jwkPrivate,
    rawPrivateKey: privateKey,
    rawPublicKey: publicKey
  }
}

export function signSmokeLease(claims, privateKey, kid = 'smoke-ephemeral-2026') {
  const header = {
    alg: 'EdDSA',
    typ: 'JWT',
    kid
  }

  const encHeader = Buffer.from(JSON.stringify(header), 'utf8').toString('base64url')
  const encPayload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')
  const data = Buffer.from(`${encHeader}.${encPayload}`, 'utf8')

  const signature = crypto.sign(null, data, privateKey)
  const encSig = Buffer.from(signature).toString('base64url')

  return `${encHeader}.${encPayload}.${encSig}`
}

