import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EmailOperationStore } from '../src/main/modules/email/operation-store'
import { EmailOperationCodec } from '../src/main/modules/email/operation-codec'
import { EmailStore } from '../src/main/modules/email/store'
import { emailDatabase } from './fixtures/email/database'
test('email operation diary reserves one dispatch across connections and never replays an interrupted request after reopen', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-email-operation-')), file = path.join(root, 'state.db')
  let db = emailDatabase(file), second = emailDatabase(file)
  try {
    const accounts = new EmailStore(db), account = accounts.upsertIdentity({ provider: 'gmail', subjectId: 'fixture', tenantId: null, address: 'test@example.invalid', displayName: 'Synthetic' }, 'vault')
    const a = new EmailOperationStore(db), b = new EmailOperationStore(second)
    const operation = a.prepare('invocation-fixture', account.id, 'send', 'a'.repeat(64), 'v1:encrypted-fixture')
    assert.equal(b.prepare('invocation-fixture', account.id, 'send', 'a'.repeat(64), null).id, operation.id)
    assert.throws(() => b.prepare('invocation-fixture', account.id, 'send', 'b'.repeat(64), null), /email_invocation_conflict/)
    a.transition(operation.id, 'prepared', 'dispatching')
    assert.throws(() => b.transition(operation.id, 'prepared', 'dispatching'), /stale_email_operation/)
    assert.throws(() => a.transition(operation.id, 'dispatching', 'observed', { accountId: 'another', messageId: 'm' }), /email_account_mismatch/)
    db.close(); second.close(); db = emailDatabase(file); second = emailDatabase(file)
    const restored = new EmailOperationStore(db); restored.interruptDispatches()
    assert.equal(restored.get(operation.id)!.state, 'unknown')
    assert.equal(restored.prepare('invocation-fixture', account.id, 'send', 'a'.repeat(64), null).state, 'unknown')
    assert.throws(() => restored.transition(operation.id, 'unknown', 'dispatching'), /invalid_email_transition/)
    assert.equal(restored.getByInvocation('invocation-fixture')!.id, operation.id)
  } finally { db.close(); second.close(); fs.rmSync(root, { recursive: true, force: true }) }
})
test('email operation codec binds canonical requests to a protected stable key and refuses to replace a corrupted key', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-email-codec-')), file = path.join(root, 'key.json')
  const crypto = { available: () => true, encrypt: (text: string) => Buffer.from(text).reverse(), decrypt: (bytes: Uint8Array) => Buffer.from(bytes).reverse().toString() }
  const codec = new EmailOperationCodec(file, crypto)
  try {
    const first = await codec.fingerprint({ text: 'private-synthetic-body', to: ['recipient@example.invalid'] })
    assert.equal(first, await new EmailOperationCodec(file, crypto).fingerprint({ to: ['recipient@example.invalid'], text: 'private-synthetic-body' }))
    assert.notEqual(first, await codec.fingerprint({ text: 'other' }))
    const sealed = await codec.seal({ nonce: 'private-synthetic-correlation' })
    assert.doesNotMatch(sealed, /private-synthetic/)
    assert.deepEqual(await codec.open(sealed), { nonce: 'private-synthetic-correlation' })
    await assert.rejects(codec.fingerprint({ invalid: () => {} }), /invalid_email_request/)
    fs.writeFileSync(file, 'null')
    await assert.rejects(codec.fingerprint({ text: 'private-synthetic-body' }), /email_operation_key_unavailable/)
    assert.equal(fs.readFileSync(file, 'utf8'), 'null')
    const disabled = new EmailOperationCodec(path.join(root, 'missing.json'), { ...crypto, available: () => false })
    await assert.rejects(disabled.fingerprint({ text: 'x' }), /email_crypto_unavailable/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
