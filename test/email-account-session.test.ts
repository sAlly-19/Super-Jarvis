import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EmailAccountSession } from '../src/main/modules/email/account-session'
test('email account invalidation aborts refresh and prevents stale persistence, while independent accounts remain usable', async () => {
  let allowed = true, revision = 0, persisted = 0, release!: () => void
  const sessions = new EmailAccountSession({ authorize: () => { if (!allowed) throw new Error('denied') }, revision: () => revision })
  const capture = sessions.capture('a')
  const refreshing = sessions.runExclusive('a', async () => { await new Promise<void>(resolve => { release = resolve }); capture.check(); persisted++ })
  await new Promise(resolve => setImmediate(resolve))
  const stopping = sessions.invalidate('a')
  assert.equal(capture.signal.aborted, true)
  const rejected = assert.rejects(refreshing, /stale_email_account/)
  release(); await stopping; await rejected
  assert.equal(persisted, 0)
  await sessions.runExclusive('b', async () => { persisted++ })
  assert.equal(persisted, 1)
  const newer = sessions.capture('a'); revision++
  assert.throws(() => newer.check(), /stale_email_account/)
  allowed = false; assert.throws(() => sessions.capture('b'), /denied/)
})
test('email account queues are exclusive and a cleanup timeout blocks new operations until restart', async () => {
  const sessions = new EmailAccountSession({ authorize: () => {}, revision: () => 0 }, 10)
  let release!: () => void, entered = 0
  const work = sessions.runExclusive('a', () => { entered++; return new Promise<void>(resolve => { release = resolve }) })
  await new Promise(resolve => setImmediate(resolve))
  const queued = sessions.runExclusive('a', async () => { entered++ })
  const workRejected = assert.rejects(work, /stale_email_account/)
  const queuedRejected = assert.rejects(queued, /stale_email_account|email_account_unavailable/)
  await assert.rejects(sessions.invalidate('a'), /email_account_cleanup_failed/)
  assert.throws(() => sessions.capture('a'), /email_account_cleanup_failed/)
  release(); await workRejected; await queuedRejected
  assert.equal(entered, 1)
  await sessions.runExclusive('b', async () => { entered++ })
  assert.equal(entered, 2)
})
test('email account cleanup failure outside invalidate remains blocked instead of allowing another operation', async () => {
  const sessions = new EmailAccountSession({ authorize: () => {}, revision: () => 0 })
  await assert.rejects(sessions.runExclusive('a', async () => { throw new Error('email_account_cleanup_failed') }), /email_account_cleanup_failed/)
  assert.throws(() => sessions.capture('a'), /email_account_cleanup_failed/)
  await sessions.runExclusive('b', async () => {})
})
