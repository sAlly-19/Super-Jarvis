import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WebProofs } from '../src/main/modules/web-research/proofs'
import type { WebCapabilityData } from '../src/shared/types/web-research'
const context = { taskId: 't', stepId: 's', invocationId: 'i', sessionId: 1, moduleRevision: 0 }
test('web proof distinguishes observed empty, failed and partial content from factual truth or forged output', () => {
  let valid = true
  const proofs = new WebProofs(() => { if (!valid) throw Error('revoked') }, () => '2026-10-30T12:00:00Z')
  for (const state of ['empty', 'blocked', 'unavailable'] as const) {
    const data: WebCapabilityData = { kind: 'search', researchId: 'id', historyStorage: 'volatile', outcome: { state, query: 'Question', results: [], queriedAt: '2026-10-30T12:00:00Z' } }
    proofs.observe(context, 'web_search', data, () => {})
    const result = { status: 'unknown' as const, data, evidence: [] }
    assert.equal(proofs.verify(context, 'web_search', result).status, state === 'empty' ? 'succeeded' : 'failed')
    assert.equal(proofs.verify({ ...context, moduleRevision: 1 }, 'web_search', result).status, 'unknown')
  }
  const data: WebCapabilityData = { kind: 'read', researchId: 'id', historyStorage: 'volatile', outcome: { state: 'partial', page: null } }
  proofs.observe(context, 'web_read', data, () => {})
  const result = { status: 'unknown' as const, data, evidence: [] }
  assert.equal(proofs.verify(context, 'web_read', result).status, 'unknown')
  valid = false
  assert.equal(proofs.verify(context, 'web_read', result).evidence.length, 0)
})
