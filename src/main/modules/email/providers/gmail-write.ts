import type { EmailAccount, EmailComposition, EmailWriteRequest } from '../../../../shared/types/email'
import type { EmailWriteScope } from '../contracts'
import type { EmailSdkTransport } from './sdk-transport'
import { composeGmailMessage, resolveEmailRecipients, validateEmailAttachments } from '../mime'
import { downloadEmailAttachment } from './download'
import { checkOriginalAttachmentBudget } from './attachment-budget'
import { normalizeEmailWriteRequest } from '../write-validation'
import { checkEmailAccount, string } from './read-common'
import { emailMutate, emailProviderRequest, emailWriteRef } from './write-common'

async function findDraft(account: EmailAccount, messageId: string, transport: EmailSdkTransport, scope: EmailWriteScope): Promise<string> {
  let cursor = '', total = 0
  const seen = new Set<string>()
  do {
    if (seen.has(cursor)) throw new Error('email_draft_lookup_limit')
    seen.add(cursor)
    const query = new URLSearchParams({ maxResults: '100', ...(cursor ? { pageToken: cursor } : {}) })
    const data = await emailProviderRequest(account, transport, 'GET', `/drafts?${query}`, undefined, scope)
    if (!Array.isArray(data.drafts)) throw new Error('email_draft_required')
    for (const draft of data.drafts) {
      if (++total > 1000) throw new Error('email_draft_lookup_limit')
      if (draft.message?.id === messageId && string(draft.id)) return draft.id
    }
    cursor = string(data.nextPageToken)
  } while (cursor)
  throw new Error('email_draft_required')
}
const header = (data: Record<string, any>, name: string) => string((Array.isArray(data.payload?.headers) ? data.payload.headers : []).find((item: any) => string(item.name).toLowerCase() === name)?.value).replace(/\r?\n[ \t]+/g, ' ')
export async function writeGmailEmail(account: EmailAccount, input: EmailWriteRequest, operationId: string, scope: EmailWriteScope, transport: EmailSdkTransport) {
  const request = normalizeEmailWriteRequest(input)
  checkEmailAccount(account, scope, request.type === 'draft_create' ? undefined : request.type === 'send' ? request.draftRef : request.ref)
  checkOriginalAttachmentBudget(request, scope)
  if (request.type === 'draft_create' || request.type === 'draft_update' || request.type === 'reply' || request.type === 'forward') {
    let composition: EmailComposition, reply: { inReplyTo?: string; references?: string[] } = {}, threadId: string | undefined
    if (request.type === 'draft_create' || request.type === 'draft_update') composition = { ...request.composition, accountId: account.id }
    else {
      const source = scope.source
      if (!source || source.summary.ref.accountId !== account.id || source.summary.ref.messageId !== request.ref.messageId) throw new Error('email_source_required')
      if (request.type === 'reply') {
        const metadata = await emailProviderRequest(account, transport, 'GET', `/messages/${encodeURIComponent(request.ref.messageId)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References`, undefined, scope)
        const originalId = header(metadata, 'message-id')
        if (!/^<[^\r\n\0<>\s]+@[^\r\n\0<>\s]+>$/.test(originalId)) throw new Error('email_reply_reference_required')
        reply = { inReplyTo: originalId, references: [...(header(metadata, 'references').match(/<[^\r\n<>\s]+@[^\r\n<>\s]+>/g) ?? []).slice(-19), originalId] }
        threadId = source.summary.threadId ?? undefined
        composition = { accountId: account.id, to: await resolveEmailRecipients(source.replyTo.length ? source.replyTo : [source.summary.from]), cc: [], bcc: [], subject: /^re:/i.test(source.summary.subject) ? source.summary.subject : `Re: ${source.summary.subject}`, text: request.text, attachmentHandles: [] }
      } else composition = { accountId: account.id, to: request.to, cc: [], bcc: [], subject: /^fwd?:/i.test(source.summary.subject) ? source.summary.subject : `Fwd: ${source.summary.subject}`, text: `${request.text}\n\n--- Mensagem encaminhada ---\nDe: ${source.summary.from}\nAssunto: ${source.summary.subject}\n\n${source.text}`, attachmentHandles: [] }
    }
    const attachments = [...scope.attachments]
    if ((request.type === 'draft_update' || request.type === 'forward') && scope.source) {
      let total = attachments.reduce((sum, item) => sum + item.bytes.byteLength, 0)
      if (attachments.length + scope.source.attachments.length > 10) throw new Error('email_attachment_limit')
      for (const info of scope.source.attachments) {
        if (info.ref.accountId !== account.id || info.ref.messageId !== request.ref.messageId) throw new Error('email_account_mismatch')
        const parts: Uint8Array[] = []
        for await (const chunk of downloadEmailAttachment(account, info, scope, transport)) {
          total += chunk.byteLength; if (total > 10485760) throw new Error('email_attachment_limit'); parts.push(chunk)
        }
        attachments.push({ name: info.name, contentType: info.contentType, bytes: Buffer.concat(parts) })
      }
    }
    validateEmailAttachments(attachments)
    const rfcMessageId = `<${operationId}@jasper.invalid>`, raw = await composeGmailMessage(composition, account, attachments, rfcMessageId, reply)
    const body = { message: { raw: Buffer.from(raw).toString('base64url'), ...(threadId ? { threadId } : {}) } }
    let created
    if (request.type === 'draft_update') {
      const draftId = await findDraft(account, request.ref.messageId, transport, scope)
      created = await emailMutate(account, transport, 'PUT', `/drafts/${encodeURIComponent(draftId)}`, body, scope, 'draft-update', { draftId, rfcMessageId })
    } else created = await emailMutate(account, transport, 'POST', '/drafts', body, scope, 'draft-create', { rfcMessageId })
    const draftId = string(created.id), draftRef = emailWriteRef(account, created.message?.id)
    if (!draftId) throw new Error('invalid_email_payload')
    if (request.type === 'draft_create' || request.type === 'draft_update') return { state: 'accepted' as const, providerRef: draftRef, correlation: { draftId, rfcMessageId } }
    const sent = await emailMutate(account, transport, 'POST', '/drafts/send', { id: draftId }, scope, 'draft-send', { draftId, rfcMessageId })
    return { state: 'accepted' as const, providerRef: emailWriteRef(account, sent.id), correlation: { draftId, rfcMessageId } }
  }
  if (request.type === 'send') {
    const draftId = await findDraft(account, request.draftRef.messageId, transport, scope)
    const metadata = await emailProviderRequest(account, transport, 'GET', `/messages/${encodeURIComponent(request.draftRef.messageId)}?format=metadata&metadataHeaders=Message-ID`, undefined, scope)
    const rfcMessageId = header(metadata, 'message-id')
    const data = await emailMutate(account, transport, 'POST', '/drafts/send', { id: draftId }, scope, 'draft-send', { draftId, rfcMessageId: rfcMessageId || null })
    return { state: 'accepted' as const, providerRef: emailWriteRef(account, data.id), correlation: { draftId, rfcMessageId: rfcMessageId || null } }
  }
  if (request.type !== 'organize') throw new Error('unsupported_email_action')
  let action = 'modify', body: Record<string, unknown>
  switch (request.action) {
    case 'read': body = { removeLabelIds: ['UNREAD'] }; break
    case 'unread': body = { addLabelIds: ['UNREAD'] }; break
    case 'archive': body = { removeLabelIds: ['INBOX'] }; break
    case 'move':
      if (request.destination?.kind !== 'label') throw new Error('unsupported_email_action')
      if (request.destination.id === 'TRASH') { action = 'trash'; body = {} }
      else body = { addLabelIds: [request.destination.id], ...(request.destination.id === 'INBOX' ? {} : { removeLabelIds: ['INBOX'] }) }
      break
    case 'labels': body = { addLabelIds: request.addLabelIds ?? [], removeLabelIds: request.removeLabelIds ?? [] }; break
    case 'trash': action = 'trash'; body = {}; break
    case 'restore': action = 'untrash'; body = {}; break
    default: throw new Error('unsupported_email_action')
  }
  await emailMutate(account, transport, 'POST', `/messages/${encodeURIComponent(request.ref.messageId)}/${action}`, body, scope, 'message-organize', { messageId: request.ref.messageId, action: request.action, destination: request.destination ?? null, ...body })
  return { state: 'accepted' as const, providerRef: request.ref, correlation: { messageId: request.ref.messageId, action: request.action, ...body } }
}
