import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ModuleLifecycle } from '../src/main/modules/lifecycle'

test('stop immediately invalidates admission and exposes uncertain termination', async () => {
  const lifecycle = new ModuleLifecycle()
  let release!: () => void
  lifecycle.register('computer', async () => { await new Promise<void>(resolve => { release = resolve }); return { stopped: false, unknownInvocationIds: ['inv1'] } })
  const revision = lifecycle.generation('computer')
  const pending = lifecycle.stop('computer', 'disabled')
  assert.equal(lifecycle.isCurrent('computer', revision), false)
  release()
  assert.deepEqual(await pending, { stopped: false, unknownInvocationIds: ['inv1'] })
})

test('stop failures become structured uncertainty and still invalidate generation', async () => {
  const lifecycle = new ModuleLifecycle()
  lifecycle.register('computer', async () => { throw new Error('secret diagnostic') })
  const report = await lifecycle.stop('computer', 'license_locked')
  assert.equal(report.stopped, false)
  assert.equal(report.errorCode, 'module_stop_failed')
  assert.equal(JSON.stringify(report).includes('secret'), false)
})
