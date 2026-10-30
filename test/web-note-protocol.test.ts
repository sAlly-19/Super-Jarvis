import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateWebNote } from '../src/main/modules/web-research/note-protocol'
import { encodeFrame, FrameDecoder } from '../src/main/services/backend-framing'
import { HOST_TO_SIDECAR_MESSAGE_TYPES, SIDECAR_TO_HOST_MESSAGE_TYPES } from '../src/shared/types/backend-protocol'
test('web note protocol is exact and only sidecar-to-host', () => {
  const note = { researchId: '11111111-1111-4111-8111-111111111111', ticket: 'a'.repeat(64), sessionId: 2, summary: 'Summary' }
  validateWebNote(note)
  for (const bad of [{ ...note, extra: true }, { ...note, sessionId: 1.5 }, { ...note, ticket: 'forged' }, { ...note, summary: 'x'.repeat(4001) }]) assert.throws(() => validateWebNote(bad))
  assert.ok(SIDECAR_TO_HOST_MESSAGE_TYPES.includes('web_research_note'))
  assert.equal((HOST_TO_SIDECAR_MESSAGE_TYPES as readonly string[]).includes('web_research_note'), false)
  const frame = { version: 1 as const, id: 'note', type: 'web_research_note' as const, payload: note }
  assert.deepEqual(new FrameDecoder().push(encodeFrame(frame)), [frame])
})
