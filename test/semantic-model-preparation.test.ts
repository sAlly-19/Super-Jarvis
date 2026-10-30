import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ModelPreparation } from '../src/main/memory/semantic/model-preparation'
const scope = (controller = new AbortController()) => ({ signal: controller.signal, deadline: Date.now() + 2000, check() {} })
function fixture() {
  let valid = false, published = 0, discarded = 0, fetched = 0
  const files = { async verify() { return valid }, async createStaging() { return 'private-staging' }, async writer() { return new (await import('node:stream')).Writable({ write(_chunk, _encoding, cb) { cb() } }) },
    async verifyStaging() { return true }, async publish(_stage: string, s: ReturnType<typeof scope>) { s.check(); s.signal.throwIfAborted(); valid = true; published++ }, async discard() { discarded++ }, async location() { return 'private-model' } }
  const transport = { async download(_a: unknown, _r: string, _d: unknown, s: ReturnType<typeof scope>, bytes: (n: number) => void) { fetched++; s.signal.throwIfAborted(); bytes(1) } }
  const preparation = new ModelPreparation(files, transport, async (_root, s) => { s.signal.throwIfAborted() })
  return { files, preparation, transport, get counts() { return { published, discarded, fetched } } }
}
test('semantic preparation coalesces downloads, verifies before publication and reuses valid cache without network', async () => {
  const f = fixture()
  assert.equal(f.preparation.state().phase, 'not_prepared')
  await Promise.all([f.preparation.prepare(scope()), f.preparation.prepare(scope())])
  assert.equal(f.counts.fetched, 5); assert.equal(f.counts.published, 1)
  assert.equal(f.preparation.state().phase, 'ready')
  await f.preparation.prepare(scope()); assert.equal(f.counts.fetched, 5)
  await f.preparation.stop()
})
test('semantic preparation cancellation or failed verification never publishes late readiness', async () => {
  for (const mode of ['cancel', 'verify', 'probe']) {
    const f = fixture()
    if (mode === 'verify') f.files.verifyStaging = async () => false
    if (mode === 'cancel') f.transport.download = async () => { await f.preparation.cancel() }
    const preparation = mode === 'probe' ? new ModelPreparation(f.files, f.transport, async () => { throw Error('native_failure_private_path') }) : f.preparation
    await assert.rejects(preparation.prepare(scope()))
    assert.notEqual(preparation.state().phase, 'ready'); assert.equal(f.counts.published, 0)
    assert.ok(!JSON.stringify(preparation.state()).includes('private_path'))
    await preparation.stop()
  }
})
test('semantic preparation stop and per-consumer cancellation discard late results', async () => {
  const f = fixture(), controller = new AbortController()
  controller.abort(); await assert.rejects(f.preparation.prepare(scope(controller)))
  assert.equal(f.counts.fetched, 0)
  await f.preparation.stop(); await assert.rejects(f.preparation.prepare(scope()), /model_stopped/)
})
