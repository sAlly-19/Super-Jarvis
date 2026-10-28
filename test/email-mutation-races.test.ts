import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EmailWriteService } from '../src/main/modules/email/write-service'
import { EmailOperationStore } from '../src/main/modules/email/operation-store'
import { EmailOperationCodec } from '../src/main/modules/email/operation-codec'
import { EmailStore } from '../src/main/modules/email/store'
import { emailDatabase } from './fixtures/email/database'
import type { EmailScope } from '../src/main/modules/email/contracts'
import { EmailRequestError } from '../src/main/modules/email/providers/sdk-transport'
const scope = (invocationId = 'invocation-fixture'): EmailScope => ({ context: { taskId: 't', stepId: 's', sessionId: 1, moduleRevision: 0, invocationId }, signal: new AbortController().signal, check() {} })
function fixture(write: any, cryptoAvailable = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-email-write-')), db = emailDatabase(), accounts = new EmailStore(db)
  let account = accounts.upsertIdentity({ provider: 'gmail', subjectId: 'fixture', tenantId: null, address: 'test@example.invalid', displayName: 'Synthetic' }, 'vault')
  account = accounts.setConnection(account.id, 'connected', account.revision); accounts.setDefault(account.id, 0)
  const operations = new EmailOperationStore(db), codec = new EmailOperationCodec(path.join(root, 'key.json'), { available: () => cryptoAvailable, encrypt: text => Buffer.from(text).reverse(), decrypt: bytes => Buffer.from(bytes).reverse().toString() })
  const service = new EmailWriteService(accounts, operations, codec, { readVersion: async () => ({ summary: { ref: { accountId: account.id, messageId: 'message' }, from: 'sender@example.invalid', subject: 'Synthetic', threadId: 'thread', receivedAt: null, unread: false }, to: [], cc: [], replyTo: [], text: 'Synthetic', truncated: false, attachments: [] }) }, { gmail: { write, reconcile: async () => 'unknown' } }, { authorize() {} })
  return { service, account, operations, codec, db, close: async () => { await service.stop(); db.close(); fs.rmSync(root, { recursive: true, force: true }) } }
}
test('email write commits intent before dispatch, deduplicates an invocation and never repeats an uncertain send', async () => {
  let sends = 0
  const f = fixture(async (account: any, _request: any, operationId: string, guarded: any) => {
    assert.equal(f.operations.get(operationId)!.state, 'dispatching')
    await guarded.checkpoint('draft-send', 'dispatching', { draftId: 'opaque-draft' })
    sends++
    throw new Error('private network failure after server accepted')
  })
  try {
    const request = { type: 'send' as const, draftRef: { accountId: f.account.id, messageId: 'message' }, expectedVersion: 'version' }
    const result = await f.service.execute(request, scope())
    assert.equal(result.state, 'unknown')
    assert.equal((await f.service.execute(request, scope())).id, result.id)
    assert.equal(sends, 1)
    const raw = f.db.transaction(tx => tx.prepare('SELECT * FROM email_operations').all())
    assert.doesNotMatch(JSON.stringify(raw), /private network|sender@example/)
  } finally { await f.close() }
})
test('email write returns accepted rather than claiming delivery and records replies against the original account', async () => {
  let used = ''
  const f = fixture(async (account: any, _request: any, id: string, guarded: any) => {
    used = account.id
    const correlation = await f.codec.open(f.operations.privateRecord(id)!.sealedCorrelation!) as any
    assert.deepEqual(correlation.requiredLegs, ['draft-create', 'draft-send'], 'complete leg plan must precede the first effect')
    await guarded.checkpoint('draft-create', 'dispatching', { rfcMessageId: '<fixture@jasper.invalid>' })
    await guarded.checkpoint('draft-create', 'accepted', { messageId: 'message' })
    await guarded.checkpoint('draft-send', 'dispatching', { draftId: 'opaque' })
    await guarded.checkpoint('draft-send', 'accepted', { messageId: 'message' })
    return { state: 'accepted', providerRef: { accountId: account.id, messageId: 'message' }, correlation: { draftId: 'opaque' } }
  })
  try {
    const result = await f.service.execute({ type: 'reply', ref: { accountId: f.account.id, messageId: 'message' }, expectedVersion: 'version', text: 'Synthetic reply', to: [], attachmentHandles: [] }, scope())
    assert.equal(result.state, 'accepted'); assert.equal(used, f.account.id)
    assert.equal((await f.service.reconcile(result.id, scope())).state, 'accepted')
  } finally { await f.close() }
})
test('email write makes no request or diary record when protected fingerprint storage is unavailable', async () => {
  let sends = 0
  const f = fixture(async () => { sends++; throw new Error('unexpected') }, false)
  try {
    await assert.rejects(f.service.execute({ type: 'draft_create', composition: { to: ['recipient@example.invalid'], cc: [], bcc: [], subject: 'Synthetic', text: 'Synthetic', attachmentHandles: [] } }, scope()), /email_crypto_unavailable/)
    assert.equal(sends, 0)
    assert.equal(f.operations.getByInvocation('invocation-fixture'), null)
  } finally { await f.close() }
})
test('email write cannot claim acceptance while its dispatched leg still lacks an acceptance receipt', async () => {
  const f = fixture(async (account: any, _request: any, _operationId: string, guarded: any) => {
    await guarded.checkpoint('draft-send', 'dispatching', { draftId: 'opaque' })
    return { state: 'accepted', providerRef: { accountId: account.id, messageId: 'message' }, correlation: {} }
  })
  try {
    const result = await f.service.execute({ type: 'send', draftRef: { accountId: f.account.id, messageId: 'message' }, expectedVersion: 'v' }, scope())
    assert.equal(result.state, 'unknown')
  } finally { await f.close() }
})
test('email write reports a definite provider rejection instead of an unknown delivery', async () => {
  const f = fixture(async (_account: any, _request: any, _operationId: string, guarded: any) => {
    await guarded.checkpoint('draft-send', 'dispatching', { draftId: 'opaque' })
    throw new EmailRequestError('email_permission_denied', 403)
  })
  try {
    const result = await f.service.execute({ type: 'send', draftRef: { accountId: f.account.id, messageId: 'message' }, expectedVersion: 'v' }, scope())
    assert.equal(result.state, 'rejected')
    assert.equal(result.errorCode, 'email_permission_denied')
  } finally { await f.close() }
})
