import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ModuleRefreshQueue } from '../src/main/modules/refresh-queue'

test('a later refresh is not lost behind an acknowledgement for older module settings', async () => {
  const queue = new ModuleRefreshQueue()
  let enabled = false
  const snapshots: boolean[] = []
  let release!: () => void
  const first = queue.run(async () => { snapshots.push(enabled); await new Promise<void>(resolve => { release = resolve }) })
  await Promise.resolve()
  enabled = true
  const second = queue.run(async () => { snapshots.push(enabled) })
  release()
  await Promise.all([first, second])
  assert.deepEqual(snapshots, [false, true])
  await assert.rejects(queue.run(async () => { throw new Error('failed negotiation') }))
  await queue.run(async () => { snapshots.push(false) })
  assert.deepEqual(snapshots, [false, true, false])
})
