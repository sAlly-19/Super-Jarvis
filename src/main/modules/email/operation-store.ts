import { randomUUID } from 'node:crypto'
import type { EmailMessageRef, EmailOperation } from '../../../shared/types/email'
import type { StateDatabase } from '../../storage/state-database'
type State = EmailOperation['state']
type Row = Record<string, unknown>
export interface EmailOperationPrivate { operation: EmailOperation; fingerprint: string; sealedCorrelation: string | null; revision: number; legs: Record<string, State> }
const transitions: Record<State, State[]> = { prepared: ['dispatching', 'rejected'], dispatching: ['accepted', 'observed', 'rejected', 'unknown'], accepted: ['observed'], observed: [], rejected: [], unknown: ['observed'] }
const kinds = ['draft_create', 'draft_update', 'send', 'reply', 'forward', 'organize']
function operation(row: Row): EmailOperation {
  return { id: String(row.id), invocationId: String(row.invocation_id), accountId: String(row.account_id), kind: String(row.kind), state: row.state as State, providerRef: row.provider_ref === null ? null : JSON.parse(String(row.provider_ref)), errorCode: row.error_code === null ? null : String(row.error_code), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }
}
export class EmailOperationStore {
  constructor(private readonly database: StateDatabase) {}
  prepare(invocationId: string, accountId: string, kind: string, argsFingerprint: string, sealedCorrelation: string | null): EmailOperation {
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(invocationId) || !kinds.includes(kind) || !/^[a-f0-9]{64}$/.test(argsFingerprint) || !(sealedCorrelation === null || (typeof sealedCorrelation === 'string' && sealedCorrelation.length <= 262144))) throw new Error('invalid_email_operation')
    return this.database.transaction(tx => {
      const existing = tx.prepare('SELECT * FROM email_operations WHERE invocation_id=?').get(invocationId)
      if (existing) {
        if (existing.account_id !== accountId || existing.kind !== kind || existing.args_fingerprint !== argsFingerprint) throw new Error('email_invocation_conflict')
        return operation(existing)
      }
      if (!tx.prepare('SELECT id FROM email_accounts WHERE id=?').get(accountId)) throw new Error('email_account_unavailable')
      const id = randomUUID(), now = new Date().toISOString()
      tx.prepare("INSERT INTO email_operations(id,invocation_id,account_id,kind,args_fingerprint,sealed_correlation,state,created_at,updated_at) VALUES(?,?,?,?,?,?,'prepared',?,?)").run(id, invocationId, accountId, kind, argsFingerprint, sealedCorrelation, now, now)
      return operation(tx.prepare('SELECT * FROM email_operations WHERE id=?').get(id)!)
    })
  }
  get(id: string): EmailOperation | null { return this.database.transaction(tx => { const row = tx.prepare('SELECT * FROM email_operations WHERE id=?').get(id); return row ? operation(row) : null }) }
  getByInvocation(id: string): EmailOperation | null { return this.database.transaction(tx => { const row = tx.prepare('SELECT * FROM email_operations WHERE invocation_id=?').get(id); return row ? operation(row) : null }) }
  privateRecord(id: string): EmailOperationPrivate | null {
    return this.database.transaction(tx => {
      const row = tx.prepare('SELECT * FROM email_operations WHERE id=?').get(id)
      return row ? { operation: operation(row), fingerprint: String(row.args_fingerprint), sealedCorrelation: row.sealed_correlation === null ? null : String(row.sealed_correlation), revision: Number(row.revision), legs: JSON.parse(String(row.leg_receipts_json)) } : null
    })
  }
  transition(id: string, expectedState: State, nextState: State, providerRef?: EmailMessageRef | null, errorCode?: string | null): EmailOperation {
    if (!transitions[expectedState]?.includes(nextState)) throw new Error('invalid_email_transition')
    if (errorCode != null && !/^[a-z][a-z0-9_]{0,99}$/.test(errorCode)) throw new Error('invalid_email_operation')
    return this.database.transaction(tx => {
      const row = tx.prepare('SELECT * FROM email_operations WHERE id=?').get(id)
      if (!row || row.state !== expectedState) throw new Error('stale_email_operation')
      if (providerRef && (providerRef.accountId !== row.account_id || typeof providerRef.messageId !== 'string' || !providerRef.messageId || providerRef.messageId.length > 2048)) throw new Error('email_account_mismatch')
      tx.prepare('UPDATE email_operations SET state=?,provider_ref=?,error_code=?,revision=revision+1,updated_at=? WHERE id=?').run(nextState, providerRef === undefined ? row.provider_ref as string | null : providerRef === null ? null : JSON.stringify(providerRef), errorCode === undefined ? row.error_code as string | null : errorCode, new Date().toISOString(), id)
      return operation(tx.prepare('SELECT * FROM email_operations WHERE id=?').get(id)!)
    })
  }
  updatePrivate(id: string, expectedRevision: number, sealedCorrelation: string, legs: Record<string, State>): void {
    if (sealedCorrelation.length > 262144 || Object.keys(legs).some(key => !/^[a-z0-9_-]{1,64}$/.test(key) || !Object.hasOwn(transitions, legs[key]))) throw new Error('invalid_email_correlation')
    this.database.transaction(tx => {
      const row = tx.prepare('SELECT revision FROM email_operations WHERE id=?').get(id)
      if (!row || row.revision !== expectedRevision) throw new Error('stale_email_operation')
      tx.prepare('UPDATE email_operations SET sealed_correlation=?,leg_receipts_json=?,revision=revision+1,updated_at=? WHERE id=?').run(sealedCorrelation, JSON.stringify(legs), new Date().toISOString(), id)
    })
  }
  interruptDispatches(): void { this.database.transaction(tx => tx.prepare("UPDATE email_operations SET state='unknown',error_code='interrupted_email_operation',revision=revision+1,updated_at=? WHERE state='dispatching'").run(new Date().toISOString())) }
}
