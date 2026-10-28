import { randomUUID } from 'node:crypto'
import type { EmailAccount, EmailProviderId } from '../../../shared/types/email'
import type { EmailScope } from './contracts'
import { EmailAccountSession } from './account-session'
import { EmailStore } from './store'
import { EmailTokenVault } from './token-vault'

type Identity = Omit<EmailAccount, 'id' | 'revision' | 'status'>
export interface EmailAuthDriver {
  authorize(scope: EmailScope): Promise<{ identity: Identity; credentials: unknown }>
  access(credentials: unknown, scope: EmailScope): Promise<{ accessToken: string; credentials: unknown }>
}
interface VaultEntry { accountId: string; provider: EmailProviderId; subjectId: string; tenantId: string | null; credentials: unknown }
interface Dependencies { authorize(): void; cleanupTimeoutMs?: number }
export class EmailAuth {
  private readonly sessions: EmailAccountSession
  private readonly active = new Map<AbortController, Promise<unknown>>()
  private commitTail: Promise<unknown> = Promise.resolve()
  private epoch = 0
  private stopping = false
  private unsafe = false
  private stoppingWork: Promise<void> | null = null
  constructor(private readonly store: EmailStore, private readonly vault: EmailTokenVault, private readonly drivers: Partial<Record<EmailProviderId, EmailAuthDriver>>, private readonly deps: Dependencies) {
    this.sessions = new EmailAccountSession({ authorize: () => this.access(), revision: id => { const account = this.store.getAccount(id); if (!account) throw new Error('email_account_unavailable'); return account.revision } }, deps.cleanupTimeoutMs)
  }
  private access() {
    this.deps.authorize()
    if (this.unsafe) throw new Error('email_account_cleanup_failed')
    if (this.stopping) throw new Error('email_account_unavailable')
  }
  private run<T>(scope: EmailScope, work: (guarded: EmailScope) => Promise<T>): Promise<T> {
    const controller = new AbortController(), epoch = this.epoch
    const signal = AbortSignal.any([scope.signal, controller.signal])
    const guarded: EmailScope = { ...scope, signal, check: () => {
      signal.throwIfAborted(); scope.check(); this.access()
      if (epoch !== this.epoch) throw new Error('stale_email_account')
    } }
    const promise = Promise.resolve().then(async () => { guarded.check(); const result = await work(guarded); guarded.check(); return result })
    this.active.set(controller, promise)
    const cleanup = () => this.active.delete(controller)
    void promise.then(cleanup, cleanup)
    return promise
  }
  private driver(provider: EmailProviderId): EmailAuthDriver {
    const driver = this.drivers[provider]
    if (!driver) throw new Error('email_oauth_not_configured')
    return driver
  }
  private requireAccount(id: string): EmailAccount {
    const account = this.store.getAccount(id)
    if (!account || account.status !== 'connected') throw new Error('email_account_unavailable')
    return account
  }
  private entry(value: unknown, account: EmailAccount): VaultEntry {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('email_reauth_required')
    const entry = value as VaultEntry
    if (entry.accountId !== account.id || entry.provider !== account.provider || entry.subjectId !== account.subjectId || entry.tenantId !== account.tenantId || entry.credentials === undefined) throw new Error('email_reauth_required')
    return entry
  }
  connect(provider: EmailProviderId, scope: EmailScope): Promise<EmailAccount> {
    return this.run(scope, async guarded => {
      const revisions = new Map(this.store.listAccounts().map(account => [account.id, account.revision]))
      const grant = await this.driver(provider).authorize(guarded)
      guarded.check()
      if (grant.identity.provider !== provider) throw new Error('invalid_email_identity')
      const commit = this.commitTail.catch(() => {}).then(async () => {
        guarded.check()
        const previous = this.store.listAccounts().find(account => account.provider === provider && account.subjectId === grant.identity.subjectId && account.tenantId === grant.identity.tenantId)
        if (previous && revisions.get(previous.id) !== previous.revision) throw new Error('stale_email_account')
        if (previous) await this.sessions.invalidate(previous.id)
        guarded.check()
        if (previous && this.store.getAccount(previous.id)?.revision !== previous.revision) throw new Error('stale_email_account')
        const vaultRef = previous ? this.store.getVaultRef(previous.id)! : randomUUID()
        let account = this.store.upsertIdentity(grant.identity, vaultRef)
        if (account.status !== 'disconnected') account = this.store.setConnection(account.id, 'disconnected', account.revision)
        const ticket = this.sessions.capture(account.id)
        await this.sessions.runExclusive(account.id, async () => {
          guarded.check(); ticket.check()
          await this.vault.put(vaultRef, { accountId: account.id, provider, subjectId: account.subjectId, tenantId: account.tenantId, credentials: grant.credentials } satisfies VaultEntry)
          ticket.check(); guarded.check()
        })
        ticket.check(); guarded.check()
        return this.store.setConnection(account.id, 'connected', account.revision)
      })
      this.commitTail = commit
      return commit
    })
  }
  accessToken(accountId: string, scope: EmailScope): Promise<string> {
    return this.run(scope, async guarded => {
      const account = this.requireAccount(accountId), ticket = this.sessions.capture(accountId)
      try {
        return await this.sessions.runExclusive(accountId, async () => {
          guarded.check(); ticket.check()
          const vaultRef = this.store.getVaultRef(accountId)!
          const entry = this.entry(await this.vault.get(vaultRef), account)
          ticket.check(); guarded.check()
          const combined: EmailScope = { ...guarded, signal: AbortSignal.any([guarded.signal, ticket.signal]), check: () => { guarded.check(); ticket.check() } }
          const result = await this.driver(account.provider).access(entry.credentials, combined)
          combined.check()
          if (!result.accessToken || typeof result.accessToken !== 'string') throw new Error('email_reauth_required')
          await this.vault.put(vaultRef, { ...entry, credentials: result.credentials })
          combined.check()
          return result.accessToken
        })
      } catch (error) {
        if (error instanceof Error && error.message === 'email_reauth_required') {
          const current = this.store.getAccount(accountId)
          if (current?.revision === account.revision && current.status === 'connected') this.store.setConnection(accountId, 'reauth_required', current.revision)
        }
        throw error
      }
    })
  }
  disconnect(accountId: string, scope: EmailScope): Promise<void> {
    return this.run(scope, async guarded => {
      const account = this.store.getAccount(accountId)
      if (!account) throw new Error('email_account_unavailable')
      const stopping = this.sessions.invalidate(accountId)
      // Persist denial immediately, even if cleanup later fails.
      this.store.setConnection(accountId, 'disconnected', account.revision)
      await stopping
      guarded.check()
      const vaultRef = this.store.getVaultRef(accountId)
      if (vaultRef) await this.vault.remove(vaultRef)
      guarded.check()
    })
  }
  restore(scope: EmailScope): Promise<void> {
    return this.run(scope, async guarded => {
      for (const account of this.store.listAccounts()) {
        if (account.status !== 'connected') continue
        guarded.check()
        const value = await this.vault.get(this.store.getVaultRef(account.id)!)
        guarded.check()
        try { this.entry(value, account) }
        catch {
          const current = this.store.getAccount(account.id)
          if (current?.revision === account.revision) this.store.setConnection(account.id, 'reauth_required', current.revision)
        }
      }
    })
  }
  stop(): Promise<void> {
    if (this.stoppingWork) return this.stoppingWork
    this.epoch++; this.stopping = true
    const jobs = [...this.active]
    for (const [controller] of jobs) controller.abort(new Error('stale_email_account'))
    const accountStops = this.store.listAccounts().map(account => this.sessions.invalidate(account.id))
    let timer: ReturnType<typeof setTimeout> | undefined
    this.stoppingWork = (async () => {
      try {
        const results = await Promise.race([
          Promise.allSettled([...jobs.map(([, work]) => work), ...accountStops]),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('email_account_cleanup_failed')), this.deps.cleanupTimeoutMs ?? 1000) })
        ])
        if (results.some(result => result.status === 'rejected' && result.reason?.message === 'email_account_cleanup_failed')) throw new Error('email_account_cleanup_failed')
      } catch { this.unsafe = true; throw new Error('email_account_cleanup_failed') }
      finally { if (timer) clearTimeout(timer); this.stopping = false; this.stoppingWork = null }
    })()
    return this.stoppingWork
  }
}
