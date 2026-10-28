import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EmailCursors } from '../src/main/modules/email/cursors'
import { EmailReadService } from '../src/main/modules/email/read-service'
import { EmailStore } from '../src/main/modules/email/store'
import { emailDatabase } from './fixtures/email/database'
import type { EmailScope } from '../src/main/modules/email/contracts'
test('email cursors expire, bind account revisions and evict oldest snapshots without exposing provider cursors', () => {
  let now = 0
  const cursors = new EmailCursors<{ secret: string }>(() => now)
  const id = cursors.create('query', { a: 1 }, { secret: 'private-provider-cursor' })
  assert.doesNotMatch(id, /private-provider/)
  const restored = cursors.take(id, 'query', { a: 1 }); restored.secret = 'modified'
  assert.equal(cursors.take(id, 'query', { a: 1 }).secret, 'private-provider-cursor')
  assert.throws(() => cursors.take(id, 'query', { a: 2 }), /email_cursor_stale/)
  now = 300001; assert.throws(() => cursors.take(id, 'query', { a: 1 }), /email_cursor_stale/)
  const oldest = cursors.create('q', {}, { secret: 'old' })
  for (let i = 0; i < 100; i++) cursors.create('q', {}, { secret: String(i) })
  assert.throws(() => cursors.take(oldest, 'q', {}), /email_cursor_stale/)
  cursors.clear()
})
test('email read versions bind account, message and session, detect fresh remote changes and clear with the module', async () => {
  const db = emailDatabase(), store = new EmailStore(db)
  let account = store.upsertIdentity({ provider: 'gmail', subjectId: 'fixture', tenantId: null, address: 'a@example.invalid', displayName: 'Synthetic' }, 'vault')
  account = store.setConnection(account.id, 'connected', account.revision)
  const scope: EmailScope = { context: { taskId: 't', stepId: 's', sessionId: 1, moduleRevision: 0, invocationId: 'i' }, signal: new AbortController().signal, check() {} }
  const ref = { accountId: account.id, messageId: 'm' }
  let sourceVersion = 'provider-version-1'
  const message = { summary: { ref, threadId: null, from: 'a@example.invalid', subject: 'Synthetic', receivedAt: null, unread: false }, to: [], cc: [], replyTo: [], text: 'Synthetic', truncated: false, attachments: [] }
  const service = new EmailReadService(store, { gmail: { search: async () => ({ items: [], cursor: null }), locations: async () => [], conversation: async () => { throw new Error('unused') }, read: async () => ({ message, version: sourceVersion }) } }, { authorize() {} })
  try {
    const read = await service.read(ref, scope)
    assert.notEqual(read.version, sourceVersion)
    assert.equal((await service.readVersion(ref, read.version, scope)).text, 'Synthetic')
    await assert.rejects(service.readVersion({ ...ref, messageId: 'another' }, read.version, scope), /stale_email_version/)
    await assert.rejects(service.readVersion(ref, read.version, { ...scope, context: { ...scope.context, sessionId: 2 } }), /stale_email_version/)
    sourceVersion = 'provider-version-2'
    await assert.rejects(service.readVersion(ref, read.version, scope), /stale_email_version/)
    const next = await service.read(ref, scope); service.clear()
    await assert.rejects(service.readVersion(ref, next.version, scope), /stale_email_version/)
  } finally { service.clear(); db.close() }
})
