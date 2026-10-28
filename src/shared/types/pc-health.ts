export interface PcHealthSnapshot {
  status: 'ok' | 'partial' | 'unavailable'
  observedAt: string
  cpuPercent: number | null
  temperatureC: number | null
  uptimeSeconds: number | null
  memory: { totalBytes: number; availableBytes: number; percent: number; swapTotalBytes: number | null; swapUsedBytes: number | null } | null
  disks: Array<{ mount: string; sizeBytes: number; usedPercent: number }> | null
  gpu: Array<{ model: string; percent: number | null; temperatureC: number | null }> | null
  battery: { percent: number; charging: boolean } | null
  processes: { total: number; top: Array<{ pid: number; name: string; cpuPercent: number | null; memoryPercent: number | null }> } | null
  network: Array<{ name: string; receivedBytes: number | null; sentBytes: number | null }> | null
  unavailable: string[]
}
export interface PcHealthPreferences {
  automatic: boolean; intervalSeconds: number; alertsEnabled: boolean; revision: number
  cpuPercent: number; memoryPercent: number; diskFreePercent: number; temperatureC: number; batteryPercent: number
}
export interface PcHealthAlert { kind: 'cpu' | 'memory' | 'disk' | 'temperature' | 'battery'; message: string }
export interface PcHealthState { snapshot: PcHealthSnapshot | null; preferences: PcHealthPreferences; busy: boolean; errorCode: string | null; alerts: PcHealthAlert[] }
export type PcHealthPreferencesRequest = { type: 'get' } | { type: 'update'; patch: Partial<Omit<PcHealthPreferences, 'revision'>>; expectedRevision: number }
export interface PcHealthAPI {
  getPcHealth(): Promise<PcHealthState>
  refreshPcHealth(): Promise<PcHealthSnapshot>
  pcHealthPreferences(request: PcHealthPreferencesRequest): Promise<PcHealthPreferences>
  onPcHealthChanged(callback: () => void): () => void
}
