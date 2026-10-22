import { app } from 'electron'

export const PRODUCTION_KEY_ID = 'prod-2026-01'

export const LICENSE_KEYRING: Readonly<Record<string, JsonWebKey>> = Object.freeze({
  [PRODUCTION_KEY_ID]: Object.freeze({
    kty: 'OKP',
    crv: 'Ed25519',
    x: 'P_BiXYVYZ7nJ7Awagp-Q-qQBGEJ5w_4wJEr5qZ1JVCs'
  }),
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

  // In packaged production, disallow dev keys
  if (typeof app !== 'undefined' && app?.isPackaged) {
    if (kid === PRODUCTION_KEY_ID) {
      return LICENSE_KEYRING[PRODUCTION_KEY_ID]
    }
    return null
  }

  return LICENSE_KEYRING[kid] || null
}

