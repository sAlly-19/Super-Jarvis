import type { ExecutionContext } from '../../../shared/types/modules'
import type { EmailAccount, EmailAttachmentInfo, EmailConversation, EmailLocation, EmailMessage, EmailMessageRef, EmailOperation, EmailQuery, EmailSummary, EmailWriteRequest } from '../../../shared/types/email'
export interface VaultCrypto { available(): boolean; encrypt(text: string): Uint8Array; decrypt(bytes: Uint8Array): string }
export interface EmailScope { context: ExecutionContext; signal: AbortSignal; check(): void }
export interface PreparedEmailAttachment { name: string; contentType: string; bytes: Uint8Array }
export interface EmailWriteScope extends EmailScope {
  attachments: ReadonlyArray<PreparedEmailAttachment>
  source: EmailMessage | null
  checkpoint(leg: string, state: 'dispatching' | 'accepted' | 'observed' | 'rejected' | 'unknown', correlation?: unknown): Promise<void>
}
export interface EmailReconcileScope extends EmailScope { correlation: unknown }
export interface EmailProvider {
  search(account: EmailAccount, query: Omit<EmailQuery, 'cursor'>, providerCursor: string | null, scope: EmailScope): Promise<{ items: EmailSummary[]; cursor: string | null }>
  read(account: EmailAccount, ref: EmailMessageRef, scope: EmailScope): Promise<{ message: EmailMessage; version: string }>
  conversation(account: EmailAccount, threadId: string, providerCursor: string | null, scope: EmailScope): Promise<EmailConversation>
  locations(account: EmailAccount, scope: EmailScope): Promise<EmailLocation[]>
  write(account: EmailAccount, request: EmailWriteRequest, operationId: string, scope: EmailWriteScope): Promise<{ state: 'accepted' | 'observed' | 'rejected'; providerRef: EmailMessageRef | null; correlation: unknown }>
  reconcile(account: EmailAccount, operation: EmailOperation, scope: EmailReconcileScope): Promise<'observed' | 'unknown'>
  download(account: EmailAccount, attachment: EmailAttachmentInfo, scope: EmailScope): AsyncIterable<Uint8Array>
}
