import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EmailProofs } from '../src/main/modules/email/proofs'
const context = { taskId: 't', stepId: 's', sessionId: 1, moduleRevision: 0, invocationId: 'i' }
test('email proof binds Main observations to context and data without promoting uncertain sends to success', () => {
  let allowed = true
  const proofs = new EmailProofs({ authorize() { if (!allowed) throw new Error('denied') } })
  const data: any = { kind: 'write', operation: { id: 'op', accountId: 'account', state: 'accepted' } }
  proofs.observe(context, 'email_send', 'a'.repeat(64), data, 'email_write')
  const result = { status: 'unknown' as const, data, evidence: [] }
  assert.equal(proofs.verify(context, 'email_send', result).status, 'succeeded')
  assert.equal(proofs.verify({ ...context, sessionId: 2 }, 'email_send', result).status, 'unknown')
  assert.equal(proofs.verify(context, 'email_send', { ...result, data: { ...data, operation: { ...data.operation, id: 'forged' } } }).status, 'unknown')
  allowed = false; assert.equal(proofs.verify(context, 'email_send', result).status, 'unknown')
  allowed = true; proofs.release('i'); assert.equal(proofs.verify(context, 'email_send', result).status, 'unknown')
  data.operation.state = 'unknown'
  proofs.observe(context, 'email_send', 'b'.repeat(64), data, 'email_write')
  assert.equal(proofs.verify(context, 'email_send', { ...result, data }).status, 'unknown')
  assert.deepEqual(proofs.verify(context, 'email_send', { ...result, data }).evidence, [])
  proofs.clear()
})
