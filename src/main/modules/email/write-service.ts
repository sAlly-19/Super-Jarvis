import type { EmailAccount, EmailOperation, EmailProviderId, EmailWriteRequest } from '../../../shared/types/email'
import type { EmailProvider, EmailScope, EmailWriteScope, PreparedEmailAttachment } from './contracts'
import type { EmailReadService } from './read-service'
import { EmailStore } from './store'
import { EmailOperationStore } from './operation-store'
import { EmailOperationCodec } from './operation-codec'
import { normalizeEmailWriteRequest } from './write-validation'
import { EmailRequestError } from './providers/sdk-transport'
import { EmailReconciliation } from './reconciliation'

type Provider = Pick<EmailProvider, 'write' | 'reconcile'>
interface Dependencies {
  authorize(scope: EmailScope): void
  attachments?(handles: string[], accountId: string, scope: EmailScope): Promise<ReadonlyArray<PreparedEmailAttachment>>
  cleanupTimeoutMs?: number
}
export class EmailWriteService {
  private readonly tails = new Map<string, Promise<unknown>>()
  private readonly active = new Map<AbortController, Promise<unknown>>()
  private closing: Promise<void> | null = null
  private unsafe = false
  constructor(private readonly accounts: EmailStore, private readonly operations: EmailOperationStore, private readonly codec: EmailOperationCodec,
    private readonly reads: Pick<EmailReadService, 'readVersion'>, private readonly providers: Partial<Record<EmailProviderId, Provider>>, private readonly deps: Dependencies) {}
  private run<T>(scope: EmailScope, work: (guarded: EmailScope) => Promise<T>): Promise<T> {
    const controller = new AbortController(), signal = AbortSignal.any([scope.signal, controller.signal])
    const timer = setTimeout(() => controller.abort(new Error('email_write_timeout')), 30000)
    const guarded: EmailScope = { ...scope, signal, check: () => {
      signal.throwIfAborted(); scope.check(); this.deps.authorize(scope)
      if (this.unsafe) throw new Error('email_write_cleanup_failed')
      if (this.closing) throw new Error('email_write_unavailable')
    } }
    const pending = Promise.resolve().then(async () => { guarded.check(); const result = await work(guarded); guarded.check(); return structuredClone(result) })
    this.active.set(controller, pending)
    const cleanup = () => { clearTimeout(timer); this.active.delete(controller) }
    void pending.then(cleanup, cleanup)
    return pending
  }
  private account(id: string | null): EmailAccount {
    const account = id ? this.accounts.getAccount(id) : null
    if (!account || account.status !== 'connected') throw new Error('email_account_unavailable')
    return account
  }
  private provider(account: EmailAccount): Provider { const provider = this.providers[account.provider]; if (!provider) throw new Error('email_oauth_not_configured'); return provider }
  private accountScope(account: EmailAccount, scope: EmailScope): EmailScope {
    return { ...scope, check: () => { scope.check(); const current = this.accounts.getAccount(account.id); if (current?.status !== 'connected' || current.revision !== account.revision) throw new Error('stale_email_account') } }
  }
  execute(input: EmailWriteRequest, scope: EmailScope): Promise<EmailOperation> {
    return this.run(scope, async guarded => {
      const request = normalizeEmailWriteRequest(input)
      const accountId = request.type === 'draft_create' ? request.composition.accountId ?? this.accounts.getPreferences().defaultAccountId : request.type === 'send' ? request.draftRef.accountId : request.ref.accountId
      const account = this.account(accountId), accountGuard = this.accountScope(account, guarded)
      const fingerprint = await this.codec.fingerprint({ request, accountId: account.id })
      accountGuard.check()
      const previous = this.tails.get(account.id) ?? Promise.resolve()
      const work = previous.catch(() => {}).then(async () => {
        accountGuard.check()
        const existing = this.operations.getByInvocation(scope.context.invocationId)
        if (existing) return this.operations.prepare(scope.context.invocationId, account.id, request.type, fingerprint, null)
        const source = request.type !== 'draft_create' ? await this.reads.readVersion(request.type === 'send' ? request.draftRef : request.ref, request.expectedVersion, accountGuard) : null
        accountGuard.check()
        const handles = request.type === 'draft_create' || request.type === 'draft_update' ? request.composition.attachmentHandles : request.type === 'reply' || request.type === 'forward' ? request.attachmentHandles : []
        if (handles.length && !this.deps.attachments) throw new Error('email_attachment_unavailable')
        const attachments = handles.length ? await this.deps.attachments!(handles, account.id, accountGuard) : []
        accountGuard.check()
        const attachmentLegs = account.provider === 'outlook' ? attachments.map((_, index) => `attachment-${index}`) : []
        const requiredLegs = request.type === 'draft_create' ? ['draft-create'] : request.type === 'draft_update' ? ['draft-update', ...attachmentLegs] : request.type === 'send' ? ['draft-send'] : request.type === 'reply' || request.type === 'forward' ? ['draft-create', ...attachmentLegs, 'draft-send'] : ['message-organize']
        const initial = { target: request.type === 'draft_create' ? null : request.type === 'send' ? request.draftRef : request.ref,
          action: request.type === 'organize' ? request.action : null, destination: request.type === 'organize' ? request.destination ?? null : null,
          addLabelIds: request.type === 'organize' ? request.addLabelIds ?? [] : [], removeLabelIds: request.type === 'organize' ? request.removeLabelIds ?? [] : [], requiredLegs, legs: {} }
        const sealed = await this.codec.seal(initial)
        accountGuard.check()
        let operation = this.operations.prepare(scope.context.invocationId, account.id, request.type, fingerprint, sealed)
        if (operation.state !== 'prepared') return operation
        operation = this.operations.transition(operation.id, 'prepared', 'dispatching')
        let dispatched = false, checkpointTail: Promise<void> = Promise.resolve()
        const writeScope: EmailWriteScope = { ...accountGuard, attachments, source, checkpoint: (leg, state, correlation = null) => {
          const pending = checkpointTail.then(async () => {
            if (state === 'dispatching') accountGuard.check()
            if (!requiredLegs.includes(leg)) throw new Error('invalid_email_leg_transition')
            const record = this.operations.privateRecord(operation.id)!
            const current = record.legs[leg]
            if (state === 'dispatching' ? current !== undefined : current !== 'dispatching' && !(current === 'accepted' && state === 'observed')) throw new Error('invalid_email_leg_transition')
            const details = record.sealedCorrelation ? await this.codec.open(record.sealedCorrelation) as Record<string, any> : initial
            const next = { ...details, legs: { ...(details.legs ?? {}), [leg]: correlation } }
            const encrypted = await this.codec.seal(next)
            if (state === 'dispatching') accountGuard.check()
            this.operations.updatePrivate(operation.id, record.revision, encrypted, { ...record.legs, [leg]: state })
            if (state === 'dispatching') dispatched = true
          })
          checkpointTail = pending; return pending
        } }
        try {
          const result = await this.provider(account).write(account, request, operation.id, writeScope)
          await checkpointTail
          if (result.state === 'accepted' && !dispatched) throw new Error('invalid_email_effect_receipt')
          const record = this.operations.privateRecord(operation.id)!
          if (result.state !== 'rejected' && requiredLegs.some(leg => !['accepted', 'observed'].includes(record.legs[leg]))) throw new Error('invalid_email_effect_receipt')
          if (result.state !== 'rejected' && dispatched && Object.values(record.legs).some(state => !['accepted', 'observed'].includes(state))) throw new Error('invalid_email_effect_receipt')
          const details = record.sealedCorrelation ? await this.codec.open(record.sealedCorrelation) as Record<string, unknown> : initial
          this.operations.updatePrivate(operation.id, record.revision, await this.codec.seal({ ...details, result: result.correlation }), record.legs)
          return this.operations.transition(operation.id, 'dispatching', result.state, result.providerRef, null)
        } catch (error) {
          await checkpointTail.catch(() => {})
          const current = this.operations.get(operation.id)!
          if (current.state !== 'dispatching') return current
          const definite = error instanceof EmailRequestError && [400, 401, 403, 404, 405, 409, 410, 411, 412, 413, 415, 422, 429].includes(error.status ?? 0)
          const created = ['accepted', 'observed'].includes(this.operations.privateRecord(operation.id)!.legs['draft-create'])
          const localCodes = ['email_draft_required', 'email_reply_reference_required', 'invalid_email_write', 'invalid_email_attachment', 'email_graph_attachment_limit', 'email_graph_request_limit', 'email_source_required', 'email_original_attachments_required', 'email_restore_destination_required', 'unsupported_email_action', 'invalid_email_recipient']
          const code = definite ? created ? 'email_send_rejected_after_draft_create' : error.code : !dispatched && error instanceof Error && localCodes.includes(error.message) ? error.message : dispatched ? 'email_effect_uncertain' : 'email_effect_not_dispatched'
          return this.operations.transition(operation.id, 'dispatching', definite || !dispatched ? 'rejected' : 'unknown', undefined, code)
        }
      })
      this.tails.set(account.id, work)
      const cleanup = () => { if (this.tails.get(account.id) === work) this.tails.delete(account.id) }
      void work.then(cleanup, cleanup)
      return work
    })
  }
  reconcile(operationId: string, scope: EmailScope): Promise<EmailOperation> {
    return this.run(scope, guarded => new EmailReconciliation(this.accounts, this.operations, this.codec, this.providers).check(operationId, guarded))
  }
  stop(): Promise<void> {
    if (this.closing) return this.closing
    const jobs = [...this.active]
    for (const [controller] of jobs) controller.abort(new Error('email_write_cancelled'))
    let timer: ReturnType<typeof setTimeout> | undefined
    this.closing = (async () => {
      try { await Promise.race([Promise.allSettled(jobs.map(([, work]) => work)), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('email_write_cleanup_failed')), this.deps.cleanupTimeoutMs ?? 1000) })]) }
      catch { this.unsafe = true; throw new Error('email_write_cleanup_failed') }
      finally { if (timer) clearTimeout(timer); this.closing = null }
    })()
    return this.closing
  }
}
