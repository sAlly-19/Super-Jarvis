import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeFrame, FrameDecoder } from '../src/main/services/backend-framing'
import type { BackendEnvelope } from '../src/shared/types/backend-protocol'

test('modular frames validate negotiation, correlation and strict payloads', () => {
  const snapshot = { version: 1, id: 'snapshot-1', type: 'module_snapshot', payload: {
    moduleRuntimeVersion: 1, snapshotVersion: 1, sessionId: 3, capabilities: []
  } } as BackendEnvelope
  assert.deepEqual(new FrameDecoder().push(encodeFrame(snapshot)), [snapshot])
  for (const payload of [
    { ...snapshot.payload as object, bypass: true },
    { moduleRuntimeVersion: 2, snapshotVersion: 1, sessionId: 3, capabilities: [] },
    { moduleRuntimeVersion: 1, snapshotVersion: -1, sessionId: 3, capabilities: [] }
  ]) assert.throws(() => encodeFrame({ ...snapshot, payload }))
  const request = { version: 1, id: 'request-1', type: 'capability_request', payload: {
    requestId: 'req-1', snapshotVersion: 1, capabilityId: 'run_powershell', args: { command: 'Get-Date' }
  } } as BackendEnvelope
  assert.deepEqual(new FrameDecoder().push(encodeFrame(request)), [request])
  assert.throws(() => encodeFrame({ ...request, payload: { ...(request.payload as object), context: { authorized: true } } }))
})
