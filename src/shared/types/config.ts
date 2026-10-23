export const PUBLIC_CONFIG_KEYS = [
  'apiKey',
  'voiceName',
  'model',
  'agentName',
  'checkUpdatesDaily',
  'enableWakeWord',
  'enableBloom',
  'enableNeuralBg',
  'enableEyeTracking',
  'enableScreenAwareness'
] as const

export const INTERNAL_CONFIG_KEYS = [
  'licenseKey',
  'licenseStatus',
  'licenseMachineId',
  'licenseActivatedAt',
  'licenseLastCheckedAt',
  'licenseInstallationId',
  'licenseDeviceId',
  'licenseDeviceSecret',
  'licenseLeaseToken',
  'licenseLeaseExpiresAt',
  'licenseLastTrustedAt',
  'licenseLastObservedAt',
  'controlConsentAcceptedAt',
  'controlConsentInstallationId'
] as const

export type PublicConfigKey = (typeof PUBLIC_CONFIG_KEYS)[number]
export type InternalConfigKey = (typeof INTERNAL_CONFIG_KEYS)[number]
export type LicenseConfigStatus = 'active' | 'disabled' | 'revoked' | 'unlicensed'

export interface JasperConfig {
  apiKey: string
  voiceName: string
  model: string
  agentName: string
  checkUpdatesDaily: boolean
  enableWakeWord: boolean
  enableBloom: boolean
  enableNeuralBg: boolean
  enableEyeTracking: boolean
  enableScreenAwareness: boolean
  licenseKey?: string
  licenseStatus?: LicenseConfigStatus
  licenseMachineId?: string
  licenseActivatedAt?: string
  licenseLastCheckedAt?: string
  licenseInstallationId?: string
  licenseDeviceId?: string
  licenseDeviceSecret?: string
  licenseLeaseToken?: string
  licenseLeaseExpiresAt?: string
  licenseLastTrustedAt?: string
  licenseLastObservedAt?: string
  controlConsentAcceptedAt?: string
  controlConsentInstallationId?: string
}

export type UpdateConfigPayload = Partial<Pick<JasperConfig, PublicConfigKey>>
export type InternalConfigUpdatePayload = Partial<Pick<JasperConfig, InternalConfigKey>>

export interface ConfigSummary extends Pick<JasperConfig, Exclude<PublicConfigKey, 'apiKey'>> {
  apiKey: string
  hasFullKey: boolean
  isConnected: boolean
}
