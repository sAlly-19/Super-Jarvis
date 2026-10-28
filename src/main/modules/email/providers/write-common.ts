import type { EmailAccount, EmailMessageRef } from '../../../../shared/types/email'
import type { EmailWriteScope } from '../contracts'
import type { EmailSdkTransport } from './sdk-transport'
import { checkEmailAccount, payload, string } from './read-common'
export async function emailProviderRequest(account: EmailAccount, transport: EmailSdkTransport, method: string, path: string, body: unknown, scope: EmailWriteScope): Promise<Record<string, any>> {
  checkEmailAccount(account, scope)
  const data = await transport.request(method, path, body, scope)
  checkEmailAccount(account, scope)
  return data === undefined ? {} : payload(data)
}
export async function emailMutate(account: EmailAccount, transport: EmailSdkTransport, method: string, path: string, body: unknown, scope: EmailWriteScope, leg: string, correlation: Record<string, unknown>): Promise<Record<string, any>> {
  await scope.checkpoint(leg, 'dispatching', correlation)
  const data = await emailProviderRequest(account, transport, method, path, body, scope)
  const messageId = string(data.message?.id) || string(data.id)
  await scope.checkpoint(leg, 'accepted', { ...correlation, ...(messageId ? { messageId } : {}) })
  return data
}
export function emailWriteRef(account: EmailAccount, id: unknown): EmailMessageRef {
  if (typeof id !== 'string' || !id || id.length > 2048) throw new Error('invalid_email_payload')
  return { accountId: account.id, messageId: id }
}
