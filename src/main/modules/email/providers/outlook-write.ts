import type { EmailAccount, EmailComposition, EmailWriteRequest } from '../../../../shared/types/email'
import type { EmailWriteScope, PreparedEmailAttachment } from '../contracts'
import type { EmailSdkTransport } from './sdk-transport'
import { resolveEmailRecipients, validateEmailAttachments } from '../mime'
import { normalizeEmailWriteRequest } from '../write-validation'
import { checkEmailAccount, string } from './read-common'
import { emailMutate, emailProviderRequest, emailWriteRef } from './write-common'
import { checkOriginalAttachmentBudget } from './attachment-budget'

function fileAttachments(attachments: ReadonlyArray<PreparedEmailAttachment>) {
  validateEmailAttachments(attachments)
  return attachments.map(attachment => {
    if (attachment.bytes.byteLength >= 3000000) throw new Error('email_graph_attachment_limit')
    return { '@odata.type': '#microsoft.graph.fileAttachment', name: attachment.name, contentType: attachment.contentType, contentBytes: Buffer.from(attachment.bytes).toString('base64') }
  })
}
async function compositionMessage(composition: EmailComposition) {
  const [to, cc, bcc] = await Promise.all([resolveEmailRecipients(composition.to), resolveEmailRecipients(composition.cc), resolveEmailRecipients(composition.bcc)])
  if (!to.length && !cc.length && !bcc.length || to.length + cc.length + bcc.length > 50) throw new Error('invalid_email_recipient')
  const recipients = (addresses: string[]) => addresses.map(address => ({ emailAddress: { address } }))
  return { subject: composition.subject, body: { contentType: 'Text', content: composition.text }, toRecipients: recipients(to), ccRecipients: recipients(cc), bccRecipients: recipients(bcc) }
}
function bounded(body: unknown): void { if (Buffer.byteLength(JSON.stringify(body)) > 4000000) throw new Error('email_graph_request_limit') }
async function addAttachments(account: EmailAccount, id: string, attachments: ReturnType<typeof fileAttachments>, scope: EmailWriteScope, transport: EmailSdkTransport) {
  for (let i = 0; i < attachments.length; i++) {
    bounded(attachments[i])
    await emailMutate(account, transport, 'POST', `/me/messages/${encodeURIComponent(id)}/attachments`, attachments[i], scope, `attachment-${i}`, { messageId: id })
  }
}
export async function writeOutlookEmail(account: EmailAccount, input: EmailWriteRequest, operationId: string, scope: EmailWriteScope, transport: EmailSdkTransport) {
  const request = normalizeEmailWriteRequest(input)
  checkEmailAccount(account, scope, request.type === 'draft_create' ? undefined : request.type === 'send' ? request.draftRef : request.ref)
  checkOriginalAttachmentBudget(request, scope)
  const attachments = fileAttachments(scope.attachments)
  if (request.type === 'draft_create') {
    const body = { ...await compositionMessage(request.composition), attachments, internetMessageHeaders: [{ name: 'x-jasper-operation-id', value: operationId }] }
    bounded(body)
    const data = await emailMutate(account, transport, 'POST', '/me/messages', body, scope, 'draft-create', { nonce: operationId })
    if (data.isDraft !== true) throw new Error('email_draft_required')
    return { state: 'accepted' as const, providerRef: emailWriteRef(account, data.id), correlation: { draftId: data.id, nonce: operationId } }
  }
  if (request.type === 'reply' || request.type === 'forward') {
    const source = scope.source
    if (!source || source.summary.ref.accountId !== account.id || source.summary.ref.messageId !== request.ref.messageId) throw new Error('email_source_required')
    if (request.type === 'forward' && source.attachments.length) {
      if (source.attachments.some(item => item.sizeBytes === null) || source.attachments.length + attachments.length > 10 || source.attachments.reduce((sum, item) => sum + item.sizeBytes!, 0) + scope.attachments.reduce((sum, item) => sum + item.bytes.byteLength, 0) > 10485760) throw new Error('email_forward_attachment_limit')
    }
    const body = request.type === 'reply' ? { comment: request.text } : { comment: request.text, message: { toRecipients: (await resolveEmailRecipients(request.to)).map(address => ({ emailAddress: { address } })) } }
    bounded(body)
    const endpoint = request.type === 'reply' ? 'createReply' : 'createForward'
    const data = await emailMutate(account, transport, 'POST', `/me/messages/${encodeURIComponent(request.ref.messageId)}/${endpoint}`, body, scope, 'draft-create', { sourceMessageId: request.ref.messageId })
    const ref = emailWriteRef(account, data.id)
    if (data.isDraft !== true) throw new Error('email_draft_required')
    await addAttachments(account, ref.messageId, attachments, scope, transport)
    await emailMutate(account, transport, 'POST', `/me/messages/${encodeURIComponent(ref.messageId)}/send`, {}, scope, 'draft-send', { draftId: ref.messageId })
    return { state: 'accepted' as const, providerRef: ref, correlation: { draftId: ref.messageId } }
  }
  if (request.type === 'send' || request.type === 'draft_update') {
    const ref = request.type === 'send' ? request.draftRef : request.ref
    const draft = await emailProviderRequest(account, transport, 'GET', `/me/messages/${encodeURIComponent(ref.messageId)}?$select=id,isDraft`, undefined, scope)
    if (draft.id !== ref.messageId || draft.isDraft !== true) throw new Error('email_draft_required')
    if (request.type === 'send') {
      await emailMutate(account, transport, 'POST', `/me/messages/${encodeURIComponent(ref.messageId)}/send`, {}, scope, 'draft-send', { draftId: ref.messageId })
      return { state: 'accepted' as const, providerRef: ref, correlation: { draftId: ref.messageId } }
    }
    const body = await compositionMessage(request.composition); bounded(body)
    await emailMutate(account, transport, 'PATCH', `/me/messages/${encodeURIComponent(ref.messageId)}`, body, scope, 'draft-update', { draftId: ref.messageId })
    await addAttachments(account, ref.messageId, attachments, scope, transport)
    return { state: 'accepted' as const, providerRef: ref, correlation: { draftId: ref.messageId } }
  }
  if (request.type !== 'organize') throw new Error('unsupported_email_action')
  const ref = request.ref
  if (request.action === 'labels') throw new Error('unsupported_email_action')
  if (request.action === 'read' || request.action === 'unread') {
    await emailMutate(account, transport, 'PATCH', `/me/messages/${encodeURIComponent(ref.messageId)}`, { isRead: request.action === 'read' }, scope, 'message-organize', { messageId: ref.messageId, isRead: request.action === 'read' })
    return { state: 'accepted' as const, providerRef: ref, correlation: { messageId: ref.messageId, isRead: request.action === 'read' } }
  }
  let destinationId: string
  if (request.action === 'move' || request.action === 'restore') {
    if (!request.destination || request.destination.kind !== 'folder') throw new Error(request.action === 'restore' ? 'email_restore_destination_required' : 'unsupported_email_action')
    destinationId = request.destination.id
  } else {
    const name = request.action === 'archive' ? 'archive' : request.action === 'trash' ? 'deleteditems' : ''
    if (!name) throw new Error('unsupported_email_action')
    const folder = await emailProviderRequest(account, transport, 'GET', `/me/mailFolders/${name}?$select=id`, undefined, scope)
    destinationId = string(folder.id)
    if (!destinationId) throw new Error('invalid_email_payload')
  }
  const data = await emailMutate(account, transport, 'POST', `/me/messages/${encodeURIComponent(ref.messageId)}/move`, { destinationId }, scope, 'message-organize', { messageId: ref.messageId, destinationId })
  return { state: 'accepted' as const, providerRef: emailWriteRef(account, data.id), correlation: { messageId: data.id, destinationId } }
}
