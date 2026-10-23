import { LicenseGate, licenseGate as defaultLicenseGate } from './license-gate'
import { ConfigStore, configStore as defaultConfigStore } from '../config/config-store'
import { getHardwareInfo } from './hwid'

export class OperationalAccess {
  private licenseGate: LicenseGate
  private configStore: ConfigStore
  private getInstallationId: () => string

  constructor(
    licenseGate: LicenseGate = defaultLicenseGate,
    configStore: ConfigStore = defaultConfigStore,
    getInstallationId: () => string = () => {
      try {
        return getHardwareInfo().machineId
      } catch {
        return 'HWID-LOCAL-DEV'
      }
    }
  ) {
    this.licenseGate = licenseGate
    this.configStore = configStore
    this.getInstallationId = getInstallationId
  }

  public isConsentAccepted(): boolean {
    const cfg = this.configStore.getConfig()
    const currentHwid = this.getInstallationId()
    return Boolean(
      cfg.controlConsentAcceptedAt &&
      cfg.controlConsentInstallationId === currentHwid
    )
  }

  public acceptConsent(): void {
    this.licenseGate.requireUnlocked()
    const currentHwid = this.getInstallationId()
    this.configStore.updateConfig({
      controlConsentAcceptedAt: new Date().toISOString(),
      controlConsentInstallationId: currentHwid
    })
  }

  public requireAgentAccess(): void {
    this.licenseGate.requireUnlocked()
    if (!this.isConsentAccepted()) {
      throw new Error('Commercial autonomous control consent required before operational access')
    }
  }
}

export const operationalAccess = new OperationalAccess()
