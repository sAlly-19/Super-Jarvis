import type { EmailAccount, EmailAttachmentInfo, EmailConversation, EmailLocation, EmailMessage, EmailMessageRef, EmailQuery, EmailSummary, EmailWriteRequest, EmailOperation } from '../../../../shared/types/email'
import type { EmailScope, EmailWriteScope, EmailReconcileScope } from '../contracts'
import { writeOutlookEmail } from './outlook-write'
import { reconcileOutlookEmail } from './outlook-reconcile'
import { downloadEmailAttachment } from './download'
import type { EmailSdkTransport } from './sdk-transport'
import { normalizeEmailText } from '../message-text'
import { checkEmailAccount, date, payload, string, version, type EmailReadProvider } from './read-common'

type Factory = (account: EmailAccount) => EmailSdkTransport
const fields = 'id,conversationId,subject,from,toRecipients,ccRecipients,replyTo,receivedDateTime,isRead,body,hasAttachments'
const mailbox = (value: any): string => string(value?.emailAddress?.address)
const addresses = (value: unknown): string[] => Array.isArray(value) ? value.map(mailbox).filter(value => value && !/[\r\n\0]/.test(value)) : []
function summary(account: EmailAccount, data: Record<string, any>): EmailSummary {
  if (!string(data.id)) throw new Error('invalid_email_payload')
  return { ref: { accountId: account.id, messageId: data.id }, threadId: string(data.conversationId) || null, from: mailbox(data.from), subject: string(data.subject), receivedAt: date(data.receivedDateTime), unread: data.isRead === false }
}
export class OutlookEmailProvider implements EmailReadProvider {
  constructor(private readonly transport: Factory) {}
  download(account: EmailAccount, attachment: EmailAttachmentInfo, scope: EmailScope) { return downloadEmailAttachment(account, attachment, scope, this.transport(account)) }
  write(account: EmailAccount, request: EmailWriteRequest, operationId: string, scope: EmailWriteScope) { return writeOutlookEmail(account, request, operationId, scope, this.transport(account)) }
  reconcile(account: EmailAccount, operation: EmailOperation, scope: EmailReconcileScope) { return reconcileOutlookEmail(account, operation, scope, path => this.get(account, path, scope)) }
  private async get(account: EmailAccount, path: string, scope: EmailScope) {
    checkEmailAccount(account, scope)
    if (!path.startsWith('/me/')) {
      const url = new URL(path)
      if (url.origin !== 'https://graph.microsoft.com' || !url.pathname.startsWith('/v1.0/me/') || url.username || url.password) throw new Error('invalid_email_next_link')
    }
    const data = payload(await this.transport(account).request('GET', path, undefined, scope))
    checkEmailAccount(account, scope)
    return data
  }
  async search(account: EmailAccount, query: Omit<EmailQuery, 'cursor'>, providerCursor: string | null, scope: EmailScope) {
    const params = new URLSearchParams({ '$top': String(query.limit), '$select': 'id,conversationId,subject,from,receivedDateTime,isRead' })
    const terms: string[] = [], quote = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    for (const key of ['from', 'to', 'subject'] as const) if (query[key]) terms.push(`${key}:${quote(query[key]!)}`)
    if (query.text) terms.push(quote(query.text))
    const filters: string[] = []
    if (query.afterUtc) filters.push(`receivedDateTime ge ${query.afterUtc}`)
    if (query.beforeUtc) filters.push(`receivedDateTime lt ${query.beforeUtc}`)
    if (query.unread !== undefined) {
      if (!filters.length) filters.push('receivedDateTime ge 0001-01-01T00:00:00Z')
      filters.push(`isRead eq ${!query.unread}`)
    }
    // Graph rejects combinations that Gmail can support. Do not drop a filter.
    if (terms.length && filters.length) throw new Error('unsupported_email_query_combination')
    if (terms.length) params.set('$search', JSON.stringify(terms.join(' AND ')))
    else { if (filters.length) params.set('$filter', filters.join(' and ')); params.set('$orderby', 'receivedDateTime desc') }
    let root = '/me/messages'
    if (query.location) {
      if (query.location.accountId !== account.id || query.location.kind !== 'folder') throw new Error('email_account_mismatch')
      root = `/me/mailFolders/${encodeURIComponent(query.location.id)}/messages`
    }
    const data = await this.get(account, providerCursor || `${root}?${params}`, scope)
    if (!Array.isArray(data.value)) throw new Error('invalid_email_payload')
    return { items: data.value.slice(0, query.limit).map((message: any) => summary(account, payload(message))), cursor: string(data['@odata.nextLink']) || null }
  }
  async read(account: EmailAccount, ref: EmailMessageRef, scope: EmailScope) {
    checkEmailAccount(account, scope, ref)
    const query = new URLSearchParams({ '$select': fields, '$expand': 'attachments($select=id,name,contentType,size)' })
    const data = await this.get(account, `/me/messages/${encodeURIComponent(ref.messageId)}?${query}`, scope)
    if (data.id !== ref.messageId || (data.hasAttachments === true && !Array.isArray(data.attachments))) throw new Error('invalid_email_payload')
    const attachments: EmailAttachmentInfo[] = (Array.isArray(data.attachments) ? data.attachments : []).map((attachment: any) => {
      if (!string(attachment.id)) throw new Error('invalid_email_payload')
      return { ref, attachmentId: attachment.id, name: string(attachment.name) || 'anexo', contentType: string(attachment.contentType) || 'application/octet-stream', sizeBytes: Number.isSafeInteger(attachment.size) && attachment.size >= 0 ? attachment.size : null }
    })
    const content = string(data.body?.content), normalized = normalizeEmailText(string(data.body?.contentType).toLowerCase() === 'html' ? { html: content } : { text: content })
    const message: EmailMessage = { summary: summary(account, data), to: addresses(data.toRecipients), cc: addresses(data.ccRecipients), replyTo: addresses(data.replyTo), ...normalized, attachments }
    return { message, version: version(account.id, data) }
  }
  async conversation(account: EmailAccount, threadId: string, providerCursor: string | null, scope: EmailScope): Promise<EmailConversation> {
    const query = new URLSearchParams({ '$top': '5', '$filter': `conversationId eq '${threadId.replace(/'/g, "''")}'`, '$select': 'id,conversationId' })
    const data = await this.get(account, providerCursor || `/me/messages?${query}`, scope)
    if (!Array.isArray(data.value)) throw new Error('invalid_email_payload')
    const items = []
    for (const message of data.value.slice(0, 5)) {
      if (!string(message.id) || message.conversationId !== threadId) throw new Error('invalid_email_payload')
      items.push(await this.read(account, { accountId: account.id, messageId: message.id }, scope))
    }
    const nextCursor = string(data['@odata.nextLink']) || null
    return { accountId: account.id, threadId, items, nextCursor, truncated: nextCursor !== null }
  }
  async locations(account: EmailAccount, scope: EmailScope): Promise<EmailLocation[]> {
    const queue = [{ url: '/me/mailFolders?$top=100&$select=id,displayName,parentFolderId,childFolderCount', depth: 0 }], seen = new Set<string>(), ids = new Set<string>(), result: EmailLocation[] = []
    while (queue.length) {
      const current = queue.shift()!
      if (seen.has(current.url) || seen.size >= 1000 || current.depth > 32) throw new Error('email_locations_limit_exceeded')
      seen.add(current.url)
      const data = await this.get(account, current.url, scope)
      if (!Array.isArray(data.value)) throw new Error('invalid_email_payload')
      for (const folder of data.value) {
        if (!string(folder.id)) throw new Error('invalid_email_payload')
        if (ids.has(folder.id)) continue
        ids.add(folder.id); result.push({ accountId: account.id, id: folder.id, kind: 'folder', name: string(folder.displayName).slice(0, 1024) || folder.id, parentId: string(folder.parentFolderId) || null })
        if (result.length > 1000) throw new Error('email_locations_limit_exceeded')
        if (Number(folder.childFolderCount) > 0) queue.push({ url: `/me/mailFolders/${encodeURIComponent(folder.id)}/childFolders?$top=100&$select=id,displayName,parentFolderId,childFolderCount`, depth: current.depth + 1 })
      }
      if (data['@odata.nextLink']) queue.push({ url: string(data['@odata.nextLink']), depth: current.depth })
    }
    return result
  }
}
