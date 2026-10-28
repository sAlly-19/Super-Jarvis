import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EmailService } from '../src/main/modules/email/service'
import { EmailStore } from '../src/main/modules/email/store'
import { EmailOperationCodec } from '../src/main/modules/email/operation-codec'
import { emailDatabase } from './fixtures/email/database'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
test('email facade binds verified read output to account revision and never trusts forged output', async () => {
  const db = emailDatabase(), store = new EmailStore(db), root = await fs.mkdtemp(path.join(os.tmpdir(), 'jasper-email-routing-'))
  let account = store.upsertIdentity({ provider: 'gmail', subjectId: 's', tenantId: null, address: 'fixture@example.invalid', displayName: 'Fixture' }, 'vault')
  account = store.setConnection(account.id, 'connected', account.revision)
  let enabled = true
  const context = { taskId: 't', stepId: 's', sessionId: 1, moduleRevision: 0, invocationId: 'i' }
  const codec = new EmailOperationCodec(path.join(root, 'key.json'), { available: () => true, encrypt: text => Buffer.from(text).reverse(), decrypt: bytes => Buffer.from(bytes).reverse().toString() })
  const ref = { accountId: account.id, messageId: 'm' }
  const message = { summary: { ref, threadId: null, from: 'fixture@example.invalid', subject: 'Fixture', receivedAt: null, unread: false }, to: [], cc: [], replyTo: [], text: 'synthetic', truncated: false, attachments: [] }
  const reads: any = { read: async () => ({ message, version: 'v' }), search: async () => ({ items: [message.summary], nextCursor: null, queriedAccountIds: [account.id], failures: [], partial: false }), clear() {} }
  const writes: any = { execute: async () => ({ id: 'operation', invocationId: 'draft', accountId: account.id, kind: 'draft_create', state: 'accepted', providerRef: ref, errorCode: null, createdAt: '', updatedAt: '' }), stop: async () => {} }, attachments: any = { clear() {} }
  const service = new EmailService(store, reads, writes, attachments, codec, { authorize: () => { if (!enabled) throw new Error('module_unavailable') } })
  try {
    const result = await service.execute('email_read', { ref }, context, new AbortController().signal)
    assert.deepEqual((result as any).ref, ref); assert.equal((result as any).version, 'v')
    const search = await service.execute('email_search', { limit: 10 }, { ...context, invocationId: 'search' }, new AbortController().signal)
    assert.deepEqual((search as any).firstRef, ref)
    const draft = await service.execute('email_draft', { request: { type: 'draft_create', composition: { to: ['recipient@example.invalid'], cc: [], bcc: [], subject: 'Fixture', text: '', attachmentHandles: [] } } }, { ...context, invocationId: 'draft' }, new AbortController().signal)
    assert.deepEqual((draft as any).draftRef, ref); assert.equal((draft as any).operationId, 'operation')
    const proposed = { status: 'unknown' as const, data: result, evidence: [] }
    await assert.rejects(service.execute('email_download_attachment', { ref, attachmentId: 'file', destinationHandle: 'selected' }, { ...context, invocationId: 'download' }, new AbortController().signal), /email_download_unavailable/)
    assert.equal(service.verify(context, 'email_read', proposed).status, 'succeeded')
    assert.equal(service.verify(context, 'email_read', { ...proposed, data: { invented: true } }).status, 'unknown')
    store.setConnection(account.id, 'disconnected', account.revision)
    assert.equal(service.verify(context, 'email_read', proposed).status, 'unknown')
    enabled = false; await assert.rejects(service.execute('email_read', { ref }, context, new AbortController().signal), /module_unavailable/)
    enabled = true; await assert.rejects(service.execute('email_read', { ref, token: 'untrusted' }, context, new AbortController().signal), /invalid_email/)
  } finally { await service.stop(); db.close(); await fs.rm(root, { recursive: true, force: true }) }
})
