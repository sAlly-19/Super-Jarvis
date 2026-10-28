import type { EmailAccount, EmailAttachmentInfo, EmailConversation, EmailLocation, EmailMessage, EmailMessageRef, EmailQuery, EmailSummary, EmailWriteRequest, EmailOperation } from '../../../../shared/types/email'
import type { EmailScope, EmailWriteScope, EmailReconcileScope } from '../contracts'
import { writeGmailEmail } from './gmail-write'
import { reconcileGmailEmail } from './gmail-reconcile'
import { downloadEmailAttachment } from './download'
import type { EmailSdkTransport } from './sdk-transport'
import { normalizeEmailText } from '../message-text'
import { checkEmailAccount, payload, string, version, decodeBase64url, type EmailReadProvider } from './read-common'

type Factory = (account: EmailAccount) => EmailSdkTransport
function headers(data: Record<string, any>, name: string): string[] {
  return (Array.isArray(data.payload?.headers) ? data.payload.headers : []).filter((item: any) => typeof item?.name === 'string' && item.name.toLowerCase() === name).map((item: any) => string(item.value).replace(/\r?\n[ \t]+/g, ' ')).filter((value: string) => value.length <= 8192 && !/[\r\n\0]/.test(value))
}
function summary(account: EmailAccount, data: Record<string, any>): EmailSummary {
  if (!string(data.id)) throw new Error('invalid_email_payload')
  const timestamp = typeof data.internalDate === 'string' && data.internalDate ? Number(data.internalDate) : NaN
  return { ref: { accountId: account.id, messageId: data.id }, threadId: string(data.threadId) || null, from: headers(data, 'from')[0] ?? '', subject: headers(data, 'subject')[0] ?? '',
    receivedAt: Number.isFinite(timestamp) && Math.abs(timestamp) <= 8640000000000000 ? new Date(timestamp).toISOString() : null, unread: Array.isArray(data.labelIds) && data.labelIds.includes('UNREAD') }
}
export class GmailEmailProvider implements EmailReadProvider {
  constructor(private readonly transport: Factory) {}
  download(account: EmailAccount, attachment: EmailAttachmentInfo, scope: EmailScope) { return downloadEmailAttachment(account, attachment, scope, this.transport(account)) }
  write(account: EmailAccount, request: EmailWriteRequest, operationId: string, scope: EmailWriteScope) { return writeGmailEmail(account, request, operationId, scope, this.transport(account)) }
  reconcile(account: EmailAccount, operation: EmailOperation, scope: EmailReconcileScope) { return reconcileGmailEmail(account, operation, scope, path => this.get(account, path, scope)) }
  private async get(account: EmailAccount, path: string, scope: EmailScope) {
    checkEmailAccount(account, scope)
    const data = payload(await this.transport(account).request('GET', path, undefined, scope))
    checkEmailAccount(account, scope)
    return data
  }
  async search(account: EmailAccount, query: Omit<EmailQuery, 'cursor'>, providerCursor: string | null, scope: EmailScope) {
    const terms: string[] = [], quote = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    for (const key of ['from', 'to', 'subject'] as const) if (query[key]) terms.push(`${key}:${quote(query[key]!)}`)
    if (query.text) terms.push(quote(query.text))
    if (query.unread !== undefined) terms.push(query.unread ? 'is:unread' : 'is:read')
    if (query.afterUtc) terms.push(`after:${Math.floor(Date.parse(query.afterUtc) / 1000)}`)
    if (query.beforeUtc) terms.push(`before:${Math.floor(Date.parse(query.beforeUtc) / 1000)}`)
    const params = new URLSearchParams({ maxResults: String(query.limit), q: terms.join(' ') })
    if (providerCursor) params.set('pageToken', providerCursor)
    if (query.location) {
      if (query.location.accountId !== account.id || query.location.kind !== 'label') throw new Error('email_account_mismatch')
      params.set('labelIds', query.location.id)
    }
    const data = await this.get(account, `/messages?${params}`, scope), items: EmailSummary[] = []
    for (const message of (Array.isArray(data.messages) ? data.messages : []).slice(0, query.limit)) {
      const id = string(message?.id); if (!id) throw new Error('invalid_email_payload')
      const detail = await this.get(account, `/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`, scope)
      items.push(summary(account, detail))
    }
    return { items, cursor: string(data.nextPageToken) || null }
  }
  async read(account: EmailAccount, ref: EmailMessageRef, scope: EmailScope) {
    checkEmailAccount(account, scope, ref)
    const data = await this.get(account, `/messages/${encodeURIComponent(ref.messageId)}?format=full`, scope)
    if (data.id !== ref.messageId) throw new Error('invalid_email_payload')
    const plain: string[] = [], html: string[] = [], attachments: EmailAttachmentInfo[] = []
    let parts = 0, bodyBytes = 0, bodyTruncated = false
    const walk = async (part: any, depth: number): Promise<void> => {
      if (++parts > 1000 || depth > 32 || !part || typeof part !== 'object') throw new Error('invalid_email_payload')
      const name = string(part.filename), id = string(part.body?.attachmentId), disposition = (Array.isArray(part.headers) ? part.headers : []).find((header: any) => string(header?.name).toLowerCase() === 'content-disposition')
      const isText = ['text/plain', 'text/html'].includes(part.mimeType)
      if (name || (id && !isText) || /^attachment(?:;|$)/i.test(string(disposition?.value))) {
        attachments.push({ ref, attachmentId: id || `part:${string(part.partId)}`, name: name || 'anexo', contentType: string(part.mimeType) || 'application/octet-stream', sizeBytes: Number.isSafeInteger(part.body?.size) && part.body.size >= 0 ? part.body.size : null })
        return
      }
      if (isText && (part.body?.data !== undefined || id)) {
        if (bodyBytes >= 2097152) bodyTruncated = true
        else {
          // Gmail also stores large MIME body parts behind this endpoint. A
          // filename/disposition attachment above is never interpreted here.
          const raw = part.body?.data ?? (await this.get(account, `/messages/${encodeURIComponent(ref.messageId)}/attachments/${encodeURIComponent(id)}`, scope)).data
          const contentType = (Array.isArray(part.headers) ? part.headers : []).find((header: any) => string(header?.name).toLowerCase() === 'content-type')
          const charset = /(?:^|;)\s*charset\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(string(contentType?.value))
          const decoded = decodeBase64url(raw, charset?.[1] ?? charset?.[2] ?? 'utf-8')
          const bounded = normalizeEmailText({ text: decoded })
          bodyBytes += Buffer.byteLength(bounded.text)
          bodyTruncated ||= bounded.truncated
          ;(part.mimeType === 'text/plain' ? plain : html).push(bounded.text)
        }
      }
      if (Array.isArray(part.parts)) for (const child of part.parts) await walk(child, depth + 1)
    }
    if (data.payload) await walk(data.payload, 0)
    const normalized = normalizeEmailText(plain.length ? { text: plain.join('\n') } : { html: html.join('\n') })
    const message: EmailMessage = { summary: summary(account, data), to: headers(data, 'to'), cc: headers(data, 'cc'), replyTo: headers(data, 'reply-to'), ...normalized, truncated: normalized.truncated || bodyTruncated, attachments }
    return { message, version: version(account.id, data) }
  }
  async conversation(account: EmailAccount, threadId: string, providerCursor: string | null, scope: EmailScope): Promise<EmailConversation> {
    const thread = await this.get(account, `/threads/${encodeURIComponent(threadId)}?fields=id,messages(id)`, scope)
    if (thread.id !== threadId || !Array.isArray(thread.messages)) throw new Error('invalid_email_payload')
    const ids = thread.messages.map((message: any) => string(message?.id))
    if (ids.some((id: string) => !id)) throw new Error('invalid_email_payload')
    const hash = version(account.id, ids)
    let offset = 0
    if (providerCursor) {
      const cursor = payload(JSON.parse(Buffer.from(providerCursor, 'base64url').toString('utf8')))
      if (cursor.hash !== hash || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0 || cursor.offset > ids.length) throw new Error('email_cursor_stale')
      offset = cursor.offset
    }
    const items = []
    for (const id of ids.slice(offset, offset + 5)) items.push(await this.read(account, { accountId: account.id, messageId: id }, scope))
    const nextCursor = offset + 5 < ids.length ? Buffer.from(JSON.stringify({ hash, offset: offset + 5 })).toString('base64url') : null
    return { accountId: account.id, threadId, items, nextCursor, truncated: nextCursor !== null }
  }
  async locations(account: EmailAccount, scope: EmailScope): Promise<EmailLocation[]> {
    const data = await this.get(account, '/labels', scope)
    if (!Array.isArray(data.labels) || data.labels.length > 1000) throw new Error('email_locations_limit_exceeded')
    return data.labels.map((label: any) => { if (!string(label.id)) throw new Error('invalid_email_payload'); return { accountId: account.id, id: label.id, kind: 'label' as const, name: string(label.name).slice(0, 1024) || label.id, parentId: null } })
  }
}
