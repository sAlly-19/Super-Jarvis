import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GmailEmailProvider } from '../src/main/modules/email/providers/gmail'
import { OutlookEmailProvider } from '../src/main/modules/email/providers/outlook'
import type { EmailWriteScope } from '../src/main/modules/email/contracts'
import type { EmailAccount } from '../src/shared/types/email'
const account: EmailAccount = { id: 'account', provider: 'gmail', subjectId: 'sub', tenantId: null, address: 'sender@example.invalid', displayName: 'Synthetic', status: 'connected', revision: 0 }
function scope() {
  const checkpoints: string[] = []
  const guarded: EmailWriteScope = { context: { taskId: 't', stepId: 's', invocationId: 'i', moduleRevision: 0, sessionId: 1 }, signal: new AbortController().signal, check() {}, attachments: [], source: null, checkpoint: async (leg, state) => { checkpoints.push(`${leg}:${state}`) } }
  return { guarded, checkpoints }
}
test('Gmail draft and send keep public message IDs distinct from private draft IDs and checkpoint each mutating request', async () => {
  const calls: Array<{ method: string; path: string; body: any }> = []
  const s = scope()
  const provider = new GmailEmailProvider(() => ({ request: async (method, path, body) => {
    calls.push({ method, path, body })
    if (method === 'POST' && path === '/drafts') { assert.equal(s.checkpoints.at(-1), 'draft-create:dispatching'); return { id: 'draft-id', message: { id: 'draft-message' } } }
    if (path.startsWith('/drafts?')) return { drafts: [{ id: 'draft-id', message: { id: 'draft-message' } }] }
    if (path.startsWith('/messages/')) return { id: 'draft-message', payload: { headers: [{ name: 'Message-ID', value: '<fixture@jasper.invalid>' }] } }
    if (path === '/drafts/send') { assert.equal((body as any).id, 'draft-id'); assert.equal(s.checkpoints.at(-1), 'draft-send:dispatching'); return { id: 'sent-message' } }
    throw new Error('Unexpected request')
  } }))
  const created = await provider.write(account, { type: 'draft_create', composition: { to: ['recipient@example.invalid'], cc: [], bcc: [], subject: 'Synthetic', text: 'Synthetic', attachmentHandles: [] } }, 'operation-create', s.guarded)
  assert.equal(created.providerRef!.messageId, 'draft-message')
  const sent = await provider.write(account, { type: 'send', draftRef: created.providerRef!, expectedVersion: 'v' }, 'operation-send', s.guarded)
  assert.equal(sent.providerRef!.messageId, 'sent-message')
  assert.equal(sent.state, 'accepted')
  assert.deepEqual(s.checkpoints, ['draft-create:dispatching', 'draft-create:accepted', 'draft-send:dispatching', 'draft-send:accepted'])
  assert.equal(calls.filter(call => call.path === '/drafts/send').length, 1)
})
test('Outlook submit returns acceptance, uses the original account and does not interpret HTTP acknowledgment as delivery', async () => {
  const s = scope(), paths: string[] = []
  s.guarded.source = { summary: { ref: { accountId: account.id, messageId: 'original' }, threadId: 'thread', from: 'author@example.invalid', subject: 'Synthetic', receivedAt: null, unread: false }, to: [], cc: [], replyTo: [], text: 'Original', truncated: false, attachments: [] }
  const provider = new OutlookEmailProvider(() => ({ request: async (method, path) => {
    paths.push(`${method} ${path}`)
    if (path.endsWith('/createReply')) return { id: 'reply-draft', isDraft: true }
    if (path.endsWith('/send')) return undefined
    throw new Error('Unexpected request')
  } }))
  const result = await provider.write({ ...account, provider: 'outlook' }, { type: 'reply', ref: { accountId: account.id, messageId: 'original' }, expectedVersion: 'v', text: 'Synthetic reply', to: [], attachmentHandles: [] }, 'operation-reply', s.guarded)
  assert.equal(result.state, 'accepted')
  assert.deepEqual(paths, ['POST /me/messages/original/createReply', 'POST /me/messages/reply-draft/send'])
  assert.equal(result.providerRef!.accountId, account.id)
})
test('email provider writes reject foreign account refs and unsupported organization without HTTP effects', async () => {
  let calls = 0
  const p = new GmailEmailProvider(() => ({ request: async () => { calls++; return {} } })), s = scope()
  await assert.rejects(p.write(account, { type: 'send', draftRef: { accountId: 'another', messageId: 'm' }, expectedVersion: 'v' }, 'op', s.guarded), /email_account_mismatch/)
  assert.equal(calls, 0)
})
test('Gmail replies do not copy or require downloading attachments from the original message', async () => {
  const s = scope()
  s.guarded.source = { summary: { ref: { accountId: account.id, messageId: 'original' }, threadId: 'thread', from: 'author@example.invalid', subject: 'Synthetic', receivedAt: null, unread: false }, to: [], cc: [], replyTo: [], text: 'Original', truncated: false, attachments: [{ ref: { accountId: account.id, messageId: 'original' }, attachmentId: 'pdf', name: 'document.pdf', contentType: 'application/pdf', sizeBytes: 100 }] }
  const provider = new GmailEmailProvider(() => ({ request: async (method, path) => {
    assert.ok(!path.includes('/attachments/'))
    if (method === 'GET') return { payload: { headers: [{ name: 'Message-ID', value: '<original@example.invalid>' }] } }
    if (path === '/drafts') return { id: 'draft', message: { id: 'draft-message' } }
    if (path === '/drafts/send') return { id: 'sent' }
    throw new Error('Unexpected request')
  } }))
  const result = await provider.write(account, { type: 'reply', ref: { accountId: account.id, messageId: 'original' }, expectedVersion: 'v', text: 'Reply', to: [], attachmentHandles: [] }, 'reply-op', s.guarded)
  assert.equal(result.state, 'accepted')
})
test('Gmail moving to Inbox does not remove Inbox again and moving to Trash uses the reversible trash action', async () => {
  const calls: Array<{ path: string; body: any }> = [], s = scope()
  const provider = new GmailEmailProvider(() => ({ request: async (_method, path, body) => { calls.push({ path, body }); return { id: 'message' } } }))
  await provider.write(account, { type: 'organize', ref: { accountId: account.id, messageId: 'message' }, expectedVersion: 'v', action: 'move', destination: { accountId: account.id, id: 'INBOX', kind: 'label' } }, 'move-inbox', s.guarded)
  assert.deepEqual(calls[0].body, { addLabelIds: ['INBOX'] })
  await provider.write(account, { type: 'organize', ref: { accountId: account.id, messageId: 'message' }, expectedVersion: 'v', action: 'move', destination: { accountId: account.id, id: 'TRASH', kind: 'label' } }, 'move-trash', s.guarded)
  assert.match(calls[1].path, /\/trash$/)
})
