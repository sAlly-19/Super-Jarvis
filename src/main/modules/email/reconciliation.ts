import type { EmailOperation, EmailProviderId } from '../../../shared/types/email'
import type { EmailProvider, EmailScope } from './contracts'
import { EmailStore } from './store'
import { EmailOperationStore } from './operation-store'
import { EmailOperationCodec } from './operation-codec'

/** Receives only the provider's read-only reconciliation method, never write(). */
export class EmailReconciliation {
  constructor(private readonly accounts: EmailStore, private readonly operations: EmailOperationStore, private readonly codec: EmailOperationCodec,
    private readonly providers: Partial<Record<EmailProviderId, Pick<EmailProvider, 'reconcile'>>>) {}
  async check(operationId: string, scope: EmailScope): Promise<EmailOperation> {
    scope.check(); scope.signal.throwIfAborted()
    const operation = this.operations.get(operationId)
    if (!operation) throw new Error('email_operation_unavailable')
    const account = this.accounts.getAccount(operation.accountId)
    if (!account || account.status !== 'connected') throw new Error('email_account_unavailable')
    if (!['unknown', 'accepted'].includes(operation.state)) return operation
    const controller = new AbortController(), signal = AbortSignal.any([scope.signal, controller.signal])
    const timer = setTimeout(() => controller.abort(new Error('email_read_timeout')), 30000)
    const guarded: EmailScope = { ...scope, signal, check: () => {
      signal.throwIfAborted(); scope.check()
      const current = this.accounts.getAccount(account.id)
      if (current?.status !== 'connected' || current.revision !== account.revision) throw new Error('stale_email_account')
    } }
    try {
      const record = this.operations.privateRecord(operationId)!, saved = record.sealedCorrelation ? await this.codec.open(record.sealedCorrelation) : null
      const correlation = { ...(saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}), legStates: record.legs }
      guarded.check()
      const provider = this.providers[account.provider]
      if (!provider) throw new Error('email_oauth_not_configured')
      try {
        const result = await provider.reconcile(account, operation, { ...guarded, correlation })
        guarded.check()
        if (result === 'observed') {
          const current = this.operations.get(operationId)!
          if (current.state === 'observed') return current
          if (['unknown', 'accepted'].includes(current.state)) return this.operations.transition(operationId, current.state, 'observed', undefined, null)
        }
      } catch { guarded.check() }
      return this.operations.get(operationId)!
    } finally { clearTimeout(timer) }
  }
}
