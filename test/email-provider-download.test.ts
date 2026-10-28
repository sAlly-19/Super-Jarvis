import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GmailEmailProvider } from '../src/main/modules/email/providers/gmail'
import { OutlookEmailProvider } from '../src/main/modules/email/providers/outlook'
import type { EmailScope } from '../src/main/modules/email/contracts'
const scope: EmailScope = { context: { taskId: 't', stepId: 's', sessionId: 1, moduleRevision: 0, invocationId: 'i' }, signal: new AbortController().signal, check() {} }
test('email attachment providers retrieve bytes only from the exact account/message/file and enforce base64 size', async () => {
  for (const provider of ['gmail', 'outlook'] as const) {
    const calls: string[] = []; let mismatch = false
    const transport = { request: async (_method: string, url: string) => { calls.push(url); return provider === 'gmail' ? { size: 7, data: Buffer.from('fixture').toString('base64url') } : { '@odata.type': '#microsoft.graph.fileAttachment', id: 'file/id', size: 7, contentBytes: Buffer.from('fixture').toString('base64'), ...(mismatch ? { id: 'other' } : {}) } } }
    const instance = provider === 'gmail' ? new GmailEmailProvider(() => transport) : new OutlookEmailProvider(() => transport)
    const account = { id: 'a', provider, subjectId: 's', tenantId: null, address: 'fixture@example.invalid', displayName: 'Fixture', status: 'connected' as const, revision: 0 }
    const info = { ref: { accountId: 'a', messageId: 'message/id' }, attachmentId: 'file/id', name: 'fixture.bin', contentType: 'application/octet-stream', sizeBytes: 7 }
    const chunks: Uint8Array[] = []; for await (const chunk of instance.download(account, info, scope)) chunks.push(chunk)
    assert.equal(Buffer.concat(chunks).toString(), 'fixture'); assert.match(calls[0], /message%2Fid\/attachments\/file%2Fid/)
    const consume = async (value: typeof info) => { for await (const _chunk of instance.download(account, value, scope)) {} }
    await assert.rejects(consume({ ...info, ref: { ...info.ref, accountId: 'b' } }), /email_account_mismatch/)
    await assert.rejects(consume({ ...info, sizeBytes: 6 }), /email_attachment_size/)
    if (provider === 'outlook') { mismatch = true; await assert.rejects(consume(info), /invalid_email_attachment/) }
  }
})
test('email locations include human-readable names and parent references without changing input refs', async () => {
  const account = { id: 'a', provider: 'gmail' as const, subjectId: 's', tenantId: null, address: 'fixture@example.invalid', displayName: 'Fixture', status: 'connected' as const, revision: 0 }
  const gmail = new GmailEmailProvider(() => ({ request: async () => ({ labels: [{ id: 'label1', name: 'Projetos' }] }) }))
  assert.deepEqual(await gmail.locations(account, scope), [{ accountId: 'a', id: 'label1', kind: 'label', name: 'Projetos', parentId: null }])
  const outlook = new OutlookEmailProvider(() => ({ request: async () => ({ value: [{ id: 'folder1', displayName: 'Projetos', parentFolderId: 'root', childFolderCount: 0 }] }) }))
  assert.deepEqual(await outlook.locations({ ...account, provider: 'outlook' }, scope), [{ accountId: 'a', id: 'folder1', kind: 'folder', name: 'Projetos', parentId: 'root' }])
})
test('Gmail embedded attachment is read from its exact MIME part instead of sending a synthetic ID to the API', async () => {
  const account = { id: 'a', provider: 'gmail' as const, subjectId: 's', tenantId: null, address: 'fixture@example.invalid', displayName: 'Fixture', status: 'connected' as const, revision: 0 }
  const calls: string[] = []
  const provider = new GmailEmailProvider(() => ({ request: async (_method, url) => { calls.push(url); if (url.includes('/attachments/')) throw new Error('synthetic_attachment_id_not_remote'); return { id: 'm', payload: { mimeType: 'multipart/mixed', parts: [{ partId: '1', filename: 'fixture.txt', mimeType: 'text/plain', body: { size: 3, data: 'YWJj' } }] } } } }))
  const read = await provider.read(account, { accountId: 'a', messageId: 'm' }, scope)
  const chunks: Uint8Array[] = []
  for await (const chunk of provider.download(account, read.message.attachments[0], scope)) chunks.push(chunk)
  assert.equal(Buffer.concat(chunks).toString(), 'abc'); assert.equal(calls.length, 2); assert.ok(calls.every(url => url === '/messages/m?format=full'))
})
