import { initializePcHealthSettings } from '../src/renderer/ui/pc-health-settings'
;(async () => {
  let changed!: () => void, licenseChanged!: (snapshot: any) => void, allowed = false, saved: any, reads = 0
  const state: any = { preferences: { automatic: true, intervalSeconds: 30, alertsEnabled: false, cpuPercent: 90, memoryPercent: 90, diskFreePercent: 10, temperatureC: 85, batteryPercent: 15, revision: 0 },
    snapshot: { observedAt: new Date().toISOString(), cpuPercent: 25, memory: null, temperatureC: null, uptimeSeconds: 10, battery: null, disks: [], gpu: [], network: [], processes: { total: 1, top: [{ pid: 1, name: '<img src=x onerror=external()>', cpuPercent: 10, memoryPercent: 1 }] }, unavailable: ['memory'] }, alerts: [], errorCode: null, busy: false }
  Object.defineProperty(window, 'electronAPI', { value: {
    listModules: async () => [{ id: 'pc-health', enabled: allowed, authorized: allowed, lifecycle: allowed ? 'running' : 'stopped' }],
    getPcHealth: async () => { reads++; if (!allowed) throw new Error('denied'); return state }, refreshPcHealth: async () => state.snapshot,
    pcHealthPreferences: async (request: any) => { saved = request; state.preferences = { ...state.preferences, ...request.patch, revision: 1 }; return state.preferences },
    onPcHealthChanged: (callback: () => void) => { changed = callback; return () => {} }, onLicenseState: (callback: typeof licenseChanged) => { licenseChanged = callback; return () => {} }
  } })
  const wait = async (predicate: () => boolean) => { const end = Date.now() + 3000; while (!predicate()) { if (Date.now() > end) throw new Error('health UI timed out'); await new Promise(resolve => setTimeout(resolve, 10)) } }
  const element = (id: string) => document.getElementById(id) as HTMLInputElement
  initializePcHealthSettings(); window.dispatchEvent(new Event('jasper-modules-changed'))
  await wait(() => !!element('pc-health-feedback').textContent?.includes('Ative Saúde'))
  if (reads !== 0) throw new Error('Disabled health module was queried')
  allowed = true; window.dispatchEvent(new Event('jasper-modules-changed'))
  await wait(() => !element('pc-health-controls').disabled)
  if (document.querySelector('#pc-health-metrics img')) throw new Error('Unescaped process name')
  if (!element('pc-health-metrics').textContent?.includes('Indisponível')) throw new Error('Missing partial reading')
  element('pc-health-intervalSeconds').value = '60'; element('pc-health-intervalSeconds').dispatchEvent(new Event('input', { bubbles: true }))
  element('pc-health-save').click(); await wait(() => !!saved && !element('pc-health-controls').disabled)
  if (saved.patch.intervalSeconds !== 60 || saved.expectedRevision !== 0) throw new Error('Preference mismatch')
  const beforeDisabled = reads
  allowed = false; changed(); await wait(() => element('pc-health-controls').disabled)
  if (element('pc-health-metrics').children.length) throw new Error('Revoked metrics remained visible')
  if (reads !== beforeDisabled) throw new Error('Disabled health module was queried after change')
  licenseChanged({ state: 'locked' })
  await new Promise(resolve => setTimeout(resolve, 30))
  if (reads !== beforeDisabled) throw new Error('Locked health module was queried')
  console.log('PC_HEALTH_UI_PASS')
})().catch(error => console.error('PC_HEALTH_UI_FAIL ' + String(error)))
