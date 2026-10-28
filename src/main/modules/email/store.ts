import { randomUUID } from 'node:crypto'
import type { EmailAccount, EmailPreferences } from '../../../shared/types/email'
import type { StateDatabase } from '../../storage/state-database'

type Identity = Omit<EmailAccount, 'id' | 'revision' | 'status'>
function text(value: unknown, limit = 512): value is string { return typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\u0000-\u001f]/.test(value) }
function account(row: Record<string, unknown>): EmailAccount {
  return { id: String(row.id), provider: row.provider as EmailAccount['provider'], subjectId: String(row.subject_id), tenantId: row.tenant_id === null ? null : String(row.tenant_id), address: String(row.address), displayName: String(row.display_name), revision: Number(row.revision), status: row.status as EmailAccount['status'] }
}
export class EmailStore {
  constructor(private readonly database: StateDatabase) {}
  listAccounts(): EmailAccount[] { return this.database.transaction(tx => tx.prepare('SELECT * FROM email_accounts ORDER BY id').all().map(account)) }
  getAccount(id: string): EmailAccount | null { return this.database.transaction(tx => { const row = tx.prepare('SELECT * FROM email_accounts WHERE id=?').get(id); return row ? account(row) : null }) }
  getVaultRef(id: string): string | null { return this.database.transaction(tx => { const row = tx.prepare('SELECT vault_ref FROM email_accounts WHERE id=?').get(id); return row ? String(row.vault_ref) : null }) }
  upsertIdentity(identity: Identity, vaultRef: string): EmailAccount {
    if (!identity || !['gmail', 'outlook'].includes(identity.provider) || !text(identity.subjectId) || !(identity.tenantId === null || text(identity.tenantId)) || !text(identity.address, 320) || typeof identity.displayName !== 'string' || identity.displayName.length > 512 || !text(vaultRef) || (identity.provider === 'gmail' && identity.tenantId !== null)) throw new Error('invalid_email_identity')
    return this.database.transaction(tx => {
      const row = tx.prepare("SELECT * FROM email_accounts WHERE provider=? AND COALESCE(tenant_id,'')=COALESCE(?,'') AND subject_id=?").get(identity.provider, identity.tenantId, identity.subjectId)
      const id = row ? String(row.id) : randomUUID()
      if (row) tx.prepare('UPDATE email_accounts SET address=?,display_name=?,vault_ref=?,revision=revision+1 WHERE id=?').run(identity.address, identity.displayName, vaultRef, id)
      else tx.prepare("INSERT INTO email_accounts(id,provider,subject_id,tenant_id,address,display_name,vault_ref,status) VALUES(?,?,?,?,?,?,?,'disconnected')").run(id, identity.provider, identity.subjectId, identity.tenantId, identity.address, identity.displayName, vaultRef)
      return account(tx.prepare('SELECT * FROM email_accounts WHERE id=?').get(id)!)
    })
  }
  setConnection(id: string, status: EmailAccount['status'], expectedRevision: number): EmailAccount {
    if (!['connected', 'reauth_required', 'disconnected'].includes(status) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('invalid_email_connection')
    return this.database.transaction(tx => {
      const row = tx.prepare('SELECT * FROM email_accounts WHERE id=?').get(id)
      if (!row) throw new Error('email_account_unavailable')
      if (row.revision !== expectedRevision) throw new Error('stale_email_revision')
      tx.prepare('UPDATE email_accounts SET status=?,revision=revision+1 WHERE id=?').run(status, id)
      return account(tx.prepare('SELECT * FROM email_accounts WHERE id=?').get(id)!)
    })
  }
  getPreferences(): EmailPreferences {
    return this.database.transaction(tx => { const row = tx.prepare('SELECT * FROM email_preferences WHERE singleton=1').get()!; return { defaultAccountId: row.default_account_id === null ? null : String(row.default_account_id), revision: Number(row.revision) } })
  }
  setDefault(accountId: string | null, expectedRevision: number): EmailPreferences {
    if (!(accountId === null || text(accountId)) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('invalid_email_preferences')
    return this.database.transaction(tx => {
      const row = tx.prepare('SELECT * FROM email_preferences WHERE singleton=1').get()!
      if (row.revision !== expectedRevision) throw new Error('stale_email_revision')
      if (accountId !== null && !tx.prepare('SELECT id FROM email_accounts WHERE id=?').get(accountId)) throw new Error('email_account_unavailable')
      tx.prepare('UPDATE email_preferences SET default_account_id=?,revision=revision+1 WHERE singleton=1').run(accountId)
      return { defaultAccountId: accountId, revision: expectedRevision + 1 }
    })
  }
}
