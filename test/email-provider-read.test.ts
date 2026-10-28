import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GmailEmailProvider } from '../src/main/modules/email/providers/gmail'
import { OutlookEmailProvider } from '../src/main/modules/email/providers/outlook'
import type { EmailScope } from '../src/main/modules/email/contracts'
import type { EmailAccount } from '../src/shared/types/email'
const scope: EmailScope = { context: { taskId: 't', stepId: 's', sessionId: 1, moduleRevision: 0, invocationId: 'i' }, signal: new AbortController().signal, check() {} }
const account: EmailAccount = { id: 'account-a', provider: 'gmail', subjectId: 'subject', tenantId: null, address: 'test@example.invalid', displayName: 'Synthetic', revision: 0, status: 'connected' }
test('Gmail reads bounded multipart text without interpreting attached text and rejects crossed accounts and invalid base64url', async () => {
  let data: any = { id: 'message', threadId: 'thread', internalDate: '1700000000000', labelIds: ['UNREAD'], payload: { headers: [{ name: 'From', value: 'Synthetic <test@example.invalid>' }], mimeType: 'multipart/mixed', parts: [
    { mimeType: 'text/plain', body: { data: Buffer.from('Olá').toString('base64url') } },
    { partId: '1', mimeType: 'text/plain', filename: 'private.txt', body: { attachmentId: 'attachment', size: 10, data: Buffer.from('not-body').toString('base64url') } }
  ] } }
  const provider = new GmailEmailProvider(() => ({ request: async () => data }))
  const read = await provider.read(account, { accountId: account.id, messageId: 'message' }, scope)
  assert.equal(read.message.text, 'Olá'); assert.equal(read.message.attachments[0].attachmentId, 'attachment')
  await assert.rejects(provider.read(account, { accountId: 'other', messageId: 'message' }, scope), /email_account_mismatch/)
  data = { ...data, payload: { mimeType: 'text/plain', body: { data: '!!invalid' } } }
  await assert.rejects(provider.read(account, { accountId: account.id, messageId: 'message' }, scope), /invalid_email_payload/)
})
test('Gmail conversation has five messages per page and query data cannot change request paths', async () => {
  const paths: string[] = []
  const provider = new GmailEmailProvider(() => ({ request: async (_method, url) => {
    paths.push(url)
    if (url.startsWith('/threads/')) return { id: 'thread', messages: Array.from({ length: 6 }, (_, i) => ({ id: String(i) })) }
    if (url.startsWith('/messages?')) return { messages: [], nextPageToken: null }
    const id = url.split('/').pop()!.split('?')[0]
    return { id, threadId: 'thread', payload: { mimeType: 'text/plain', body: { data: Buffer.from(id).toString('base64url') } } }
  } }))
  const first = await provider.conversation(account, 'thread', null, scope)
  assert.equal(first.items.length, 5); assert.ok(first.nextCursor)
  const second = await provider.conversation(account, 'thread', first.nextCursor, scope)
  assert.equal(second.items.length, 1); assert.equal(second.nextCursor, null)
  await provider.search(account, { limit: 50, subject: 'a" &label:secret' }, null, scope)
  assert.equal(new URL(paths.at(-1)!, 'https://fixture.invalid').pathname, '/messages')
})
test('Gmail reads declared legacy charset and a body held separately without misclassifying it as a user attachment', async () => {
  const calls: string[] = []
  const provider = new GmailEmailProvider(() => ({ request: async (_method, url) => {
    calls.push(url)
    if (url.includes('/attachments/')) return { data: Buffer.from([0x4f, 0x6c, 0xe1]).toString('base64url'), size: 3 }
    return { id: 'message', payload: { mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset="iso-8859-1"' }], body: { attachmentId: 'body-part', size: 3 } } }
  } }))
  const result = await provider.read(account, { accountId: account.id, messageId: 'message' }, scope)
  assert.equal(result.message.text, 'Olá')
  assert.equal(result.message.truncated, false)
  assert.deepEqual(result.message.attachments, [])
  assert.equal(calls.filter(path => path.includes('/attachments/body-part')).length, 1)
})
test('Gmail decodes an inline text body using its MIME charset rather than assuming UTF-8', async () => {
  const provider = new GmailEmailProvider(() => ({ request: async () => ({ id: 'message', payload: { mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset=iso-8859-1' }], body: { data: Buffer.from([79, 108, 225]).toString('base64url') } } }) }))
  assert.equal((await provider.read(account, { accountId: account.id, messageId: 'message' }, scope)).message.text, 'Olá')
})
test('Outlook preserves account origin and reports absent dates without inventing values', async () => {
  const provider = new OutlookEmailProvider(() => ({ request: async () => ({ id: 'message', conversationId: 'thread', subject: 'Synthetic', body: { contentType: 'html', content: '<p>Olá</p><script>run()</script>' }, from: { emailAddress: { address: 'test@example.invalid' } }, isRead: true }) }))
  const read = await provider.read({ ...account, provider: 'outlook' }, { accountId: account.id, messageId: 'message' }, scope)
  assert.equal(read.message.summary.ref.accountId, account.id)
  assert.equal(read.message.summary.receivedAt, null)
  assert.equal(read.message.text, 'Olá')
  assert.doesNotMatch(read.message.text, /run/)
})
test('Outlook encodes search clauses and places its ordered date property before other filters', async () => {
  const paths: string[] = []
  const provider = new OutlookEmailProvider(() => ({ request: async (_method, url) => { paths.push(url); return { value: [] } } }))
  const outlook = { ...account, provider: 'outlook' as const }
  await provider.search(outlook, { limit: 50, subject: 'Meeting notes' }, null, scope)
  const search = new URL(paths[0], 'https://fixture.invalid').searchParams.get('$search')!
  assert.equal(JSON.parse(search), 'subject:"Meeting notes"')
  await provider.search(outlook, { limit: 50, unread: true }, null, scope)
  const filter = new URL(paths[1], 'https://fixture.invalid').searchParams.get('$filter')!
  assert.match(filter, /^receivedDateTime ge .* and isRead eq false$/)
  await assert.rejects(provider.search(outlook, { limit: 50, text: 'query', unread: true }, null, scope), /unsupported_email_query_combination/)
})
