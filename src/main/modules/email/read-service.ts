import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { EmailAccount, EmailConversation, EmailLocation, EmailMessage, EmailMessageRef, EmailPage, EmailProviderId, EmailQuery, EmailSummary } from '../../../shared/types/email'
import type { EmailScope } from './contracts'
import type { EmailReadProvider } from './providers/read-common'
import { EmailRequestError } from './providers/sdk-transport'
import { EmailStore } from './store'
import { EmailCursors, emailQueryHash } from './cursors'

interface Dependencies { authorize(scope: EmailScope): void; now?(): number; sleep?(ms: number, signal?: AbortSignal): Promise<void> }
interface AccountPage { id: string; buffer: EmailSummary[]; cursor: string | null; exhausted: boolean; failure: string | null; used: string[] }
interface SearchState { accounts: AccountPage[]; seen: string[] }
interface Version { ref: EmailMessageRef; revision: number; providerVersion: string; owner: string; expires: number }
const compare = (a: EmailSummary, b: EmailSummary) => (b.receivedAt ?? '').localeCompare(a.receivedAt ?? '') || a.ref.accountId.localeCompare(b.ref.accountId) || a.ref.messageId.localeCompare(b.ref.messageId)
export class EmailReadService {
  private readonly cursors: EmailCursors<SearchState>
  private readonly versions = new Map<string, Version>()
  private readonly active = new Set<AbortController>()
  private generation = 0
  constructor(private readonly store: EmailStore, private readonly providers: Partial<Record<EmailProviderId, EmailReadProvider>>, private readonly deps: Dependencies) { this.cursors = new EmailCursors(() => this.now()) }
  private now(): number { return this.deps.now?.() ?? Date.now() }
  private owner(scope: EmailScope): string { return `${scope.context.sessionId}:${scope.context.moduleRevision}` }
  private async run<T>(scope: EmailScope, work: (guarded: EmailScope, deadline: number) => Promise<T>): Promise<T> {
    const controller = new AbortController(), generation = this.generation, deadline = this.now() + 30000
    this.active.add(controller)
    const signal = AbortSignal.any([controller.signal, scope.signal]), timer = setTimeout(() => controller.abort(new Error('email_read_timeout')), 30000)
    const guarded: EmailScope = { ...scope, signal, check: () => { signal.throwIfAborted(); scope.check(); this.deps.authorize(scope); if (generation !== this.generation) throw new Error('stale_email_read') } }
    try { guarded.check(); const result = await work(guarded, deadline); guarded.check(); return structuredClone(result) }
    finally { clearTimeout(timer); this.active.delete(controller) }
  }
  private account(id: string): EmailAccount {
    const account = this.store.getAccount(id)
    if (!account || account.status !== 'connected') throw new Error('email_account_unavailable')
    return account
  }
  private provider(account: EmailAccount): EmailReadProvider {
    const provider = this.providers[account.provider]
    if (!provider) throw new Error('email_oauth_not_configured')
    return provider
  }
  private accountScope(account: EmailAccount, scope: EmailScope): EmailScope {
    return { ...scope, check: () => { scope.check(); const current = this.store.getAccount(account.id); if (current?.revision !== account.revision || current.status !== account.status) throw new Error('stale_email_account') } }
  }
  private query(input: EmailQuery): Omit<EmailQuery, 'cursor'> {
    const keys = ['accountIds', 'from', 'to', 'subject', 'text', 'afterUtc', 'beforeUtc', 'unread', 'location', 'cursor', 'limit']
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key)) || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 50) throw new Error('invalid_email_query')
    for (const key of ['from', 'to', 'subject', 'text'] as const) if (input[key] !== undefined && (typeof input[key] !== 'string' || input[key]!.length > 512 || /[\r\n\0]/.test(input[key]!))) throw new Error('invalid_email_query')
    for (const key of ['afterUtc', 'beforeUtc'] as const) if (input[key] !== undefined && (typeof input[key] !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(input[key]!) || !Number.isFinite(Date.parse(input[key]!)))) throw new Error('invalid_email_query')
    if (input.afterUtc && input.beforeUtc && Date.parse(input.afterUtc) >= Date.parse(input.beforeUtc)) throw new Error('invalid_email_query')
    if (input.unread !== undefined && typeof input.unread !== 'boolean') throw new Error('invalid_email_query')
    if (input.accountIds !== undefined && (!Array.isArray(input.accountIds) || !input.accountIds.length || input.accountIds.some(id => typeof id !== 'string' || !id || id.length > 160))) throw new Error('invalid_email_query')
    if (input.cursor !== undefined && (typeof input.cursor !== 'string' || input.cursor.length > 160)) throw new Error('invalid_email_query')
    if (input.location && (typeof input.location !== 'object' || Object.keys(input.location).some(key => !['accountId', 'id', 'kind'].includes(key)) || typeof input.location.accountId !== 'string' || typeof input.location.id !== 'string' || !input.location.id || input.location.id.length > 2048 || !['folder', 'label'].includes(input.location.kind))) throw new Error('invalid_email_query')
    const { cursor: _cursor, ...query } = structuredClone(input)
    if (query.accountIds) query.accountIds = [...new Set(query.accountIds)].sort()
    return query
  }
  private async retry<T>(work: () => Promise<T>, scope: EmailScope, deadline: number): Promise<T> {
    try { return await work() }
    catch (error) {
      scope.check()
      if (!(error instanceof EmailRequestError) || ![429, 502, 503, 504].includes(error.status ?? 0)) throw error
      const wait = error.retryAfterMs ?? 250
      if (wait > 30000 || this.now() + wait >= deadline) throw error
      if (this.deps.sleep) await this.deps.sleep(wait, scope.signal)
      else await delay(wait, undefined, { signal: scope.signal })
      scope.check(); return work()
    }
  }
  search(input: EmailQuery, scope: EmailScope): Promise<EmailPage> {
    return this.run(scope, async (guarded, deadline) => {
      const query = this.query(input), all = this.store.listAccounts()
      const selected = query.accountIds ? query.accountIds.map(id => { const account = all.find(item => item.id === id); if (!account || account.status === 'disconnected') throw new Error('email_account_unavailable'); return account }) : all.filter(account => account.status !== 'disconnected')
      if (!selected.length) throw new Error(input.cursor ? 'email_cursor_stale' : 'email_account_unavailable')
      if (query.location && (selected.length !== 1 || selected[0].id !== query.location.accountId)) throw new Error('invalid_email_query')
      const revisions = Object.fromEntries(selected.map(account => [account.id, account.revision])), hash = emailQueryHash({ query, owner: this.owner(guarded) })
      const state: SearchState = input.cursor ? this.cursors.take(input.cursor, hash, revisions) : { accounts: selected.map(account => ({ id: account.id, buffer: [], cursor: null, exhausted: false, failure: account.status === 'reauth_required' ? 'email_reauth_required' : null, used: [] })), seen: [] }
      const seen = new Set(state.seen), output: EmailSummary[] = []
      const reauthUpdates = new Map<string, number>()
      const check = () => {
        guarded.check()
        for (const account of selected) {
          const revision = reauthUpdates.get(account.id)
          if (revision === undefined) this.accountScope(account, guarded).check()
          else { const current = this.store.getAccount(account.id); if (current?.status !== 'reauth_required' || current.revision !== revision) throw new Error('stale_email_account') }
        }
      }
      const fill = async (page: AccountPage) => {
        if (page.buffer.length || page.exhausted || page.failure) return
        const account = selected.find(account => account.id === page.id)!, accountGuard = this.accountScope(account, guarded)
        try {
          while (!page.buffer.length && !page.exhausted) {
            accountGuard.check()
            const token = page.cursor ?? ''
            if (page.used.includes(token) || page.used.length >= 1000) throw new Error('email_cursor_stale')
            page.used.push(token)
            const result = await this.retry(() => this.provider(account).search(account, query, page.cursor, accountGuard), accountGuard, deadline)
            accountGuard.check()
            if (!Array.isArray(result.items) || result.items.length > query.limit || result.items.some(item => item.ref.accountId !== account.id || !item.ref.messageId)) throw new Error('invalid_email_payload')
            page.buffer = result.items.map(item => structuredClone(item)).sort(compare)
            page.cursor = result.cursor; page.exhausted = result.cursor === null
          }
        } catch (error) {
          guarded.check()
          const current = this.store.getAccount(account.id)
          if (account.status === 'connected' && current?.status === 'reauth_required' && current.revision === account.revision + 1) {
            reauthUpdates.set(account.id, current.revision); revisions[account.id] = current.revision
            page.failure = 'email_reauth_required'; page.buffer = []; page.exhausted = true
            for (let i = output.length - 1; i >= 0; i--) if (output[i].ref.accountId === account.id) output.splice(i, 1)
            return
          }
          accountGuard.check()
          page.failure = error instanceof EmailRequestError ? error.code : error instanceof Error && ['email_reauth_required', 'email_oauth_not_configured', 'unsupported_email_query_combination', 'email_cursor_stale'].includes(error.message) ? error.message : 'email_search_failed'
          page.exhausted = true
        }
      }
      while (output.length < query.limit) {
        const pending = state.accounts.filter(page => !page.buffer.length && !page.exhausted && !page.failure)
        let index = 0
        const worker = async () => { while (index < pending.length) await fill(pending[index++]) }
        await Promise.all([worker(), worker()]); check()
        const candidates = state.accounts.filter(page => page.buffer.length).sort((a, b) => compare(a.buffer[0], b.buffer[0]))
        if (!candidates.length) break
        const next = candidates[0].buffer.shift()!, key = JSON.stringify(next.ref)
        if (!seen.has(key)) { output.push(next); seen.add(key) }
      }
      check(); state.seen = [...seen]
      const failures = state.accounts.filter(page => page.failure).map(page => ({ accountId: page.id, code: page.failure! }))
      const more = state.accounts.some(page => page.buffer.length || (!page.exhausted && !page.failure))
      return { items: output, nextCursor: more ? this.cursors.create(hash, revisions, state) : null, queriedAccountIds: selected.map(account => account.id), failures, partial: failures.length > 0 }
    })
  }
  private remember(ref: EmailMessageRef, providerVersion: string, account: EmailAccount, scope: EmailScope): string {
    for (const [id, entry] of this.versions) if (entry.expires <= this.now()) this.versions.delete(id)
    while (this.versions.size >= 1000) this.versions.delete(this.versions.keys().next().value!)
    const id = randomUUID(); this.versions.set(id, { ref: { ...ref }, revision: account.revision, providerVersion, owner: this.owner(scope), expires: this.now() + 300000 }); return id
  }
  read(ref: EmailMessageRef, scope: EmailScope): Promise<{ message: EmailMessage; version: string }> {
    return this.run(scope, async (guarded, deadline) => {
      const account = this.account(ref.accountId), accountGuard = this.accountScope(account, guarded)
      const result = await this.retry(() => this.provider(account).read(account, ref, accountGuard), accountGuard, deadline)
      accountGuard.check()
      if (result.message.summary.ref.accountId !== ref.accountId || result.message.summary.ref.messageId !== ref.messageId || !result.version) throw new Error('invalid_email_payload')
      return { message: result.message, version: this.remember(ref, result.version, account, guarded) }
    })
  }
  readVersion(ref: EmailMessageRef, expectedVersion: string, scope: EmailScope): Promise<EmailMessage> {
    return this.run(scope, async (guarded, deadline) => {
      const entry = this.versions.get(expectedVersion), account = this.account(ref.accountId)
      if (!entry || entry.expires <= this.now() || entry.owner !== this.owner(guarded) || entry.revision !== account.revision || entry.ref.accountId !== ref.accountId || entry.ref.messageId !== ref.messageId) throw new Error('stale_email_version')
      const accountGuard = this.accountScope(account, guarded)
      const result = await this.retry(() => this.provider(account).read(account, ref, accountGuard), accountGuard, deadline)
      accountGuard.check()
      if (entry.providerVersion !== result.version) throw new Error('stale_email_version')
      return result.message
    })
  }
  conversation(accountId: string, threadId: string, cursor: string | undefined, scope: EmailScope): Promise<EmailConversation> {
    return this.run(scope, async (guarded, deadline) => {
      const account = this.account(accountId), accountGuard = this.accountScope(account, guarded)
      // Conversation cursors use the same opaque cache, isolated from search snapshots.
      const hash = emailQueryHash({ accountId, threadId, owner: this.owner(guarded), kind: 'conversation' }), revisions = { [accountId]: account.revision }
      const saved = cursor ? this.cursors.take(cursor, hash, revisions) : null
      const result = await this.retry(() => this.provider(account).conversation(account, threadId, saved?.accounts[0].cursor ?? null, accountGuard), accountGuard, deadline)
      accountGuard.check()
      if (result.accountId !== accountId || result.threadId !== threadId || result.items.length > 5) throw new Error('invalid_email_payload')
      const items = result.items.map(item => ({ message: item.message, version: this.remember(item.message.summary.ref, item.version, account, guarded) }))
      return { ...result, items, nextCursor: result.nextCursor ? this.cursors.create(hash, revisions, { accounts: [{ id: accountId, buffer: [], cursor: result.nextCursor, exhausted: false, failure: null, used: [] }], seen: [] }) : null }
    })
  }
  locations(accountId: string, scope: EmailScope): Promise<EmailLocation[]> {
    return this.run(scope, async (guarded, deadline) => { const account = this.account(accountId), accountGuard = this.accountScope(account, guarded); const result = await this.retry(() => this.provider(account).locations(account, accountGuard), accountGuard, deadline); accountGuard.check(); if (result.length > 1000 || result.some(item => item.accountId !== accountId)) throw new Error('invalid_email_payload'); return result })
  }
  clear(): void {
    this.generation++; for (const controller of this.active) controller.abort(new Error('stale_email_read'))
    this.cursors.clear(); this.versions.clear()
  }
}
