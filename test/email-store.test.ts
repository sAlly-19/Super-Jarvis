import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emailDatabase } from './fixtures/email/database'
import { EmailStore } from '../src/main/modules/email/store'
const identity = { provider: 'gmail' as const, subjectId: 'synthetic-subject', tenantId: null, address: 'test@example.invalid', displayName: 'Synthetic' }
test('email accounts preserve identity, isolate provider/tenant and reject stale revisions', () => {
  const db = emailDatabase()
  try {
    const store = new EmailStore(db), a = store.upsertIdentity(identity, 'vault-a')
    assert.equal(a.status, 'disconnected', 'identity alone cannot grant a connection')
    const connected = store.setConnection(a.id, 'connected', a.revision)
    const updated = store.upsertIdentity({ ...identity, displayName: 'Changed' }, 'vault-a')
    assert.equal(updated.id, a.id)
    assert.ok(updated.revision > connected.revision)
    assert.equal(updated.status, 'connected')
    const b = store.upsertIdentity({ ...identity, provider: 'outlook', tenantId: 'tenant-1' }, 'vault-b')
    const c = store.upsertIdentity({ ...identity, provider: 'outlook', tenantId: 'tenant-2' }, 'vault-c')
    assert.equal(new Set([a.id, b.id, c.id]).size, 3)
    assert.throws(() => store.setConnection(a.id, 'disconnected', a.revision), /stale_email_revision/)
    store.setDefault(a.id, 0)
    store.setConnection(a.id, 'disconnected', updated.revision)
    assert.equal(store.getPreferences().defaultAccountId, a.id)
    assert.throws(() => store.setDefault(b.id, 0), /stale_email_revision/)
    assert.throws(() => store.setDefault('missing', 1), /email_account_unavailable/)
    assert.equal(store.listAccounts().length, 3)
    assert.equal(store.getAccount('missing'), null)
    assert.throws(() => store.upsertIdentity({ ...identity, subjectId: '' }, 'v'), /invalid_email_identity/)
  } finally { db.close() }
})
