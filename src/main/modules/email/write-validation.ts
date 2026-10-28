import type { EmailComposition, EmailMessageRef, EmailWriteRequest } from '../../../shared/types/email'
function fields(value: unknown, required: string[], optional: string[] = []): asserts value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => ![...required, ...optional].includes(key))) throw new Error('invalid_email_write')
}
function text(value: unknown, limit: number, multiline = false): value is string { return typeof value === 'string' && Buffer.byteLength(value) <= limit && !(multiline ? /\0/ : /[\r\n\0]/).test(value) }
function list(value: unknown, limit: number, length = 2048): asserts value is string[] { if (!Array.isArray(value) || value.length > limit || value.some(item => !text(item, length) || !item)) throw new Error('invalid_email_write') }
function ref(value: unknown): asserts value is EmailMessageRef { fields(value, ['accountId', 'messageId']); if (!text(value.accountId, 160) || !value.accountId || !text(value.messageId, 2048) || !value.messageId) throw new Error('invalid_email_write') }
function composition(value: unknown): asserts value is EmailComposition {
  fields(value, ['to', 'cc', 'bcc', 'subject', 'text', 'attachmentHandles'], ['accountId'])
  list(value.to, 50); list(value.cc, 50); list(value.bcc, 50); list(value.attachmentHandles, 10, 160)
  if (value.to.length + value.cc.length + value.bcc.length < 1 || value.to.length + value.cc.length + value.bcc.length > 50 || [...value.to, ...value.cc, ...value.bcc].some(item => !item.includes('@')) || typeof value.subject !== 'string' || value.subject.length > 998 || /[\r\n\0]/.test(value.subject) || !text(value.text, 102400, true) || (value.accountId !== undefined && (!text(value.accountId, 160) || !value.accountId))) throw new Error('invalid_email_write')
}
export function normalizeEmailWriteRequest(value: unknown): EmailWriteRequest {
  if (!value || typeof value !== 'object') throw new Error('invalid_email_write')
  const input = value as Record<string, any>
  switch (input.type) {
    case 'draft_create': fields(input, ['type', 'composition']); composition(input.composition); break
    case 'draft_update':
      fields(input, ['type', 'ref', 'expectedVersion', 'composition']); ref(input.ref); composition(input.composition)
      if (input.composition.accountId !== undefined && input.composition.accountId !== input.ref.accountId) throw new Error('email_account_mismatch')
      break
    case 'send': fields(input, ['type', 'draftRef', 'expectedVersion']); ref(input.draftRef); break
    case 'reply': case 'forward':
      fields(input, ['type', 'ref', 'expectedVersion', 'text', 'to', 'attachmentHandles']); ref(input.ref); list(input.to, 50); list(input.attachmentHandles, 10, 160)
      if (!text(input.text, 102400, true) || (input.type === 'reply' ? input.to.length !== 0 : !input.to.length) || input.to.some((address: string) => !address.includes('@'))) throw new Error('invalid_email_write')
      break
    case 'organize':
      fields(input, ['type', 'ref', 'expectedVersion', 'action'], ['destination', 'addLabelIds', 'removeLabelIds']); ref(input.ref)
      if (!['read', 'unread', 'archive', 'move', 'labels', 'trash', 'restore'].includes(input.action)) throw new Error('invalid_email_write')
      if (input.destination !== undefined) {
        fields(input.destination, ['accountId', 'id', 'kind'])
        if (input.destination.accountId !== input.ref.accountId || !text(input.destination.id, 2048) || !input.destination.id || !['folder', 'label'].includes(input.destination.kind)) throw new Error('email_account_mismatch')
      }
      if (input.action === 'move' && !input.destination) throw new Error('invalid_email_write')
      if (input.addLabelIds !== undefined) list(input.addLabelIds, 1000)
      if (input.removeLabelIds !== undefined) list(input.removeLabelIds, 1000)
      if (input.action !== 'labels' && (input.addLabelIds !== undefined || input.removeLabelIds !== undefined)) throw new Error('invalid_email_write')
      break
    default: throw new Error('invalid_email_write')
  }
  if (input.type !== 'draft_create' && (!text(input.expectedVersion, 160) || !input.expectedVersion)) throw new Error('invalid_email_write')
  return structuredClone(input) as EmailWriteRequest
}
