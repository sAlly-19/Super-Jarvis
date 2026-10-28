import type { EmailAccount, EmailAttachmentInfo } from '../../../../shared/types/email'
import type { EmailScope } from '../contracts'
import { EMAIL_FILE_LIMIT } from '../desktop-files'
import { checkEmailAccount, payload } from './read-common'
import type { EmailSdkTransport } from './sdk-transport'
export async function* downloadEmailAttachment(account: EmailAccount, info: EmailAttachmentInfo, scope: EmailScope, transport: EmailSdkTransport): AsyncIterable<Uint8Array> {
  checkEmailAccount(account, scope, info.ref)
  if (!info.ref.messageId || !info.attachmentId || info.ref.messageId.length > 2048 || info.attachmentId.length > 2048) throw new Error('invalid_email_attachment')
  if (info.sizeBytes !== null && (!Number.isSafeInteger(info.sizeBytes) || info.sizeBytes < 0 || info.sizeBytes > EMAIL_FILE_LIMIT)) throw new Error('email_attachment_limit')
  const prefix = account.provider === 'gmail' ? '/messages/' : '/me/messages/'
  let raw: unknown
  if (account.provider === 'gmail' && info.attachmentId.startsWith('part:')) {
    const message = payload(await transport.request('GET', `/messages/${encodeURIComponent(info.ref.messageId)}?format=full`, undefined, scope))
    if (message.id !== info.ref.messageId) throw new Error('invalid_email_attachment')
    const matches: unknown[] = []; let visited = 0
    const walk = (part: any, depth: number) => {
      if (++visited > 1000 || depth > 32 || !part || typeof part !== 'object') throw new Error('invalid_email_attachment')
      const disposition = (Array.isArray(part.headers) ? part.headers : []).find((header: any) => typeof header?.name === 'string' && header.name.toLowerCase() === 'content-disposition')?.value
      const attached = !!part.filename || typeof disposition === 'string' && /^attachment(?:;|$)/i.test(disposition)
      if (attached && `part:${typeof part.partId === 'string' ? part.partId : ''}` === info.attachmentId && !part.body?.attachmentId) {
        if ((part.filename || 'anexo') !== info.name || (part.mimeType || 'application/octet-stream') !== info.contentType) throw new Error('invalid_email_attachment')
        matches.push(part.body)
      }
      if (Array.isArray(part.parts)) for (const child of part.parts) walk(child, depth + 1)
    }
    walk(message.payload, 0)
    if (matches.length !== 1) throw new Error('invalid_email_attachment')
    raw = matches[0]
  } else raw = await transport.request('GET', `${prefix}${encodeURIComponent(info.ref.messageId)}/attachments/${encodeURIComponent(info.attachmentId)}`, undefined, scope)
  checkEmailAccount(account, scope, info.ref)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid_email_attachment')
  const data = raw as Record<string, unknown>, gmail = account.provider === 'gmail'
  if (!gmail && (data.id !== info.attachmentId || data['@odata.type'] !== '#microsoft.graph.fileAttachment')) throw new Error('invalid_email_attachment')
  const encoded = gmail ? data.data : data.contentBytes
  if (typeof encoded !== 'string' || encoded.length > Math.ceil(EMAIL_FILE_LIMIT / 3) * 4 || !(gmail ? /^[A-Za-z0-9_-]*={0,2}$/ : /^[A-Za-z0-9+/]*={0,2}$/).test(encoded) || encoded.replace(/=+$/, '').length % 4 === 1) throw new Error('invalid_email_attachment')
  const encoding = gmail ? 'base64url' : 'base64', bytes = Buffer.from(encoded, encoding)
  if (bytes.toString(encoding).replace(/=+$/, '') !== encoded.replace(/=+$/, '')) throw new Error('invalid_email_attachment')
  if (bytes.length > EMAIL_FILE_LIMIT) throw new Error('email_attachment_limit')
  if (info.sizeBytes !== null && info.sizeBytes !== bytes.length || gmail && data.size !== undefined && data.size !== bytes.length) throw new Error('email_attachment_size')
  for (let offset = 0; offset < bytes.length; offset += 65536) { checkEmailAccount(account, scope, info.ref); yield bytes.subarray(offset, offset + 65536) }
  checkEmailAccount(account, scope, info.ref)
}
