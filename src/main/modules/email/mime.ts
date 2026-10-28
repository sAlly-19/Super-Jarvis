import { createTransport } from 'nodemailer'
import addressparser from 'nodemailer/lib/addressparser'
import type { EmailAccount, EmailComposition } from '../../../shared/types/email'
import type { PreparedEmailAttachment } from './contracts'
import { normalizeEmailWriteRequest } from './write-validation'

export async function resolveEmailRecipients(values: string[]): Promise<string[]> {
  if (!Array.isArray(values) || values.length > 50 || values.some(value => typeof value !== 'string' || !value || value.length > 8192 || /[\r\n\0]/.test(value))) throw new Error('invalid_email_recipient')
  const addresses = values.flatMap(value => addressparser(value, { flatten: true }).map(item => item.address))
  if (addresses.length > 50 || addresses.some(value => !value || value.length > 320 || !/^[^\r\n\0<>]+@[^@\s<>]+$/.test(value))) throw new Error('invalid_email_recipient')
  return addresses
}
export function validateEmailAttachments(attachments: ReadonlyArray<PreparedEmailAttachment>): void {
  if (attachments.length > 10) throw new Error('invalid_email_attachment')
  let size = 0
  for (const attachment of attachments) {
    if (typeof attachment.name !== 'string' || !attachment.name || attachment.name.length > 255 || /[\\/:\r\n\0]/.test(attachment.name) || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(attachment.contentType) || !(attachment.bytes instanceof Uint8Array)) throw new Error('invalid_email_attachment')
    size += attachment.bytes.byteLength
    if (size > 10485760) throw new Error('invalid_email_attachment')
  }
}
interface ReplyHeaders { inReplyTo?: string; references?: string[] }
export async function composeGmailMessage(composition: EmailComposition, account: EmailAccount, attachments: ReadonlyArray<PreparedEmailAttachment>, messageId: string, reply: ReplyHeaders = {}): Promise<Uint8Array> {
  normalizeEmailWriteRequest({ type: 'draft_create', composition })
  if ((composition.accountId !== undefined && composition.accountId !== account.id) || !/^<[A-Za-z0-9_.+-]+@[A-Za-z0-9.-]+>$/.test(messageId)) throw new Error('invalid_email_composition')
  validateEmailAttachments(attachments)
  for (const value of [reply.inReplyTo, ...(reply.references ?? [])]) if (value !== undefined && (!/^<[^\r\n\0<>\s]+@[^\r\n\0<>\s]+>$/.test(value) || value.length > 998)) throw new Error('invalid_email_reply_header')
  const [to, cc, bcc, from] = await Promise.all([resolveEmailRecipients(composition.to), resolveEmailRecipients(composition.cc), resolveEmailRecipients(composition.bcc), resolveEmailRecipients([account.address])])
  if (!to.length && !cc.length && !bcc.length || to.length + cc.length + bcc.length > 50 || from.length !== 1) throw new Error('invalid_email_recipient')
  const transport = createTransport({ streamTransport: true, buffer: true, newline: 'unix', disableFileAccess: true, disableUrlAccess: true })
  try {
    const result = await transport.sendMail({ from: { name: account.displayName, address: from[0] }, to, cc, bcc, subject: composition.subject, text: composition.text,
      messageId, inReplyTo: reply.inReplyTo, references: reply.references, disableFileAccess: true, disableUrlAccess: true,
      attachments: attachments.map(attachment => ({ filename: attachment.name, contentType: attachment.contentType, content: Buffer.from(attachment.bytes) })) })
    if (!Buffer.isBuffer(result.message) || result.message.byteLength > 35000000) throw new Error('email_mime_limit_exceeded')
    return result.message
  } finally { transport.close() }
}
