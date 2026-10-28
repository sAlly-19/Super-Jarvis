import { app, utilityProcess } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { HealthCollectorClient } from '../../src/main/modules/pc-health/client'
import { ModuleRegistry } from '../../src/main/modules/registry'

const [, , profile, root, packaged] = process.argv
app.setPath('userData', profile)
app.whenReady().then(async () => {
  const base = packaged === 'yes' ? path.join(root, 'release/win-unpacked/resources/app.asar') : root
  const worker = path.join(base, packaged === 'yes' ? 'out/main/pc-health-worker.js' : 'out/main/pc-health-worker.js')
  const registry = new ModuleRegistry(JSON.parse(fs.readFileSync(path.join(base, 'resources/modules/native-capabilities.json'), 'utf8')))
  const client = new HealthCollectorClient(worker)
  const children: Electron.UtilityProcess[] = []
  const fork = utilityProcess.fork
  utilityProcess.fork = (...args: Parameters<typeof utilityProcess.fork>) => { const child = fork(...args); children.push(child); return child }
  try {
    const started = Date.now()
    const snapshot = await client.collect(new AbortController().signal)
    registry.validateOutput('pc_health_read', { receiptRef: 'native-test', snapshot })
    assert.ok(snapshot.cpuPercent !== null || snapshot.memory !== null, 'No basic metrics collected')
    assert.doesNotMatch(JSON.stringify(snapshot), /"(?:command|params|serial|ip4|mac|user)"\s*:/)
    const controller = new AbortController()
    const pending = client.collect(controller.signal)
    controller.abort()
    await assert.rejects(pending, /cancelled/)
    const deadline = Date.now() + 3000
    while (children.some(child => child.pid !== undefined)) {
      if (Date.now() > deadline) throw new Error('Health worker survived cleanup')
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    console.log(JSON.stringify({ result: 'PC_HEALTH_NATIVE_PASS', packaged: packaged === 'yes', elapsedMs: Date.now() - started,
      status: snapshot.status, unavailable: snapshot.unavailable, workersExited: true }))
    app.exit(0)
  } catch (error) { console.error(error); app.exit(1) }
})
