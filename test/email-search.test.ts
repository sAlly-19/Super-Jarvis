import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EmailReadService } from '../src/main/modules/email/read-service'
import { EmailStore } from '../src/main/modules/email/store'
import { EmailRequestError } from '../src/main/modules/email/providers/sdk-transport'
import type { EmailReadProvider } from '../src/main/modules/email/providers/read-common'
import type { EmailScope } from '../src/main/modules/email/contracts'
import { emailDatabase } from './fixtures/email/database'
const scope = (sessionId = 1): EmailScope => ({ context: { taskId: 't', stepId: 's', sessionId, moduleRevision: 0, invocationId: 'i' }, signal: new AbortController().signal, check() {} })
function accounts() {
  const db = emailDatabase(), store = new EmailStore(db)
  for (const subjectId of ['a', 'b']) { const a = store.upsertIdentity({ provider: 'gmail', subjectId, tenantId: null, address: `${subjectId}@example.invalid`, displayName: 'Synthetic' }, subjectId); store.setConnection(a.id, 'connected', a.revision) }
  return { db, store, accounts: store.listAccounts() }
}
const provider = (search: EmailReadProvider['search']): EmailReadProvider => ({ search, read: async () => { throw new Error('unused') }, conversation: async () => { throw new Error('unused') }, locations: async () => [] })
test('email multi-account pagination keeps deterministic ties, account origins and rejects cursor reuse for another query/session/revision', async () => {
  const f = accounts()
  const p = provider(async (account, _query, cursor) => ({ items: [{ ref: { accountId: account.id, messageId: cursor ? '2' : '1' }, threadId: null, subject: 'Synthetic', from: 'a@example.invalid', receivedAt: '2026-10-28T00:00:00.000Z', unread: true }], cursor: cursor ? null : 'page2' }))
  const service = new EmailReadService(f.store, { gmail: p }, { authorize() {}, sleep: async () => {} })
  try {
    const first = await service.search({ text: 'query', limit: 1 }, scope())
    assert.equal(first.items.length, 1); assert.ok(first.nextCursor)
    await assert.rejects(service.search({ text: 'other', limit: 1, cursor: first.nextCursor! }, scope()), /email_cursor_stale/)
    await assert.rejects(service.search({ text: 'query', limit: 1, cursor: first.nextCursor! }, scope(2)), /email_cursor_stale/)
    const all = [...first.items]; let cursor = first.nextCursor
    while (cursor) { const page = await service.search({ text: 'query', limit: 1, cursor }, scope()); all.push(...page.items); cursor = page.nextCursor }
    assert.deepEqual(all.map(item => [item.ref.accountId, item.ref.messageId]), f.accounts.flatMap(account => [[account.id, '1'], [account.id, '2']]))
    const current = f.store.getAccount(f.accounts[0].id)!
    f.store.setConnection(current.id, 'disconnected', current.revision)
    await assert.rejects(service.search({ text: 'query', limit: 1, cursor: first.nextCursor! }, scope()), /email_cursor_stale/)
    await assert.rejects(service.search({ accountIds: [current.id], limit: 1 }, scope()), /email_account_unavailable/)
  } finally { service.clear(); f.db.close() }
})
test('email search reports partial failures instead of claiming all accounts contain no results and retries a read at most once', async () => {
  const f = accounts(); let attempts = 0
  const service = new EmailReadService(f.store, { gmail: provider(async account => {
    if (account.id === f.accounts[0].id) { attempts++; throw new EmailRequestError('email_provider_rejected', 503, 0) }
    return { items: [], cursor: null }
  }) }, { authorize() {}, sleep: async () => {} })
  try {
    const page = await service.search({ limit: 50 }, scope())
    assert.equal(page.partial, true); assert.equal(page.failures[0].accountId, f.accounts[0].id)
    assert.equal(attempts, 2); assert.equal(page.queriedAccountIds.length, 2)
    assert.equal(page.items.length, 0)
    await assert.rejects(service.search({ limit: 51 }, scope()), /invalid_email_query/)
  } finally { service.clear(); f.db.close() }
})
test('email search discards data that arrives after module revocation', async () => {
  const f = accounts(); let allowed = true, release!: () => void, enter!: () => void
  const entered = new Promise<void>(resolve => { enter = resolve }), barrier = new Promise<void>(resolve => { release = resolve })
  const service = new EmailReadService(f.store, { gmail: provider(async () => { enter(); await barrier; return { items: [], cursor: null } }) }, { authorize() { if (!allowed) throw new Error('denied') } })
  try {
    const work = service.search({ limit: 50 }, scope()), rejected = assert.rejects(work, /denied/)
    await entered; allowed = false; release(); await rejected
  } finally { release(); service.clear(); f.db.close() }
})
test('email search keeps healthy account results when another account becomes reauth_required during token acquisition', async () => {
  const f = accounts()
  const service = new EmailReadService(f.store, { gmail: provider(async account => {
    if (account.id === f.accounts[0].id) {
      f.store.setConnection(account.id, 'reauth_required', account.revision)
      throw new Error('email_reauth_required')
    }
    return { items: [{ ref: { accountId: account.id, messageId: 'healthy' }, threadId: null, subject: 'Synthetic', from: 'b@example.invalid', receivedAt: null, unread: false }], cursor: null }
  }) }, { authorize() {} })
  try {
    const page = await service.search({ limit: 50 }, scope())
    assert.equal(page.partial, true)
    assert.equal(page.items.length, 1)
    assert.equal(page.items[0].ref.accountId, f.accounts[1].id)
    assert.deepEqual(page.failures, [{ accountId: f.accounts[0].id, code: 'email_reauth_required' }])
  } finally { service.clear(); f.db.close() }
})
