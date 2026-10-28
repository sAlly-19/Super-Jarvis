import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GmailEmailProvider } from '../src/main/modules/email/providers/gmail'
import { OutlookEmailProvider } from '../src/main/modules/email/providers/outlook'
import type { EmailReconcileScope } from '../src/main/modules/email/contracts'
import type { EmailAccount, EmailOperation } from '../src/shared/types/email'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EmailReconciliation } from '../src/main/modules/email/reconciliation'
import { EmailOperationStore } from '../src/main/modules/email/operation-store'
import { EmailOperationCodec } from '../src/main/modules/email/operation-codec'
import { EmailStore } from '../src/main/modules/email/store'
import { emailDatabase } from './fixtures/email/database'
const account: EmailAccount = { id: 'account', provider: 'gmail', subjectId: 'sub', tenantId: null, address: 'sender@example.invalid', displayName: 'Synthetic', status: 'connected', revision: 0 }
const operation: EmailOperation = { id: 'operation-id', accountId: account.id, invocationId: 'inv', kind: 'send', state: 'unknown', providerRef: null, errorCode: 'email_effect_uncertain', createdAt: '2026-10-28T00:00:00.000Z', updatedAt: '2026-10-28T00:00:00.000Z' }
const scope = (correlation: unknown): EmailReconcileScope => ({ context: { taskId: 't', stepId: 's', invocationId: 'i', sessionId: 1, moduleRevision: 0 }, signal: new AbortController().signal, check() {}, correlation })
test('Gmail reconciliation uses a strong known response ID and never subject/recipient coincidence or a repeated send', async () => {
  const calls: string[] = []
  const provider = new GmailEmailProvider(() => ({ request: async (method, path) => { assert.equal(method, 'GET'); calls.push(path); return { id: 'sent-id', labelIds: ['SENT'], payload: { headers: [{ name: 'Subject', value: 'Matching subject is insufficient' }] } } } }))
  assert.equal(await provider.reconcile(account, operation, scope({ target: { accountId: account.id, messageId: 'original' } })), 'unknown')
  assert.equal(calls.length, 0)
  assert.equal(await provider.reconcile(account, operation, scope({ legs: { 'draft-send': { messageId: 'sent-id' } } })), 'observed')
  assert.equal(calls.length, 1)
})
test('Outlook reconciliation requires the same immutable draft to be sent and never repeats a POST', async () => {
  let sent = false
  const provider = new OutlookEmailProvider(() => ({ request: async (method, path) => { assert.equal(method, 'GET'); assert.match(path, /draft-id/); return { id: 'draft-id', isDraft: !sent, sentDateTime: sent ? '2026-10-28T00:00:00Z' : null } } }))
  const guarded = scope({ legs: { 'draft-send': { draftId: 'draft-id' } } })
  assert.equal(await provider.reconcile({ ...account, provider: 'outlook' }, operation, guarded), 'unknown')
  sent = true
  assert.equal(await provider.reconcile({ ...account, provider: 'outlook' }, operation, guarded), 'observed')
})
test('Gmail reconciliation verifies the nonce header after search rather than trusting a result with a coincident subject', async () => {
  const provider = new GmailEmailProvider(() => ({ request: async (_method, path) => path.startsWith('/messages?') ? { messages: [{ id: 'unrelated' }] } : { id: 'unrelated', labelIds: ['SENT'], payload: { headers: [{ name: 'Message-ID', value: '<another@example.invalid>' }] } } }))
  assert.equal(await provider.reconcile(account, { ...operation, kind: 'reply' }, scope({})), 'unknown')
})
test('Gmail reconciliation cannot prove labels or a move from empty intent before the first request leg', async () => {
  let labels = ['INBOX']
  const provider = new GmailEmailProvider(() => ({ request: async () => ({ id: 'original', labelIds: labels }) }))
  const organizing = { ...operation, kind: 'organize' }
  assert.equal(await provider.reconcile(account, organizing, scope({ target: { accountId: account.id, messageId: 'original' }, action: 'labels' })), 'unknown')
  const intent = { target: { accountId: account.id, messageId: 'original' }, action: 'move', destination: { accountId: account.id, id: 'wanted', kind: 'label' } }
  assert.equal(await provider.reconcile(account, organizing, scope(intent)), 'unknown')
  labels = ['wanted']
  assert.equal(await provider.reconcile(account, organizing, scope(intent)), 'observed')
})
test('email reconciliation decrypts only private correlation and records proof without a mutation transport', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-email-reconcile-')), db = emailDatabase(), accounts = new EmailStore(db)
  let local = accounts.upsertIdentity({ provider: 'gmail', subjectId: 'fixture', tenantId: null, address: 'test@example.invalid', displayName: 'Synthetic' }, 'vault')
  local = accounts.setConnection(local.id, 'connected', local.revision)
  const operations = new EmailOperationStore(db), codec = new EmailOperationCodec(path.join(root, 'key.json'), { available: () => true, encrypt: text => Buffer.from(text).reverse(), decrypt: bytes => Buffer.from(bytes).reverse().toString() })
  try {
    const op = operations.prepare('inv-reconcile', local.id, 'send', 'a'.repeat(64), await codec.seal({ legs: { 'draft-send': { draftId: 'private-draft' } } }))
    operations.transition(op.id, 'prepared', 'dispatching'); operations.transition(op.id, 'dispatching', 'unknown')
    let reads = 0
    const reconciliation = new EmailReconciliation(accounts, operations, codec, { gmail: { reconcile: async (_account, _op, guarded) => { reads++; assert.equal((guarded.correlation as any).legs['draft-send'].draftId, 'private-draft'); return 'observed' } } })
    assert.equal((await reconciliation.check(op.id, scope(null))).state, 'observed')
    assert.equal((await reconciliation.check(op.id, scope(null))).state, 'observed')
    assert.equal(reads, 1)
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }) }
})
test('Outlook cannot prove a composite draft update until every planned attachment has an acceptance receipt', async () => {
  const provider = new OutlookEmailProvider(() => ({ request: async method => { assert.equal(method, 'GET'); return { id: 'draft', isDraft: true } } }))
  const update = { ...operation, kind: 'draft_update', providerRef: { accountId: account.id, messageId: 'draft' } }
  const correlation = { requiredLegs: ['draft-update', 'attachment-0', 'attachment-1'], legs: { 'draft-update': { draftId: 'draft' } }, legStates: { 'draft-update': 'accepted', 'attachment-0': 'accepted', 'attachment-1': 'dispatching' } }
  assert.equal(await provider.reconcile({ ...account, provider: 'outlook' }, update, scope(correlation)), 'unknown')
  assert.equal(await provider.reconcile({ ...account, provider: 'outlook' }, update, scope({ ...correlation, legStates: { 'draft-update': 'accepted' } })), 'unknown', 'crash before the attachment checkpoint must remain unknown')
  assert.equal(await provider.reconcile({ ...account, provider: 'outlook' }, update, scope({ ...correlation, legStates: { 'draft-update': 'accepted', 'attachment-0': 'accepted', 'attachment-1': 'accepted' } })), 'observed')
})
