import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { collectPcHealth } from '../src/main/modules/pc-health/collector'
import { PcHealthStore } from '../src/main/modules/pc-health/store'
import { PcHealthService } from '../src/main/modules/pc-health/service'
import { StateDatabase } from '../src/main/storage/state-database'

const source = () => ({
  currentLoad: async () => ({ currentLoad: 25 }), mem: async () => ({ total: 100, available: 30, swaptotal: 50, swapused: 10 }),
  cpuTemperature: async () => ({ main: -1 }), fsSize: async () => [{ mount: 'C:', size: 100, used: 80, use: 80 }],
  graphics: async () => ({ controllers: [] }), battery: async () => ({ hasBattery: false }),
  networkStats: async () => [{ iface: 'Ethernet', rx_bytes: 100, tx_bytes: 200, ip4: 'secret' }],
  processes: async () => ({ all: 1, list: [{ pid: 10, name: 'test', cpu: 5, mem: 1, user: 'private', command: 'secret' }] }),
  uptime: () => 100
})
const open = () => {
  const names = ['001-module-state.sql','002-capability-invocations.sql','003-tasks.sql','004-task-evidence.sql','005-reminders.sql','006-reminder-imports.sql','007-pc-health.sql']
  const sql = names.map(name => fs.readFileSync(`src/main/storage/migrations/${name}`, 'utf8'))
  const db = new StateDatabase(':memory:', sql[0], sql.slice(1))
  return { db, store: new PcHealthStore(db) }
}

test('health collector preserves partial readings and never invents absent sensors or exports commands/IPs', async () => {
  const api = source(); api.graphics = async () => { throw new Error('private driver error') }
  const snapshot = await collectPcHealth(api)
  assert.equal(snapshot.cpuPercent, 25); assert.equal(snapshot.memory!.percent, 70)
  assert.equal(snapshot.temperatureC, null); assert.equal(snapshot.battery, null); assert.equal(snapshot.gpu, null)
  assert.equal(snapshot.status, 'partial')
  assert.doesNotMatch(JSON.stringify(snapshot), /secret|private|command|ip4/)
  assert.equal(snapshot.network![0].receivedBytes, 100)
})

test('health preferences use CAS, strict limits and durable alert cooldown without storing samples', () => {
  const { db, store } = open()
  try {
    const initial = store.get()
    assert.equal(initial.intervalSeconds, 30); assert.equal(initial.alertsEnabled, false)
    store.update({ alertsEnabled: true }, initial.revision)
    assert.throws(() => store.update({ intervalSeconds: 1 }, 1), /invalid/)
    assert.throws(() => store.update({ alertsEnabled: false }, 0), /stale/)
    assert.throws(() => store.update({ secret: 'x' } as any, 1), /invalid/)
    assert.equal(store.claimAlert('cpu', 1000000), true)
    assert.equal(store.claimAlert('cpu', 1000001), false)
    assert.equal(store.claimAlert('cpu', 1900001), true)
  } finally { db.close() }
})

test('health polling observes interval, consecutive thresholds, cooldown and independent authorization', async () => {
  const { db, store } = open(); let now = 1000000, allowed = true, reads = 0, alerts = 0
  store.update({ alertsEnabled: true, cpuPercent: 20 }, 0)
  const service = new PcHealthService(store, { collect: async () => { reads++; return collectPcHealth(source()) } }, {
    allowed: () => allowed, authorize: () => { if (!allowed) throw new Error('denied') }, now: () => now,
    changed: () => {}, notify: () => { alerts++ }, closeNotices: () => {}
  })
  try {
    await service.poll(); await service.poll(); assert.equal(reads, 1); assert.equal(alerts, 0)
    now += 30000; await service.poll(); assert.equal(reads, 2); assert.equal(alerts, 1)
    now += 30000; await service.poll(); assert.equal(alerts, 1)
    allowed = false; now += 30000; await service.poll(); assert.equal(reads, 3)
    assert.throws(() => service.state(), /unavailable/)
  } finally { await service.stop(); db.close() }
})

test('disable aborts health work and discards late results without clearing saved preferences', async () => {
  const { db, store } = open(); let resolve!: (value: any) => void, signal!: AbortSignal
  const service = new PcHealthService(store, { collect: async s => { signal = s; return new Promise(done => { resolve = done }) } }, {
    allowed: () => true, authorize: () => {}, now: () => 1000000, changed: () => {}, notify: () => {}, closeNotices: () => {}
  })
  try {
    const reading = service.read().then(() => assert.fail('late reading escaped'), () => {})
    const stopping = service.stop(); assert.equal(signal.aborted, true)
    resolve(await collectPcHealth(source())); await stopping; await reading
    assert.equal(service.state().snapshot, null); assert.equal(store.get().intervalSeconds, 30)
  } finally { await service.stop(); db.close() }
})

test('sensor timeout retains other measurements and reports unavailable rather than zero', async () => {
  const api = source(); api.graphics = () => new Promise(() => {})
  const snapshot = await collectPcHealth(api, 5)
  assert.equal(snapshot.cpuPercent, 25); assert.equal(snapshot.gpu, null)
  assert.ok(snapshot.unavailable.includes('gpu'))
})

test('host health proof binds context and output; forged readings and revoked authority cannot verify', async () => {
  const { db, store } = open(); let allowed = true
  const service = new PcHealthService(store, { collect: () => collectPcHealth(source()) }, {
    allowed: () => allowed, authorize: () => { if (!allowed) throw new Error('denied') }, now: () => 1000000, changed: () => {}, notify: () => {}, closeNotices: () => {}
  })
  const context = { taskId: 't', stepId: 's', invocationId: 'i', moduleRevision: 0, sessionId: 1 }
  try {
    const data = await service.execute('pc_health_read', {}, context, new AbortController().signal)
    const result = { status: 'unknown' as const, data, evidence: [] }
    assert.equal(service.verify(context, 'pc_health_read', result).status, 'succeeded')
    assert.equal(service.verify({ ...context, sessionId: 2 }, 'pc_health_read', result).status, 'unknown')
    assert.equal(service.verify(context, 'pc_health_read', { ...result, data: { ...data, snapshot: { ...data.snapshot, cpuPercent: 0 } } }).status, 'unknown')
    allowed = false
    assert.equal(service.verify(context, 'pc_health_read', result).status, 'unknown')
    allowed = true; service.releaseObservation('i')
    assert.equal(service.verify(context, 'pc_health_read', result).status, 'unknown')
  } finally { await service.stop(); db.close() }
})

test('spontaneous worker cleanup failure blocks manual and automatic collection until restart', async () => {
  const { db, store } = open(); let reads = 0
  const service = new PcHealthService(store, { collect: async () => { reads++; throw new Error('health_worker_cleanup_failed') } }, {
    allowed: () => true, authorize: () => {}, now: () => 1000000, changed() {}, notify() {}, closeNotices() {}
  })
  try {
    await assert.rejects(service.read(), /health_worker_cleanup_failed/)
    await service.stop()
    await service.poll()
    assert.equal(reads, 1, 'automatic polling must not start another worker')
    assert.throws(() => service.read(), /health_worker_cleanup_failed/)
    assert.equal(service.state().errorCode, 'health_worker_cleanup_failed')
  } finally { await service.stop(); db.close() }
})

test('uncertain worker cleanup blocks further collection until restart', async () => {
  const { db, store } = open(); let reads = 0
  const service = new PcHealthService(store, { collect: signal => { reads++; return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('health_worker_cleanup_failed')), { once: true })) } }, {
    allowed: () => true, authorize: () => {}, now: () => 1000000, changed() {}, notify() {}, closeNotices() {}
  })
  try {
    const reading = service.read().catch(() => {})
    await assert.rejects(service.stop(), /cleanup_failed/); await reading
    await service.poll(); assert.equal(reads, 1)
    assert.throws(() => service.read(), /cleanup_failed/)
    assert.equal(service.state().errorCode, 'health_worker_cleanup_failed')
  } finally { await service.stop(); db.close() }
})
