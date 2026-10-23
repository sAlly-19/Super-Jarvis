import { app } from 'electron'
import { BUILD_FLAVOR, SMOKE_KEY_ID, SMOKE_PUBLIC_KEY } from '../generated/build-flavor'

export const PRODUCTION_KEY_ID = 'jasper-lease-1'
export const LEGACY_PRODUCTION_KEY_ID = 'prod-2026-01'

const PRODUCTION_PUBLIC_KEY = Object.freeze({
  kty: 'OKP',
  crv: 'Ed25519',
  x: 'P_BiXYVYZ7nJ7Awagp-Q-qQBGEJ5w_4wJEr5qZ1JVCs'
})

export const LICENSE_KEYRING: Readonly<Record<string, JsonWebKey>> = Object.freeze({
  [PRODUCTION_KEY_ID]: PRODUCTION_PUBLIC_KEY,
  [LEGACY_PRODUCTION_KEY_ID]: PRODUCTION_PUBLIC_KEY,
  // Chave pública de desenvolvimento local ativa apenas fora de pacote comercial assinado
  'dev-test-2026': Object.freeze({
    kty: 'OKP',
    crv: 'Ed25519',
    x: '6m25tI8dGf9mP3H7kR1yV5uW9xZ8bA2cD4eF6gH8jK0'
  })
})

export function resolveKeyForId(
  kid: string,
  customKeyring?: Readonly<Record<string, JsonWebKey>>
): JsonWebKey | null {
  if (!kid || typeof kid !== 'string') return null

  // In test/custom verification context, allow injected keyring
  if (customKeyring && Object.prototype.hasOwnProperty.call(customKeyring, kid)) {
    return customKeyring[kid]
  }

  // In packaged production, disallow dev keys unless explicitly running ephemeral smoke flavor
  if (typeof app !== 'undefined' && app?.isPackaged) {
    if (BUILD_FLAVOR === 'smoke' && kid === SMOKE_KEY_ID && SMOKE_PUBLIC_KEY) {
      return SMOKE_PUBLIC_KEY
    }
    if (kid === PRODUCTION_KEY_ID || kid === LEGACY_PRODUCTION_KEY_ID) {
      return LICENSE_KEYRING[kid]
    }
    return null
  }

  if (BUILD_FLAVOR === 'smoke' && kid === SMOKE_KEY_ID && SMOKE_PUBLIC_KEY) {
    return SMOKE_PUBLIC_KEY
  }

  return LICENSE_KEYRING[kid] || null
}

