import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ModelPreparation } from '../src/main/memory/semantic/model-preparation'
import type { PreparationFiles } from '../src/main/memory/semantic/model-preparation'
test('semantic lifecycle verifies cache without downloading, reports tamper and requires explicit prepare after failure', async () => {
  let intact = true, probes = 0, downloads = 0
  const files: PreparationFiles = { async verify() { return intact }, async location() { return 'private-root' },
    async createStaging() { throw Error('unexpected download') }, async writer() { throw Error('unexpected writer') },
    async verifyStaging() { return false }, async publish() { throw Error('unexpected publish') }, async discard() {} }
  const preparation = new ModelPreparation(files, { async download() { downloads++ } }, async () => { probes++ })
  assert.equal((await preparation.verifyLocal()).phase, 'ready'); assert.equal(probes, 1)
  intact = false
  assert.equal((await preparation.verifyLocal()).phase, 'not_prepared'); assert.equal(downloads, 0)
  await preparation.stop(); await assert.rejects(preparation.verifyLocal(), /model_stopped/)
})
test('semantic lifecycle keeps a shared download authorized when only one consumer cancels', async () => {
  let unblock!: () => void, calls = 0
  const barrier = new Promise<void>(resolve => { unblock = resolve })
  const files: PreparationFiles = { async verify() { await barrier; return true }, async location() { return 'private-root' },
    async createStaging() { throw Error('unexpected') }, async writer() { throw Error('unexpected') }, async verifyStaging() { return false }, async publish() {}, async discard() {} }
  const prep = new ModelPreparation(files, { async download() { throw Error('unexpected') } }, async () => { calls++ })
  const first = new AbortController(), second = new AbortController()
  const scope = (c: AbortController) => ({ signal: c.signal, deadline: Date.now() + 2000, check() {} })
  const a = prep.prepare(scope(first)), b = prep.prepare(scope(second))
  const rejected = assert.rejects(a, /model_cancelled/); first.abort(); await rejected
  unblock(); await b; assert.equal(calls, 1); assert.equal(prep.state().phase, 'ready'); await prep.stop()
})
test('semantic local verification coalesces and shutdown aborts and awaits hash or probe cleanup', async () => {
  for (const stage of ['hash', 'probe']) {
    let entered!: () => void, cleanup!: () => void, observed: AbortSignal | undefined, calls = 0
    const started = new Promise<void>(resolve => { entered = resolve })
    const released = new Promise<void>(resolve => { cleanup = resolve })
    const block = async (s: { signal: AbortSignal }) => { calls++; observed = s.signal; entered(); await released; s.signal.throwIfAborted() }
    const files: PreparationFiles = { async verify(s) { if (stage === 'hash') await block(s); return true }, async location() { return 'private-root' },
      async createStaging() { throw Error('unexpected') }, async writer() { throw Error('unexpected') }, async verifyStaging() { return false }, async publish() {}, async discard() {} }
    const prep = new ModelPreparation(files, { async download() { throw Error('unexpected') } }, async (_root, s) => { if (stage === 'probe') await block(s) })
    const a = prep.verifyLocal(), b = prep.verifyLocal()
    const settled = Promise.allSettled([a, b]); await started
    let stopped = false
    const stopping = prep.stop().then(() => { stopped = true })
    await new Promise(resolve => setImmediate(resolve))
    const aborted = observed?.aborted, returnedEarly = stopped, numberOfCalls = calls
    cleanup(); await stopping; await settled
    assert.equal(aborted, true, `${stage} did not receive cancellation`)
    assert.equal(returnedEarly, false, `${stage} stop returned before cleanup`)
    assert.equal(numberOfCalls, 1, `${stage} was started twice`)
    assert.notEqual(prep.state().phase, 'ready')
  }
})
