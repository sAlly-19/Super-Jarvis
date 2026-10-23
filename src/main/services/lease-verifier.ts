import { webcrypto } from 'node:crypto'
import type { LeaseClaims } from '@shared'
import { resolveKeyForId } from './license-keyring'

export interface LeaseVerificationContext {
  keyring?: Readonly<Record<string, JsonWebKey>>
  installationId: string
  machineHash: string
  nowSeconds?: number
  nowMs?: number
  lastTrustedTimeMs?: number
  lastObservedTimeMs?: number
}

export type VerifiedLease =
  | {
      valid: true
      kid: string
      claims: LeaseClaims
      trustedServerTime: number
    }
  | {
      valid: false
      error: 'INVALID_LEASE' | 'EXPIRED' | 'CLOCK_ROLLBACK' | 'INVALID_FORMAT'
      message: string
      kid?: string
    }

function decodeBase64UrlJson(segment: string): Record<string, any> | null {
  try {
    const raw = Buffer.from(segment, 'base64url').toString('utf-8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

export async function verifySignedLease(
  token: string,
  context: LeaseVerificationContext
): Promise<VerifiedLease> {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'INVALID_LEASE', message: 'Token de autorização vazio ou formato inválido.' }
  }

  const parts = token.split('.')
  if (parts.length !== 3) {
    return { valid: false, error: 'INVALID_LEASE', message: 'Lease malformado: esperados 3 segmentos JWT.' }
  }

  const [encHeader, encPayload, encSig] = parts
  if (!encHeader || !encPayload || !encSig) {
    return { valid: false, error: 'INVALID_LEASE', message: 'Lease malformado: segmentos vazios.' }
  }

  const header = decodeBase64UrlJson(encHeader)
  const payload = decodeBase64UrlJson(encPayload)
  if (!header || !payload) {
    return { valid: false, error: 'INVALID_LEASE', message: 'Lease malformado: cabeçalho ou payload JSON inválido.' }
  }

  if (header.alg !== 'EdDSA') {
    return { valid: false, error: 'INVALID_LEASE', message: 'Algoritmo inválido: esperado EdDSA.' }
  }

  const kid = typeof header.kid === 'string' ? header.kid : ''
  const jwk = resolveKeyForId(kid, context.keyring)
  if (!jwk || jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519') {
    return { valid: false, error: 'INVALID_LEASE', message: `Identificador de chave (kid) ausente ou não reconhecido no keyring: ${kid}` }
  }

  if (payload.iss !== 'jasper-license-api' || payload.aud !== 'jasper-avatar-desktop') {
    return { valid: false, error: 'INVALID_LEASE', message: 'Emissor (iss) ou audiência (aud) do lease inválidos.' }
  }

  if (payload.installationId !== context.installationId) {
    return { valid: false, error: 'INVALID_LEASE', message: 'O lease não pertence a esta instalação.' }
  }

  if (payload.machineHash !== context.machineHash) {
    return { valid: false, error: 'INVALID_LEASE', message: 'O lease não pertence a esta máquina.' }
  }

  if (!Number.isFinite(payload.iat) || !Number.isFinite(payload.exp)) {
    return { valid: false, error: 'INVALID_LEASE', message: 'Timestamps iat e exp devem ser números finitos.' }
  }

  const nowMs = context.nowMs ?? (context.nowSeconds !== undefined ? context.nowSeconds * 1000 : Date.now())
  const nowSeconds = context.nowSeconds ?? Math.floor(nowMs / 1000)

  // Maximum lease lifetime: 72 hours (259200 seconds)
  if (payload.exp - payload.iat > 259_200) {
    return { valid: false, error: 'INVALID_LEASE', message: 'Duração do lease excede o limite máximo permitido de 72 horas.' }
  }

  // Future iat skew limit: up to 300 seconds
  if (payload.iat > nowSeconds + 300) {
    return { valid: false, error: 'INVALID_LEASE', message: 'Data de emissão (iat) está no futuro além da tolerância.' }
  }

  // Expiration check
  if (payload.exp <= nowSeconds) {
    return { valid: false, error: 'EXPIRED', message: 'A autorização offline da licença expirou.' }
  }

  // Clock rollback check against both signed server time and the latest
  // locally observed instant. The latter prevents replaying an old wall clock
  // that still falls inside the original lease window.
  const rollbackFloorMs = Math.max(
    context.lastTrustedTimeMs ?? 0,
    context.lastObservedTimeMs ?? 0
  )
  if (rollbackFloorMs > 0) {
    if (nowMs < rollbackFloorMs) {
      return {
        valid: false,
        error: 'CLOCK_ROLLBACK',
        message: 'Regressão de relógio do sistema detectada. Bloqueado até validação online.'
      }
    }
  }

  // Cryptographic signature check
  try {
    const key = await webcrypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'Ed25519' },
      false,
      ['verify']
    )
    const sigBytes = Buffer.from(encSig, 'base64url')
    const dataBytes = Buffer.from(`${encHeader}.${encPayload}`, 'utf-8')
    const validSig = await webcrypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      sigBytes,
      dataBytes
    )

    if (!validSig) {
      return { valid: false, error: 'INVALID_LEASE', message: 'Assinatura criptográfica Ed25519 inválida.' }
    }
  } catch {
    return { valid: false, error: 'INVALID_LEASE', message: 'Erro interno ao validar assinatura criptográfica do lease.' }
  }

  const trustedServerTime = payload.iat * 1000
  return {
    valid: true,
    kid,
    claims: payload as LeaseClaims,
    trustedServerTime
  }
}

