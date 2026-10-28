import type { PcHealthState, PcHealthPreferences } from '@shared'
const fields = ['intervalSeconds', 'cpuPercent', 'memoryPercent', 'diskFreePercent', 'temperatureC', 'batteryPercent'] as const
const bytes = (value: number | null) => value === null ? 'Indisponível' : `${(value / 1024 ** 3).toFixed(2)} GiB`
const percent = (value: number | null | undefined) => value == null ? 'Indisponível' : `${value.toFixed(1)}%`
export function renderPcHealth(target: HTMLElement, state: PcHealthState): void {
  target.replaceChildren()
  const snapshot = state.snapshot
  const row = (label: string, value: string) => { const p = document.createElement('p'), strong = document.createElement('strong'); strong.textContent = label + ': '; p.append(strong, document.createTextNode(value)); target.append(p) }
  if (!snapshot) { row('Leitura', state.errorCode ? 'Não foi possível coletar. Tente atualizar.' : 'Aguardando coleta.'); return }
  row('Atualizado', new Date(snapshot.observedAt).toLocaleString('pt-BR'))
  row('CPU', percent(snapshot.cpuPercent)); row('RAM', snapshot.memory ? `${percent(snapshot.memory.percent)} · ${bytes(snapshot.memory.availableBytes)} disponíveis de ${bytes(snapshot.memory.totalBytes)}` : 'Indisponível')
  row('Swap', snapshot.memory ? `${bytes(snapshot.memory.swapUsedBytes)} usados de ${bytes(snapshot.memory.swapTotalBytes)}` : 'Indisponível')
  row('Temperatura CPU', snapshot.temperatureC === null ? 'Indisponível' : `${snapshot.temperatureC.toFixed(1)} °C`)
  row('Tempo ligado', snapshot.uptimeSeconds === null ? 'Indisponível' : `${(snapshot.uptimeSeconds / 3600).toFixed(1)} horas`)
  row('Bateria', snapshot.battery ? `${percent(snapshot.battery.percent)} · ${snapshot.battery.charging ? 'na tomada/carregando' : 'descarregando'}` : 'Indisponível / sem bateria')
  row('Discos', snapshot.disks?.length ? snapshot.disks.map(disk => `${disk.mount}: ${percent(disk.usedPercent)} usados de ${bytes(disk.sizeBytes)}`).join(' | ') : 'Indisponível')
  row('GPU', snapshot.gpu?.length ? snapshot.gpu.map(gpu => `${gpu.model}: ${percent(gpu.percent)}; ${gpu.temperatureC === null ? 'temperatura indisponível' : gpu.temperatureC + ' °C'}`).join(' | ') : 'Indisponível')
  row('Rede — contadores acumulados, não velocidade', snapshot.network?.map(device => `${device.name}: recebidos ${bytes(device.receivedBytes)}, enviados ${bytes(device.sentBytes)}`).join(' | ') || 'Indisponível')
  row('Processos', snapshot.processes ? `${snapshot.processes.total} no total; até 10 maiores por uso de CPU` : 'Indisponível')
  for (const process of snapshot.processes?.top ?? []) row(`${process.name} (PID ${process.pid})`, `CPU ${percent(process.cpuPercent)} · RAM ${percent(process.memoryPercent)}`)
  const labels: Record<string, string> = { cpu: 'CPU', memory: 'memória', disks: 'discos', gpu: 'GPU', battery: 'bateria', temperature: 'temperatura', processes: 'processos', network: 'rede' }
  if (snapshot.unavailable.length) row('Leitura parcial', snapshot.unavailable.map(name => labels[name] ?? name).join(', '))
  for (const alert of state.alerts) row('Atenção', alert.message)
}
let initialized = false
export function initializePcHealthSettings(): void {
  if (initialized) return
  const root = document.getElementById('pc-health-panel'), output = document.getElementById('pc-health-metrics'), feedback = document.getElementById('pc-health-feedback')
  const controls = document.getElementById('pc-health-controls') as HTMLFieldSetElement | null
  if (!root || !output || !feedback || !controls) return
  initialized = true
  let generation = 0, revision = 0, editing = false, available = false
  const input = (name: string) => document.getElementById(`pc-health-${name}`) as HTMLInputElement
  const refresh = async () => {
    const current = ++generation
    try {
      const state = await window.electronAPI.getPcHealth()
      if (current !== generation) return
      available = true; controls.disabled = false; renderPcHealth(output, state)
      feedback.textContent = state.errorCode === 'health_worker_cleanup_failed' ? 'A coleta foi interrompida e precisa de um reinício do Jasper para retomar.'
        : state.errorCode ? 'Coleta indisponível. As últimas leituras podem estar desatualizadas.' : 'Somente leitura. Funciona com o Jasper aberto, sem conexão com a IA.'
      if (!editing) {
        revision = state.preferences.revision
        fields.forEach(key => { input(key).value = String(state.preferences[key]) })
        input('automatic').checked = state.preferences.automatic; input('alertsEnabled').checked = state.preferences.alertsEnabled
      }
    } catch {
      if (current !== generation) return
      available = false; editing = false; controls.disabled = true; output.replaceChildren()
      feedback.textContent = 'Ative Saúde do PC nos módulos acima, com licença e consentimento válidos.'
    }
  }
  controls.addEventListener('input', () => { editing = true })
  document.getElementById('pc-health-refresh')?.addEventListener('click', async event => {
    const button = event.currentTarget as HTMLButtonElement; button.disabled = true
    try { await window.electronAPI.refreshPcHealth(); await refresh() }
    catch { feedback.textContent = 'A coleta não terminou. Confira o módulo e tente novamente.' }
    finally { button.disabled = !available }
  })
  document.getElementById('pc-health-save')?.addEventListener('click', async () => {
    controls.disabled = true
    try {
      const patch: Partial<Omit<PcHealthPreferences, 'revision'>> = { automatic: input('automatic').checked, alertsEnabled: input('alertsEnabled').checked }
      fields.forEach(key => { patch[key] = Number(input(key).value) })
      await window.electronAPI.pcHealthPreferences({ type: 'update', patch, expectedRevision: revision })
      editing = false; await refresh()
    } catch { controls.disabled = !available; feedback.textContent = 'Preferências não salvas. Confira os limites e atualize o painel.' }
  })
  document.getElementById('btn-settings')?.addEventListener('click', () => { void refresh() })
  window.addEventListener('jasper-modules-changed', () => { void refresh() })
  window.electronAPI.onPcHealthChanged(() => { void refresh() })
  window.electronAPI.onLicenseState(snapshot => { if (snapshot.state !== 'unlocked') { generation++; available = false; controls.disabled = true; output.replaceChildren() }; void refresh() })
}
