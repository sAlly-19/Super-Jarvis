import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { startEmailApplication } from '../src/main/modules/email/application'
import { emailDatabase } from './fixtures/email/database'
import { EmailStore } from '../src/main/modules/email/store'
test('persisted connected metadata is unavailable until credential restore verifies the protected vault', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jasper-email-app-')), database = emailDatabase(), store = new EmailStore(database)
  let account = store.upsertIdentity({ provider: 'gmail', subjectId: 's', tenantId: null, address: 'fixture@example.invalid', displayName: 'Fixture' }, 'missing')
  account = store.setConnection(account.id, 'connected', account.revision)
  const runtime = startEmailApplication({ database, profileRoot: root, publisherRoot: root, config: () => ({ schemaVersion: 1, google: { clientId: 'synthetic' }, microsoft: null }),
    crypto: { available: () => true, encrypt: text => Buffer.from(text), decrypt: bytes => Buffer.from(bytes).toString() },
    authorizeAgent() {}, authorizeManagement() {}, moduleRevision: () => 0, sessionId: () => 1, openBrowser: async () => {}, selectFiles: async () => [], selectDirectory: async () => null, changed() {} })
  try {
    assert.equal(runtime.status().health, 'unavailable')
    await runtime.restore()
    assert.equal(runtime.status().health, 'unavailable'); assert.equal(store.getAccount(account.id)!.status, 'reauth_required')
  } finally { await runtime.stop(); database.close(); await fs.rm(root, { recursive: true, force: true }) }
})
test('email composition allows first account connection without advertising a healthy mailbox before credentials commit', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jasper-email-app-')), database = emailDatabase()
  let enabled = true, configured = true, opened = 0
  const runtime = startEmailApplication({ database, profileRoot: root, publisherRoot: root,
    config: () => configured ? { schemaVersion: 1, google: { clientId: 'synthetic-client' }, microsoft: null } : null,
    crypto: { available: () => true, encrypt: text => Buffer.from(text).reverse(), decrypt: bytes => Buffer.from(bytes).reverse().toString() },
    authorizeAgent() {}, authorizeManagement() { if (!enabled) throw new Error('module_unavailable') }, moduleRevision: () => 0, sessionId: () => 1,
    openBrowser: async () => { opened++ }, selectFiles: async () => [], selectDirectory: async () => null, changed() {},
    drivers: () => ({ gmail: { authorize: async () => ({ identity: { provider: 'gmail', subjectId: 's', tenantId: null, address: 'fixture@example.invalid', displayName: 'Fixture' }, credentials: { refresh: 'synthetic' } }), access: async credentials => ({ credentials, accessToken: 'synthetic' }) } }) })
  try {
    assert.equal(runtime.status().health, 'unavailable')
    const account = await runtime.connect('gmail')
    assert.equal(runtime.status().health, 'healthy'); assert.equal(opened, 0)
    await runtime.disconnect(account.id, account.revision)
    assert.equal(runtime.status().health, 'unavailable')
    const reconnected = await runtime.connect('gmail'); assert.equal(reconnected.id, account.id)
    enabled = false; await assert.rejects(runtime.connect('gmail'), /module_unavailable/)
    enabled = true; configured = false; await assert.rejects(runtime.connect('gmail'), /email_oauth_not_configured/)
    assert.equal(runtime.status().health, 'unavailable')
  } finally { await runtime.stop(); database.close(); await fs.rm(root, { recursive: true, force: true }) }
})
