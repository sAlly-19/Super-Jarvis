import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SummaryReceipts } from '../src/main/modules/web-research/summary-receipts'
import type { ResearchHandle } from '../src/shared/types/web-research'
const context = { taskId: 'task', stepId: 'step', sessionId: 7, moduleRevision: 1, invocationId: 'invocation' }
const h: ResearchHandle = { id: '11111111-1111-4111-8111-111111111111', generation: 0, storage: 'saved' }
function setup() {
  let now = 1000, session = 7, allowed = true, present = true
  const writes: string[] = []
  const receipts = new SummaryReceipts({ now: () => now, currentSession: () => session,
    authorize: () => { if (!allowed) throw Error('revoked') }, contains: () => present,
    setSummary: (_handle, summary) => { writes.push(summary) } })
  return { receipts, writes, clock: (value: number) => { now = value }, session: (value: number) => { session = value },
    revoke: () => { allowed = false }, restore: () => { allowed = true }, remove: () => { present = false } }
}
test('summary receipt is opaque, session bound, exact and single use', () => {
  const s = setup(), receipt = s.receipts.issue(h, context)
  assert.match(receipt.ticket, /^[a-f0-9]{64}$/)
  const note = { researchId: h.id, ticket: receipt.ticket, sessionId: 7, summary: 'Summary' }
  for (const invalid of [{ ...note, ticket: '0'.repeat(64) }, { ...note, sessionId: 8 }, { ...note, extra: true }, { ...note, summary: 'x'.repeat(4001) }]) {
    assert.equal(s.receipts.accept(invalid, 7), false)
  }
  assert.equal(s.receipts.accept(note, 8), false)
  assert.equal(s.receipts.accept(note, 7), true)
  assert.equal(s.receipts.accept(note, 7), false)
  assert.deepEqual(s.writes, ['Summary'])
})
test('summary receipts reject expiry, clock rollback, disconnect, revocation, eviction and clear', () => {
  for (const mutate of [(s: ReturnType<typeof setup>) => s.clock(301000), (s: ReturnType<typeof setup>) => s.clock(999),
    (s: ReturnType<typeof setup>) => s.session(8), (s: ReturnType<typeof setup>) => s.revoke(), (s: ReturnType<typeof setup>) => s.remove()]) {
    const s = setup(), r = s.receipts.issue(h, context)
    mutate(s)
    assert.equal(s.receipts.accept({ ...r, summary: 'No', expiresAt: undefined }, 7), false)
    assert.equal(s.receipts.accept({ researchId: r.researchId, ticket: r.ticket, sessionId: r.sessionId, summary: 'No' }, 7), false)
    assert.equal(s.writes.length, 0)
  }
})
test('summary receipts cap at30, replace by research, invalidate and close permanently', () => {
  const s = setup(), first = s.receipts.issue(h, context)
  const accept = (r: typeof first) => s.receipts.accept({ researchId: r.researchId, ticket: r.ticket, sessionId: r.sessionId, summary: 'Text' }, 7)
  const replacement = s.receipts.issue(h, context)
  assert.equal(accept(first), false)
  for (let i = 2; i <= 31; i++) s.receipts.issue({ ...h, id: `${i.toString().padStart(8, '0')}-1111-4111-8111-111111111111` }, context)
  assert.equal(accept(replacement), false)
  const a = s.receipts.issue(h, context); s.receipts.invalidate(h.id); assert.equal(accept(a), false)
  const b = s.receipts.issue(h, context); s.receipts.invalidate(); assert.equal(accept(b), false)
  const c = s.receipts.issue(h, context); s.receipts.close(); assert.equal(accept(c), false)
  assert.throws(() => s.receipts.issue(h, context), /invalid_receipt/)
})
test('summary receipt is consumed before a failed storage write', () => {
  let writes = 0
  const s = new SummaryReceipts({ now: () => 1, currentSession: () => 7, authorize() {}, contains: () => true,
    setSummary() { writes++; throw Error('storage') } })
  const r = s.issue(h, context), note = { researchId: r.researchId, ticket: r.ticket, sessionId: 7, summary: 'Text' }
  assert.equal(s.accept(note, 7), false); assert.equal(s.accept(note, 7), false); assert.equal(writes, 1)
})

test('summary receipt rejected on revocation cannot revive after authorization is restored', () => {
  const s = setup(), r = s.receipts.issue(h, context)
  const note = { researchId: r.researchId, ticket: r.ticket, sessionId: r.sessionId, summary: 'Old note' }
  s.revoke(); assert.equal(s.receipts.accept(note, 7), false)
  s.restore(); assert.equal(s.receipts.accept(note, 7), false)
  assert.equal(s.writes.length, 0)
})
