export type EmailProviderId = 'gmail' | 'outlook'
export interface EmailAccount {
  id: string; provider: EmailProviderId; subjectId: string; tenantId: string | null
  address: string; displayName: string; revision: number; status: 'connected' | 'reauth_required' | 'disconnected'
}
export interface EmailPreferences { defaultAccountId: string | null; revision: number }
export interface EmailPanelState {
  accounts: EmailAccount[]; preferences: EmailPreferences
  status: { health: 'healthy' | 'unavailable' | 'error'; errorCode?: string }
  providers: { gmail: boolean; outlook: boolean }
}
export interface EmailUploadTicket { handle: string; name: string; sizeBytes: number }
export interface EmailPublisherConfig {
  schemaVersion: 1
  google: { clientId: string; desktopClientSecret?: string } | null
  microsoft: { clientId: string; authority: 'https://login.microsoftonline.com/common' } | null
}
export interface EmailMessageRef { accountId: string; messageId: string }
export interface EmailLocationRef { accountId: string; id: string; kind: 'folder' | 'label' }
export interface EmailLocation extends EmailLocationRef { name: string; parentId: string | null }
export interface EmailQuery {
  accountIds?: string[]; from?: string; to?: string; subject?: string; text?: string; afterUtc?: string
  beforeUtc?: string; unread?: boolean; location?: EmailLocationRef; cursor?: string; limit: number
}
export interface EmailSummary { ref: EmailMessageRef; threadId: string | null; from: string; subject: string; receivedAt: string | null; unread: boolean }
export interface EmailPage { items: EmailSummary[]; nextCursor: string | null; queriedAccountIds: string[]; failures: Array<{ accountId: string; code: string }>; partial: boolean }
export interface EmailAttachmentInfo { ref: EmailMessageRef; attachmentId: string; name: string; contentType: string; sizeBytes: number | null }
export interface EmailMessage { summary: EmailSummary; to: string[]; cc: string[]; replyTo: string[]; text: string; truncated: boolean; attachments: EmailAttachmentInfo[] }
export interface EmailConversation { accountId: string; threadId: string; items: Array<{ message: EmailMessage; version: string }>; nextCursor: string | null; truncated: boolean }
export interface EmailComposition { accountId?: string; to: string[]; cc: string[]; bcc: string[]; subject: string; text: string; attachmentHandles: string[] }
export type EmailWriteRequest =
  | { type: 'draft_create'; composition: EmailComposition }
  | { type: 'draft_update'; ref: EmailMessageRef; expectedVersion: string; composition: EmailComposition }
  | { type: 'send'; draftRef: EmailMessageRef; expectedVersion: string }
  | { type: 'reply' | 'forward'; ref: EmailMessageRef; expectedVersion: string; text: string; to: string[]; attachmentHandles: string[] }
  | { type: 'organize'; ref: EmailMessageRef; expectedVersion: string; action: 'read' | 'unread' | 'archive' | 'move' | 'labels' | 'trash' | 'restore'; destination?: EmailLocationRef; addLabelIds?: string[]; removeLabelIds?: string[] }
export interface EmailOperation {
  id: string; invocationId: string; accountId: string; kind: string
  state: 'prepared' | 'dispatching' | 'accepted' | 'observed' | 'rejected' | 'unknown'
  providerRef: EmailMessageRef | null; errorCode: string | null; createdAt: string; updatedAt: string
}
export interface EmailBindings { ref?: EmailMessageRef; firstRef?: EmailMessageRef; version?: string; draftRef?: EmailMessageRef; operationId?: string; accountId?: string; threadId?: string }
export type EmailResult = EmailResultPayload & EmailBindings
export type EmailResultPayload =
  | { kind: 'read'; value: EmailPage | EmailConversation | { message: EmailMessage; version: string } | EmailLocation[] | EmailAttachmentInfo[] }
  | { kind: 'write'; operation: EmailOperation }
  | { kind: 'file'; receiptRef: string; name: string; sizeBytes: number }
