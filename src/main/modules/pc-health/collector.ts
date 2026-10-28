import type { PcHealthSnapshot } from '../../../shared/types/pc-health'
export interface MetricsSource {
  currentLoad(): Promise<any>; mem(): Promise<any>; cpuTemperature(): Promise<any>; fsSize(): Promise<any>
  graphics(): Promise<any>; battery(): Promise<any>; processes(): Promise<any>; networkStats(): Promise<any>; uptime(): number
}
const number = (value: unknown, max = Number.MAX_SAFE_INTEGER): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : null
const text = (value: unknown) => typeof value === 'string' ? value.replace(/[\x00-\x1f]/g, '').slice(0, 160) : ''
/** Copies only display metrics. No commands, user names, serials, MAC/IP or process arguments. */
export async function collectPcHealth(source: MetricsSource, timeoutMs = 20000): Promise<PcHealthSnapshot> {
  // Windows' shared PowerShell queue handles core readings before optional sensors.
  const names = ['cpu', 'memory', 'disks', 'network', 'gpu', 'battery', 'temperature', 'processes']
  const calls = [() => source.currentLoad(), () => source.mem(), () => source.fsSize(), () => source.networkStats(),
    () => source.graphics(), () => source.battery(), () => source.cpuTemperature(), () => source.processes()]
  const results = await Promise.allSettled(calls.map(async call => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try { return await Promise.race([Promise.resolve().then(call), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('sensor_timeout')), timeoutMs) })]) }
    finally { if (timer) clearTimeout(timer) }
  }))
  const raw = results.map(result => result.status === 'fulfilled' ? result.value : null)
  const [cpu, mem, disks, network, gpu, battery, temp, processes] = raw
  const total = number(mem?.total), available = number(mem?.available)
  const snapshot: PcHealthSnapshot = {
    status: 'ok', observedAt: new Date().toISOString(), cpuPercent: number(cpu?.currentLoad, 100), temperatureC: number(temp?.main, 150),
    uptimeSeconds: number(source.uptime()), memory: total && available !== null && available <= total ? {
      totalBytes: total, availableBytes: available, percent: (total - available) / total * 100,
      swapTotalBytes: number(mem?.swaptotal), swapUsedBytes: number(mem?.swapused)
    } : null,
    disks: Array.isArray(disks) ? disks.filter(disk => number(disk.size) !== null && disk.size > 0 && number(disk.use, 100) !== null).slice(0, 32)
      .map(disk => ({ mount: text(disk.mount), sizeBytes: disk.size, usedPercent: disk.use })) : null,
    gpu: Array.isArray(gpu?.controllers) && gpu.controllers.length ? gpu.controllers.slice(0, 8).map((card: any) => ({ model: text(card.model), percent: number(card.utilizationGpu, 100), temperatureC: number(card.temperatureGpu, 150) })) : null,
    battery: battery?.hasBattery === true && number(battery.percent, 100) !== null ? { percent: battery.percent, charging: battery.isCharging === true || battery.acConnected === true } : null,
    processes: Array.isArray(processes?.list) && number(processes?.all) !== null ? { total: processes.all,
      top: [...processes.list].filter(process => Number.isSafeInteger(process.pid) && process.pid > 0).sort((a, b) => (number(b.cpu) ?? 0) - (number(a.cpu) ?? 0)).slice(0, 10)
        .map(process => ({ pid: process.pid, name: text(process.name), cpuPercent: number(process.cpu, 100), memoryPercent: number(process.mem, 100) })) } : null,
    network: Array.isArray(network) ? network.slice(0, 32).map(device => ({ name: text(device.iface), receivedBytes: number(device.rx_bytes), sentBytes: number(device.tx_bytes) })) : null,
    unavailable: []
  }
  const values = [snapshot.cpuPercent, snapshot.memory, snapshot.disks, snapshot.network, snapshot.gpu, snapshot.battery, snapshot.temperatureC, snapshot.processes]
  snapshot.unavailable = names.filter((_, index) => values[index] === null)
  snapshot.status = snapshot.unavailable.length === names.length ? 'unavailable' : snapshot.unavailable.length ? 'partial' : 'ok'
  return snapshot
}
