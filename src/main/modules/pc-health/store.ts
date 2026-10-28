import type { StateDatabase } from '../../storage/state-database'
import type { PcHealthPreferences, PcHealthAlert } from '../../../shared/types/pc-health'
const defaults = { automatic: true, intervalSeconds: 30, alertsEnabled: false, cpuPercent: 90, memoryPercent: 90, diskFreePercent: 10, temperatureC: 85, batteryPercent: 15 }
export class PcHealthStore {
  constructor(private readonly database: StateDatabase) {
    database.transaction(tx => tx.prepare('INSERT OR IGNORE INTO pc_health_preferences VALUES(1,?,0)').run(JSON.stringify(defaults)))
  }
  get(): PcHealthPreferences {
    return this.database.transaction(tx => { const row = tx.prepare('SELECT settings,revision FROM pc_health_preferences WHERE singleton=1').get()!; return { ...JSON.parse(String(row.settings)), revision: Number(row.revision) } })
  }
  update(patch: Partial<Omit<PcHealthPreferences, 'revision'>>, expectedRevision: number): PcHealthPreferences {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length || Object.keys(patch).some(key => !Object.hasOwn(defaults, key)) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('invalid_health_preferences')
    for (const [key, value] of Object.entries(patch)) {
      if (['automatic', 'alertsEnabled'].includes(key)) { if (typeof value !== 'boolean') throw new Error('invalid_health_preferences') }
      else if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (key === 'intervalSeconds' ? 15 : 1) || value > (key === 'intervalSeconds' ? 300 : key === 'temperatureC' ? 120 : 100)) throw new Error('invalid_health_preferences')
    }
    this.database.transaction(tx => {
      const row = tx.prepare('SELECT settings,revision FROM pc_health_preferences WHERE singleton=1').get()!
      if (row.revision !== expectedRevision) throw new Error('stale_health_preferences')
      tx.prepare('UPDATE pc_health_preferences SET settings=?,revision=revision+1 WHERE singleton=1').run(JSON.stringify({ ...JSON.parse(String(row.settings)), ...patch }))
    })
    return this.get()
  }
  claimAlert(kind: PcHealthAlert['kind'], now: number): boolean {
    return this.database.transaction(tx => {
      const row = tx.prepare('SELECT last_at FROM pc_health_alerts WHERE kind=?').get(kind)
      if (row && now - Number(row.last_at) < 900000) return false
      tx.prepare('INSERT INTO pc_health_alerts VALUES(?,?) ON CONFLICT(kind) DO UPDATE SET last_at=excluded.last_at').run(kind, now)
      return true
    })
  }
}
