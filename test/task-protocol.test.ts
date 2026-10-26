import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeFrame, FrameDecoder } from '../src/main/services/backend-framing'
test('task protocol rejects private data, injected authority and invalid revisions', () => {
  const frame = (payload: unknown) => encodeFrame({ version: 1, id: 'event', type: 'task_event' as any, payload })
  const valid = { requestId: 'req', sessionId: 1, taskId: '', expectedRevision: 0, event: { type: 'open', origin: 'chat' } }
  assert.equal(new FrameDecoder().push(frame(valid))[0].type, 'task_event')
  assert.throws(() => frame({ ...valid, authorized: true }))
  assert.throws(() => frame({ ...valid, expectedRevision: -1 }))
  assert.throws(() => frame({ ...valid, event: { type: 'open', origin: 'chat', command: 'private' } }))
})
