export type LicenseState =
  | 'locked'
  | 'validating'
  | 'unlocked'
  | 'expired'
  | 'revoked'
  | 'backend_error'

export interface LeaseClaims {
  iss: string
  aud: string
  installationId: string
  machineHash: string
  iat: number
  exp: number
  [key: string]: unknown
}

export interface LicenseGateSnapshot {
  state: LicenseState
  message: string
  expiresAt?: string
}

export interface LicenseValidationResult {
  valid: boolean
  status?: 'ACTIVATED' | 'ACTIVE' | 'DISABLED' | 'REVOKED' | 'EXPIRED' | 'NO_LICENSE'
  error?: string
  message: string
  client?: {
    name: string
    email: string
  }
  machineId?: string
  activatedAt?: string
  lastSeenAt?: string
  expiresAt?: string
  trustedServerTime?: number
}

export interface LicenseInfo {
  isLicensed: boolean
  status: 'active' | 'disabled' | 'revoked' | 'unlicensed' | 'expired'
  keyMasked?: string
  clientName?: string
  clientEmail?: string
  machineId?: string
  currentHwid: string
  activatedAt?: string
  lastSeenAt?: string
  expiresAt?: string
  error?: string
}

