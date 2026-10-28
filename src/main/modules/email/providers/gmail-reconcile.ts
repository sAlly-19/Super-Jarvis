import type { EmailAccount, EmailOperation } from '../../../../shared/types/email'
import type { EmailReconcileScope } from '../contracts'
import { checkEmailAccount, string } from './read-common'
type Get = (path: string) => Promise<Record<string, any>>
export async function reconcileGmailEmail(account: EmailAccount, operation: EmailOperation, scope: EmailReconcileScope, get: Get): Promise<'observed' | 'unknown'> {
  checkEmailAccount(account, scope)
  if (operation.accountId !== account.id) throw new Error('email_account_mismatch')
  const details = scope.correlation && typeof scope.correlation === 'object' ? scope.correlation as Record<string, any> : {}
  const legs = details.legs ?? {}, sending = ['send', 'reply', 'forward'].includes(operation.kind)
  let messageId = string(operation.providerRef?.messageId) || string(sending ? legs['draft-send']?.messageId : legs['draft-create']?.messageId ?? legs['draft-update']?.messageId)
  const ownNonce = `<${operation.id}@jasper.invalid>`
  let searchedNonce = false
  if (!messageId && ['draft_create', 'draft_update', 'reply', 'forward'].includes(operation.kind)) {
    const query = new URLSearchParams({ q: `rfc822msgid:"${ownNonce}"`, maxResults: '2' })
    const result = await get(`/messages?${query}`)
    if (!Array.isArray(result.messages) || result.messages.length !== 1 || !string(result.messages[0].id)) return 'unknown'
    messageId = result.messages[0].id
    searchedNonce = true
  }
  if (operation.kind === 'organize') messageId = string(legs['message-organize']?.messageId) || string(details.target?.messageId)
  if (!messageId) return 'unknown'
  const message = await get(`/messages/${encodeURIComponent(messageId)}?format=metadata&metadataHeaders=Message-ID`)
  if (message.id !== messageId || !Array.isArray(message.labelIds)) return 'unknown'
  if (searchedNonce && !(Array.isArray(message.payload?.headers) && message.payload.headers.some((header: any) => string(header.name).toLowerCase() === 'message-id' && header.value === ownNonce))) return 'unknown'
  const labels = message.labelIds as string[]
  if (sending) return labels.includes('SENT') ? 'observed' : 'unknown'
  if (operation.kind === 'draft_create' || operation.kind === 'draft_update') {
    if (!operation.providerRef && !string(legs['draft-create']?.messageId) && !string(legs['draft-update']?.messageId)) {
      const headers = Array.isArray(message.payload?.headers) ? message.payload.headers : []
      if (!headers.some((header: any) => string(header.name).toLowerCase() === 'message-id' && header.value === ownNonce)) return 'unknown'
    }
    return labels.includes('DRAFT') ? 'observed' : 'unknown'
  }
  const intent = legs['message-organize'] ?? details, action = string(intent.action || details.action)
  if (action === 'read') return !labels.includes('UNREAD') ? 'observed' : 'unknown'
  if (action === 'unread') return labels.includes('UNREAD') ? 'observed' : 'unknown'
  if (action === 'archive') return !labels.includes('INBOX') ? 'observed' : 'unknown'
  if (action === 'trash') return labels.includes('TRASH') ? 'observed' : 'unknown'
  if (action === 'restore') return !labels.includes('TRASH') ? 'observed' : 'unknown'
  if (action === 'move') {
    const destination = intent.destination ?? details.destination
    if (!destination || destination.accountId !== account.id || destination.kind !== 'label' || !string(destination.id)) return 'unknown'
    return labels.includes(destination.id) && (['INBOX', 'TRASH'].includes(destination.id) || !labels.includes('INBOX')) ? 'observed' : 'unknown'
  }
  if (action === 'labels') {
    if (!Array.isArray(intent.addLabelIds) || !Array.isArray(intent.removeLabelIds) || intent.addLabelIds.length + intent.removeLabelIds.length === 0) return 'unknown'
    const add = intent.addLabelIds as string[], remove = intent.removeLabelIds as string[]
    return add.every((id: string) => labels.includes(id)) && remove.every((id: string) => !labels.includes(id)) ? 'observed' : 'unknown'
  }
  return 'unknown'
}
