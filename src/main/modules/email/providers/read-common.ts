import { createHash } from 'node:crypto'
import type { EmailAccount, EmailMessageRef } from '../../../../shared/types/email'
import type { EmailProvider, EmailScope } from '../contracts'
export type EmailReadProvider = Pick<EmailProvider, 'search' | 'read' | 'conversation' | 'locations'>
export function checkEmailAccount(account: EmailAccount, scope: EmailScope, ref?: EmailMessageRef): void {
  scope.signal.throwIfAborted(); scope.check()
  if (account.status !== 'connected') throw new Error('email_account_unavailable')
  if (ref && ref.accountId !== account.id) throw new Error('email_account_mismatch')
}
export function payload(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Buffer.byteLength(JSON.stringify(value)) > 2097152) throw new Error('invalid_email_payload')
  return value as Record<string, any>
}
export const string = (value: unknown): string => typeof value === 'string' ? value : ''
export function date(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}
export function version(accountId: string, value: unknown): string { return createHash('sha256').update(accountId).update('\0').update(JSON.stringify(value)).digest('hex') }
export function decodeBase64url(value: unknown, charset = 'utf-8'): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*={0,2}$/.test(value) || value.replace(/=+$/, '').length % 4 === 1) throw new Error('invalid_email_payload')
  const bytes = Buffer.from(value, 'base64url')
  if (bytes.toString('base64url') !== value.replace(/=+$/, '')) throw new Error('invalid_email_payload')
  if (charset.length > 64) throw new Error('invalid_email_charset')
  try { return new TextDecoder(charset, { fatal: true }).decode(bytes) }
  catch { throw new Error('invalid_email_charset') }
}
