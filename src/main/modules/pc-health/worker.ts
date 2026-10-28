import si from 'systeminformation'
import os from 'node:os'
import { collectPcHealth } from './collector'
process.parentPort?.once('message', () => {
  void (async () => {
    if (process.platform === 'win32') si.powerShellStart()
    await si.currentLoad().catch(() => {})
    await new Promise(resolve => setTimeout(resolve, 500))
    try { return await collectPcHealth({ ...si, uptime: os.uptime }) }
    finally { if (process.platform === 'win32') si.powerShellRelease() }
  })().then(snapshot => process.parentPort?.postMessage({ ok: true, snapshot }), () => process.parentPort?.postMessage({ ok: false }))
})
