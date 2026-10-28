import type { EmailAccount, EmailOperation } from '../../../../shared/types/email'
import type { EmailReconcileScope } from '../contracts'
import { checkEmailAccount, date, string } from './read-common'
type Get = (path: string) => Promise<Record<string, any>>
export async function reconcileOutlookEmail(account: EmailAccount, operation: EmailOperation, scope: EmailReconcileScope, get: Get): Promise<'observed' | 'unknown'> {
  checkEmailAccount(account, scope)
  if (operation.accountId !== account.id) throw new Error('email_account_mismatch')
  const details = scope.correlation && typeof scope.correlation === 'object' ? scope.correlation as Record<string, any> : {}, legs = details.legs ?? {}, sending = ['send', 'reply', 'forward'].includes(operation.kind)
  if (operation.kind === 'draft_update' || operation.kind === 'reply' || operation.kind === 'forward') {
    const planned = details.requiredLegs, states = details.legStates ?? {}
    if (!Array.isArray(planned) || !planned.length || planned.some((leg: unknown) => typeof leg !== 'string')) return 'unknown'
    const required = planned.filter((leg: string) => leg !== 'draft-send')
    if (operation.kind === 'draft_update' && !required.includes('draft-update')) return 'unknown'
    if (operation.kind !== 'draft_update' && !required.includes('draft-create')) return 'unknown'
    if (required.some((leg: string) => !['accepted', 'observed'].includes(states[leg]))) return 'unknown'
  }
  let id = string(sending ? legs['draft-send']?.draftId : legs['draft-create']?.messageId ?? legs['draft-update']?.messageId) || string(operation.providerRef?.messageId) || string(details.result?.draftId)
  if (operation.kind === 'organize') id = string(legs['message-organize']?.messageId) || string(operation.providerRef?.messageId) || string(details.target?.messageId)
  if (!id && operation.kind === 'draft_create') {
    const candidates = await get('/me/mailFolders/drafts/messages?$top=50&$select=id,isDraft,internetMessageHeaders')
    const matches = (Array.isArray(candidates.value) ? candidates.value : []).filter((item: any) => item.isDraft === true && Array.isArray(item.internetMessageHeaders) && item.internetMessageHeaders.some((header: any) => string(header.name).toLowerCase() === 'x-jasper-operation-id' && header.value === operation.id))
    if (matches.length === 1) id = string(matches[0].id)
  }
  if (!id) return 'unknown'
  const message = await get(`/me/messages/${encodeURIComponent(id)}?$select=id,isDraft,sentDateTime,parentFolderId,isRead,internetMessageHeaders`)
  if (message.id !== id) return 'unknown'
  if (sending) return message.isDraft === false && date(message.sentDateTime) !== null ? 'observed' : 'unknown'
  if (operation.kind === 'draft_create' || operation.kind === 'draft_update') return message.isDraft === true ? 'observed' : 'unknown'
  const intent = legs['message-organize'] ?? details.result ?? {}
  if (typeof intent.isRead === 'boolean') return message.isRead === intent.isRead ? 'observed' : 'unknown'
  if (string(intent.destinationId)) return message.parentFolderId === intent.destinationId ? 'observed' : 'unknown'
  return 'unknown'
}
