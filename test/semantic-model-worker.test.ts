import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { SemanticModelClient } from '../src/main/memory/semantic/model-client'
import { handleModelRequest } from '../src/main/memory/semantic/model-protocol'
import { modelFingerprint } from '../src/main/memory/semantic/model-manifest-validator'
import { SEMANTIC_MODEL_MANIFEST } from '../src/main/memory/semantic/model-manifest'

const fingerprint = modelFingerprint(SEMANTIC_MODEL_MANIFEST)
const scope = (controller = new AbortController(), ms = 1000) => ({ signal: controller.signal, deadline: Date.now() + ms, check() { controller.signal.throwIfAborted() } })
class Child extends EventEmitter {
  sent: any[] = []; killed = false
  postMessage(message: unknown) { this.sent.push(message) }
  kill() { this.killed = true; queueMicrotask(() => this.emit('exit', 0)); return true }
}
const make = () => {
  const child = new Child()
  const client = new SemanticModelClient('unused-worker', 'unused-model-root', () => { queueMicrotask(() => child.emit('spawn')); return child })
  return { client, child }
}
const tick = () => new Promise(resolve => setImmediate(resolve))
const reply = (child: Child, values: unknown, type = 'result') => {
  const request = child.sent.at(-1)
  child.emit('message', { id: request.id, type, modelFingerprint: fingerprint, [type === 'result' ? 'vectors' : 'counts']: values })
}
test('semantic worker client validates vectors and uses the same worker for token counts', async () => {
  const { client, child } = make()
  const promise = client.embed(['texto'], scope()); await tick()
  reply(child, [Array.from({ length: 384 }, (_, i) => i === 0 ? 1 : 0)])
  assert.equal((await promise)[0].length, 384)
  const counts = client.count(['texto'], scope()); await tick(); reply(child, [3], 'counts')
  assert.deepEqual(await counts, [3]); await client.stop(); assert.equal(child.killed, true)
})
test('semantic worker rejects malformed, nonfinite, unnormalized and wrong-fingerprint results', async () => {
  for (const vector of [[], Array(383).fill(1), Array(384).fill(0), Array(384).fill(NaN), Array(384).fill(Infinity), Array(384).fill(1)]) {
    const { client, child } = make(); const promise = client.embed(['x'], scope())
    const rejected = assert.rejects(promise, /model_protocol_error/)
    await tick(); reply(child, [vector]); await rejected; await client.stop()
  }
  const { client, child } = make(); const promise = client.count(['x'], scope())
  const rejected = assert.rejects(promise, /model_protocol_error/); await tick()
  child.emit('message', { ...child.sent[0], type: 'counts', counts: [2], modelFingerprint: 'a'.repeat(64) })
  await rejected; await client.stop()
})
test('semantic worker queue has four waiting slots, rejects stale messages and stop settles every job', async () => {
  const { client, child } = make()
  const pending = Array.from({ length: 5 }, () => client.embed(['x'], scope()))
  const settled = Promise.allSettled(pending)
  await assert.rejects(client.embed(['overflow'], scope()), /model_queue_full/)
  await tick()
  child.emit('message', { id: 'previous-process', type: 'result', vectors: [Array(384).fill(0)], modelFingerprint: fingerprint })
  assert.equal(child.sent.length, 1)
  await client.stop()
  assert.ok((await settled).every(item => item.status === 'rejected'))
  await assert.rejects(client.embed(['late'], scope()), /model_stopped/)
})
test('semantic worker deadline includes waiting and cancellation kills active work without late delivery', async () => {
  const { client, child } = make()
  const active = client.embed(['active'], scope()); const cancelled = assert.rejects(active, /model_cancelled|model_stopped/)
  const queued = client.embed(['queued'], scope(new AbortController(), 15))
  await assert.rejects(queued, /model_timeout/)
  await client.stop(); await cancelled; assert.equal(child.killed, true)
  const second = make(), controller = new AbortController()
  const job = second.client.embed(['x'], scope(controller)); const rejected = assert.rejects(job, /model_cancelled/)
  await tick(); controller.abort(); await rejected; await second.client.stop()
})
test('semantic worker closes request schema and reports missing local model without exposing error details', async () => {
  let calls = 0
  const operations = { async embed() { calls++; throw new Error('private path or URL') }, async count() { calls++; return [2] } }
  const base = { id: 'job-1', type: 'embed', texts: ['x'], modelFingerprint: fingerprint }
  assert.equal((await handleModelRequest(base, operations)).type, 'error')
  for (const input of [{ ...base, url: 'https://evil.invalid' }, { ...base, texts: Array(9).fill('x') }, { ...base, texts: ['x'.repeat(17000)] }, { ...base, modelFingerprint: 'wrong' }, { ...base, type: 'exec' }]) {
    assert.equal((await handleModelRequest(input, operations)).type, 'error')
  }
  assert.equal(calls, 1)
  const response = await handleModelRequest(base, { ...operations, async embed() { throw new Error('model_not_prepared') } })
  assert.deepEqual(response, { id: 'job-1', type: 'error', code: 'model_not_prepared', modelFingerprint: fingerprint })
})
