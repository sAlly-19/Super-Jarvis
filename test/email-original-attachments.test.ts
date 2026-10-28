import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeGmailEmail } from '../src/main/modules/email/providers/gmail-write'
import type { EmailWriteScope } from '../src/main/modules/email/contracts'
const account = { id: 'a', provider: 'gmail' as const, subjectId: 's', tenantId: null, address: 'a@example.invalid', displayName: 'A', revision: 0, status: 'connected' as const }
test('Gmail forward and draft update preserve original attachment bytes before any mutation', async () => {
  for (const type of ['forward', 'draft_update'] as const) {
    let mime = '', downloads = 0, mutations = 0
    const ref = { accountId: 'a', messageId: 'original' }
    const source = { summary: { ref, threadId: null, from: 'b@example.invalid', subject: 'Fixture', receivedAt: null, unread: false }, text: 'fixture', to: [], cc: [], replyTo: [], truncated: false, attachments: [{ ref, attachmentId: 'file', name: 'original.txt', contentType: 'text/plain', sizeBytes: 13 }] }
    const scope: EmailWriteScope = { context: { taskId: 't', stepId: 's', sessionId: 1, moduleRevision: 0, invocationId: 'i' }, signal: new AbortController().signal, check() {}, source, attachments: [], checkpoint: async () => {} }
    const transport = { request: async (method: string, url: string, body?: any) => {
      if (url.includes('/attachments/')) { downloads++; assert.equal(mutations, 0); return { size: 13, data: Buffer.from('original-data').toString('base64url') } }
      if (method === 'GET') return { drafts: [{ id: 'draft', message: { id: 'original' } }] }
      mutations++; if (body.message?.raw) mime = Buffer.from(body.message.raw, 'base64url').toString()
      return url === '/drafts/send' ? { id: 'sent' } : { id: 'draft', message: { id: 'updated' } }
    } }
    const request = type === 'forward' ? { type, ref, expectedVersion: 'v', text: 'Forward', to: ['c@example.invalid'], attachmentHandles: [] } : { type, ref, expectedVersion: 'v', composition: { to: ['c@example.invalid'], cc: [], bcc: [], subject: 'Update', text: 'Update', attachmentHandles: [] } }
    await writeGmailEmail(account, request, 'operation', scope, transport)
    assert.equal(downloads, 1); assert.match(mime, /original\.txt/); assert.match(mime, /b3JpZ2luYWwtZGF0YQ==/)
  }
})
