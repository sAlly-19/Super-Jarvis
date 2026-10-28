import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EmailAuth, type EmailAuthDriver } from '../src/main/modules/email/auth'
import { EmailStore } from '../src/main/modules/email/store'
import { EmailTokenVault } from '../src/main/modules/email/token-vault'
import { emailDatabase } from './fixtures/email/database'
import type { EmailScope } from '../src/main/modules/email/contracts'
const scope = (): EmailScope => ({ context: { taskId: 't', stepId: 's', sessionId: 1, moduleRevision: 0, invocationId: 'i' }, signal: new AbortController().signal, check() {} })
const identity = { provider: 'gmail' as const, subjectId: 'subject-fixture', tenantId: null, address: 'test@example.invalid', displayName: 'Synthetic' }
const fixture = (driver: EmailAuthDriver, failWrite = false) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-email-auth-')), db = emailDatabase(), store = new EmailStore(db)
  const vault = new EmailTokenVault(path.join(root, 'vault.json'), { available: () => true, encrypt: text => Buffer.from(text).reverse(), decrypt: bytes => Buffer.from(bytes).reverse().toString() }, failWrite ? () => { throw new Error('fixture write failed') } : undefined)
  const auth = new EmailAuth(store, vault, { gmail: driver }, { authorize() {} })
  return { store, vault, auth, close: async () => { await auth.stop(); db.close(); fs.rmSync(root, { recursive: true, force: true }) } }
}
test('email authentication does not mark an account connected when its vault commit fails', async () => {
  const f = fixture({ authorize: async () => ({ identity, credentials: {} }), access: async () => ({ accessToken: 'fixture', credentials: {} }) }, true)
  try {
    await assert.rejects(f.auth.connect('gmail', scope()), /email_vault_write_failed/)
    assert.equal(f.store.listAccounts().length, 1)
    assert.equal(f.store.listAccounts()[0].status, 'disconnected')
  } finally { await f.close() }
})
test('email authentication serializes refresh, disconnects without late persistence and rejects a missing stored secret', async () => {
  let refreshes = 0, wait = false, entered!: () => void, release!: () => void
  const barrier = new Promise<void>(resolve => { release = resolve }), started = new Promise<void>(resolve => { entered = resolve })
  const driver: EmailAuthDriver = { authorize: async () => ({ identity, credentials: { valid: false } }), access: async credentials => {
    if (!(credentials as { valid: boolean }).valid) { refreshes++; if (wait) { entered(); await barrier } }
    return { accessToken: 'fixture-access', credentials: { valid: true } }
  } }
  const f = fixture(driver)
  try {
    const account = await f.auth.connect('gmail', scope())
    assert.equal(account.status, 'connected')
    assert.deepEqual(await Promise.all([f.auth.accessToken(account.id, scope()), f.auth.accessToken(account.id, scope())]), ['fixture-access', 'fixture-access'])
    assert.equal(refreshes, 1)
    const key = f.store.getVaultRef(account.id)!
    const payload = await f.vault.get(key) as Record<string, unknown>
    await f.vault.put(key, { ...payload, credentials: { valid: false } }); wait = true
    const refreshing = f.auth.accessToken(account.id, scope())
    const rejected = assert.rejects(refreshing, /stale_email_account|email_account_unavailable/)
    await started
    const disconnect = f.auth.disconnect(account.id, scope()); release()
    await disconnect; await rejected
    assert.equal(f.store.getAccount(account.id)!.status, 'disconnected')
    assert.equal(await f.vault.get(key), null)
    await assert.rejects(f.auth.accessToken(account.id, scope()), /email_account_unavailable/)
    const again = await f.auth.connect('gmail', scope())
    await f.vault.remove(f.store.getVaultRef(again.id)!)
    await f.auth.restore(scope())
    assert.equal(f.store.getAccount(again.id)!.status, 'reauth_required')
  } finally { await f.close() }
})
test('email disconnect invalidates an already-open reconnection attempt before it can restore credentials', async () => {
  let attempt = 0, entered!: () => void, release!: () => void
  const started = new Promise<void>(resolve => { entered = resolve }), barrier = new Promise<void>(resolve => { release = resolve })
  const f = fixture({ authorize: async () => { if (++attempt > 1) { entered(); await barrier }; return { identity, credentials: {} } }, access: async () => ({ accessToken: 'fixture', credentials: {} }) })
  try {
    const account = await f.auth.connect('gmail', scope())
    const reconnect = f.auth.connect('gmail', scope()), rejected = assert.rejects(reconnect, /stale_email_account/)
    await started; await f.auth.disconnect(account.id, scope()); release(); await rejected
    assert.equal(f.store.getAccount(account.id)!.status, 'disconnected')
    assert.equal(await f.vault.get(f.store.getVaultRef(account.id)!), null)
  } finally { release(); await f.close() }
})
test('email disconnect during reconnect cleanup cannot be undone after a pending refresh exits', async () => {
  let enter!: () => void, release!: () => void, aborted!: () => void
  const entered = new Promise<void>(resolve => { enter = resolve }), barrier = new Promise<void>(resolve => { release = resolve }), aborting = new Promise<void>(resolve => { aborted = resolve })
  const f = fixture({ authorize: async () => ({ identity, credentials: {} }), access: async (_credentials, scope) => {
    scope.signal.addEventListener('abort', () => aborted(), { once: true }); enter(); await barrier
    return { accessToken: 'fixture', credentials: {} }
  } })
  try {
    const account = await f.auth.connect('gmail', scope())
    const refresh = f.auth.accessToken(account.id, scope()), refreshRejected = assert.rejects(refresh, /stale_email_account|email_account_unavailable/)
    await entered
    const reconnect = f.auth.connect('gmail', scope()), reconnectRejected = assert.rejects(reconnect, /stale_email_account/)
    await aborting
    const disconnect = f.auth.disconnect(account.id, scope()); release()
    await disconnect; await refreshRejected; await reconnectRejected
    assert.equal(f.store.getAccount(account.id)!.status, 'disconnected')
    assert.equal(await f.vault.get(f.store.getVaultRef(account.id)!), null)
  } finally { release(); await f.close() }
})
