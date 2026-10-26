import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { ModuleStore } from '../src/main/modules/store'
import { ModuleLifecycle } from '../src/main/modules/lifecycle'
import { ModuleService } from '../src/main/modules/service'

test('service persists disable before cancellation and never enables unavailable modules', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-module-service-'))
  try {
    const store = new ModuleStore(path.join(root, 'modules.json'), 'device')
    const lifecycle = new ModuleLifecycle()
    const service = new ModuleService(store, lifecycle, () => {})
    let release!: () => void
    lifecycle.register('computer', async () => { await new Promise<void>(resolve => { release = resolve }); return { stopped: true, unknownInvocationIds: [] } })
    assert.equal(service.getSnapshot('computer').lifecycle, 'running')
    const stopping = service.setEnabled('computer', false, 0)
    assert.equal(service.getSnapshot('computer').enabled, false)
    assert.equal(service.getSnapshot('computer').lifecycle, 'stopping')
    await assert.rejects(service.setEnabled('computer', true, 1), /stopping/)
    release()
    assert.equal((await stopping).lifecycle, 'stopped')
    await assert.rejects(service.setEnabled('email', true, 0), /not_implemented/)
    assert.equal(service.getSnapshot('email').enabled, false)
    assert.equal(service.list().length, 11)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
