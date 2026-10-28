import type { CapabilityResult, ExecutionContext } from '../../../shared/types/modules'
import type { EmailQuery, EmailResult, EmailWriteRequest, EmailMessageRef } from '../../../shared/types/email'
import type { EmailScope } from './contracts'
import type { EmailReadService } from './read-service'
import type { EmailWriteService } from './write-service'
import type { EmailAttachments } from './attachments'
import type { EmailOperationCodec } from './operation-codec'
import { EmailStore } from './store'
import { EmailProofs } from './proofs'
const reads = new Set(['email_search', 'email_read', 'email_conversation', 'email_locations', 'email_attachments'])
function object(value: unknown, required: string[], optional: string[] = []): asserts value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || required.some(key => !(key in value)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) throw new Error('invalid_email_request')
}
function text(value: unknown, max = 2048): asserts value is string { if (typeof value !== 'string' || !value || value.length > max || /[\x00-\x1f]/.test(value)) throw new Error('invalid_email_request') }
function ref(value: unknown): asserts value is EmailMessageRef { object(value, ['accountId', 'messageId']); text(value.accountId, 160); text(value.messageId) }
export class EmailService {
  private readonly proofs: EmailProofs
  private generation = 0
  constructor(private readonly accounts: EmailStore, private readonly read: EmailReadService, private readonly write: EmailWriteService,
    private readonly files: EmailAttachments, private readonly codec: EmailOperationCodec, private readonly deps: { authorize(context: ExecutionContext, id: string): void }) {
    this.proofs = new EmailProofs({ authorize: (context, id) => this.deps.authorize(context, id) })
  }
  async execute(id: string, input: unknown, context: ExecutionContext, signal: AbortSignal): Promise<EmailResult> {
    const generation = this.generation
    const check = () => { signal.throwIfAborted(); this.deps.authorize(context, id); if (generation !== this.generation) throw new Error('email_unavailable') }
    check()
    const scope: EmailScope = { context, signal, check }
    const snapshots = new Map(this.accounts.listAccounts().map(account => [account.id, account]))
    let result: EmailResult
    switch (id) {
      case 'email_search': object(input, ['limit'], ['accountIds', 'from', 'to', 'subject', 'text', 'afterUtc', 'beforeUtc', 'unread', 'location', 'cursor']); result = { kind: 'read', value: await this.read.search(input as unknown as EmailQuery, scope) }; break
      case 'email_read': case 'email_attachments': {
        object(input, ['ref']); ref(input.ref)
        const value = await this.read.read(input.ref, scope)
        result = { kind: 'read', value: id === 'email_read' ? value : value.message.attachments }; break
      }
      case 'email_conversation': object(input, ['accountId', 'threadId'], ['cursor']); text(input.accountId, 160); text(input.threadId); if (input.cursor !== undefined) text(input.cursor, 160); result = { kind: 'read', value: await this.read.conversation(input.accountId, input.threadId, input.cursor, scope) }; break
      case 'email_locations': object(input, ['accountId']); text(input.accountId, 160); result = { kind: 'read', value: await this.read.locations(input.accountId, scope) }; break
      case 'email_download_attachment': {
        object(input, ['ref', 'attachmentId', 'destinationHandle']); ref(input.ref); text(input.attachmentId); text(input.destinationHandle, 160)
        // Fail closed until publication can keep the selected Windows directory locked against replacement.
        throw new Error('email_download_unavailable')
      }
      case 'email_reconcile': object(input, ['operationId']); text(input.operationId, 160); result = { kind: 'write', operation: await this.write.reconcile(input.operationId, scope) }; break
      case 'email_draft': {
        object(input, ['request']); if (!input.request || !['draft_create', 'draft_update'].includes(input.request.type)) throw new Error('invalid_email_request')
        result = { kind: 'write', operation: await this.write.execute(input.request, scope) }; break
      }
      case 'email_send': object(input, ['draftRef', 'expectedVersion']); result = { kind: 'write', operation: await this.write.execute({ ...input, type: 'send' } as EmailWriteRequest, scope) }; break
      case 'email_reply': case 'email_forward': object(input, ['ref', 'expectedVersion', 'text', 'attachmentHandles'], id === 'email_forward' ? ['to'] : []); result = { kind: 'write', operation: await this.write.execute({ ...input, type: id === 'email_reply' ? 'reply' : 'forward', to: input.to ?? [] } as EmailWriteRequest, scope) }; break
      case 'email_organize': object(input, ['ref', 'expectedVersion', 'action'], ['destination', 'addLabelIds', 'removeLabelIds']); result = { kind: 'write', operation: await this.write.execute({ ...input, type: 'organize' } as EmailWriteRequest, scope) }; break
      default: throw new Error('unknown_email_capability')
    }
    check()
    const ids = new Set<string>()
    if (result.kind === 'write') ids.add(result.operation.accountId)
    else if (Array.isArray(result.value)) for (const item of result.value) ids.add('ref' in item ? item.ref.accountId : item.accountId)
    else if ('message' in result.value) ids.add(result.value.message.summary.ref.accountId)
    else if ('accountId' in result.value) ids.add(result.value.accountId)
    else for (const item of result.value.items) ids.add(item.ref.accountId)
    // Empty results still belong to the requested account; partial search failures do not invalidate healthy accounts.
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      const args = input as Record<string, any>
      if (typeof args.accountId === 'string') ids.add(args.accountId)
      if (args.ref?.accountId) ids.add(args.ref.accountId)
      if (result.kind === 'read' && !Array.isArray(result.value) && 'queriedAccountIds' in result.value) {
        for (const accountId of result.value.queriedAccountIds) if (!result.value.failures.some(failure => failure.accountId === accountId)) ids.add(accountId)
      }
    }
    const accountCheck = () => {
      check()
      for (const accountId of ids) {
        const original = snapshots.get(accountId), current = this.accounts.getAccount(accountId)
        if (!original || !current || original.revision !== current.revision || current.status !== 'connected') throw new Error('stale_email_account')
      }
    }
    accountCheck()
    if (result.kind === 'write') {
      result.operationId = result.operation.id; result.accountId = result.operation.accountId
      if (result.operation.providerRef) {
        result.ref = { ...result.operation.providerRef }
        if (['draft_create', 'draft_update'].includes(result.operation.kind)) result.draftRef = { ...result.operation.providerRef }
      }
    } else if (!Array.isArray(result.value)) {
      if ('message' in result.value) { result.ref = { ...result.value.message.summary.ref }; result.version = result.value.version }
      else if ('queriedAccountIds' in result.value) { if (result.value.items.length) result.firstRef = { ...result.value.items[0].ref } }
      else { result.accountId = result.value.accountId; result.threadId = result.value.threadId; if (result.value.items.length) result.firstRef = { ...result.value.items[0].message.summary.ref } }
    }
    const fingerprint = await this.codec.fingerprint({ id, input }); accountCheck()
    this.proofs.observe(context, id, fingerprint, result, reads.has(id) ? 'email_read' : 'email_write', accountCheck)
    return structuredClone(result)
  }
  verify(context: ExecutionContext, id: string, result: CapabilityResult): CapabilityResult { return this.proofs.verify(context, id, result) }
  releaseObservation(invocationId: string): void { this.proofs.release(invocationId) }
  clearObservations(): void { this.proofs.clear() }
  async stop(): Promise<void> { this.generation++; this.read.clear(); this.files.clear(); this.proofs.clear(); await this.write.stop() }
}
