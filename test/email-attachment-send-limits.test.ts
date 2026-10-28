import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeOutlookEmail } from '../src/main/modules/email/providers/outlook-write'
import { writeGmailEmail } from '../src/main/modules/email/providers/gmail-write'
import type { EmailWriteScope } from '../src/main/modules/email/contracts'
test('existing draft send and Outlook draft update enforce original plus new attachment limits before mutations', async () => {
  for (const provider of ['gmail', 'outlook'] as const) for (const type of ['send', 'draft_update'] as const) {
    const ref = { accountId: 'a', messageId: 'm' }, account = { id: 'a', provider, subjectId: 's', tenantId: null, address: 'a@example.invalid', displayName: 'A', revision: 0, status: 'connected' as const }
    let mutations = 0
    const scope: EmailWriteScope = { context: { taskId: 't', stepId: 's', sessionId: 1, moduleRevision: 0, invocationId: 'i' }, signal: new AbortController().signal, check() {}, checkpoint: async () => {}, attachments: [{ name: 'new.bin', contentType: 'application/octet-stream', bytes: Buffer.alloc(1) }], source: { summary: { ref, threadId: null, from: '', subject: '', receivedAt: null, unread: false }, to: [], cc: [], replyTo: [], text: '', truncated: false, attachments: [{ ref, attachmentId: 'f', name: 'original.bin', contentType: 'application/octet-stream', sizeBytes: 10485760 }] } }
    if (type === 'send') scope.source!.attachments[0].sizeBytes = 10485761
    const transport = { request: async (method: string, url: string) => { if (method !== 'GET') mutations++; return url.startsWith('/drafts?') ? { drafts: [{ id: 'd', message: { id: 'm' } }] } : url.includes('/attachments/') ? { size: 10485760, data: Buffer.alloc(10485760).toString('base64url') } : { id: 'm', isDraft: true, message: { id: 'm' } } } }
    const request = type === 'send' ? { type, draftRef: ref, expectedVersion: 'v' } : { type, ref, expectedVersion: 'v', composition: { to: ['b@example.invalid'], cc: [], bcc: [], subject: '', text: '', attachmentHandles: [] } }
    await assert.rejects((provider === 'gmail' ? writeGmailEmail : writeOutlookEmail)(account, request, 'i', scope, transport), /email_attachment_limit/)
    assert.equal(mutations, 0)
  }
})
