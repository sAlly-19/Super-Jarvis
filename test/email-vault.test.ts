import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { EmailTokenVault } from '../src/main/modules/email/token-vault'
import type { VaultCrypto } from '../src/main/modules/email/contracts'
import fsp from 'node:fs/promises'
const cryptoFixture = (): VaultCrypto => {
  const key = randomBytes(32)
  return { available: () => true,
    encrypt: text => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); const bytes = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), bytes]) },
    decrypt: bytes => { const b = Buffer.from(bytes), cipher = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12)); cipher.setAuthTag(b.subarray(12, 28)); return Buffer.concat([cipher.update(b.subarray(28)), cipher.final()]).toString('utf8') }
  }
}
test('email vault serializes writes across instances, encrypts all payloads and preserves other accounts on removal', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-email-vault-')), file = path.join(root, 'vault.json'), crypto = cryptoFixture()
  try {
    const a = new EmailTokenVault(file, crypto), b = new EmailTokenVault(file, crypto)
    await Promise.all([a.put('account-a', { refresh: 'synthetic-private-a' }), b.put('account-b', { cache: 'synthetic-private-b' })])
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /synthetic-private|account-a|account-b/)
    assert.deepEqual(await a.get('account-a'), { refresh: 'synthetic-private-a' })
    await Promise.all([a.remove('account-a'), b.put('account-c', { access: 'synthetic-private-c' })])
    assert.equal(await b.get('account-a'), null)
    assert.deepEqual(await b.get('account-b'), { cache: 'synthetic-private-b' })
    assert.deepEqual(await a.get('account-c'), { access: 'synthetic-private-c' })
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
test('email vault fails closed without crypto, preserves the last committed document on write error and refuses corrupt ciphertext', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-email-vault-fail-')), file = path.join(root, 'vault.json'), crypto = cryptoFixture()
  try {
    await assert.rejects(new EmailTokenVault(file, { ...crypto, available: () => false }).put('a', { token: 'fixture' }), /email_crypto_unavailable/)
    assert.equal(fs.existsSync(file), false)
    const good = new EmailTokenVault(file, crypto); await good.put('a', { token: 'fixture' })
    const before = fs.readFileSync(file)
    const broken = new EmailTokenVault(file, crypto, () => { throw new Error('private filename') })
    await assert.rejects(broken.put('a', { token: 'replacement' }), /^Error: email_vault_write_failed$/)
    assert.deepEqual(fs.readFileSync(file), before)
    assert.deepEqual(await good.get('a'), { token: 'fixture' })
    fs.writeFileSync(file, '{broken')
    await assert.rejects(good.get('a'), /email_vault_unavailable/)
    await assert.rejects(good.put('b', {}), /email_vault_unavailable/)
    assert.equal(fs.readFileSync(file, 'utf8'), '{broken')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
test('email vault awaits asynchronous commits instead of resolving before the credential document is durable', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-email-vault-async-')), file = path.join(root, 'vault.json')
  let entered!: () => void, release!: () => void, finished!: () => void, resolved = false
  const writing = new Promise<void>(done => { entered = done }), barrier = new Promise<void>(done => { release = done }), written = new Promise<void>(done => { finished = done })
  const vault = new EmailTokenVault(file, cryptoFixture(), async (filename, data) => { entered(); await barrier; try { await fsp.writeFile(filename, JSON.stringify(data)) } finally { finished() } })
  const pending = vault.put('a', { token: 'synthetic' }).then(() => { resolved = true })
  try {
    await writing; await new Promise(done => setImmediate(done))
    assert.equal(resolved, false, 'vault returned before its async commit completed')
  } finally { release(); await pending; await written; fs.rmSync(root, { recursive: true, force: true }) }
})
test('email vault does not adopt a JSON null file as an empty credential store', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-email-vault-null-')), file = path.join(root, 'vault.json')
  try {
    fs.writeFileSync(file, 'null')
    const vault = new EmailTokenVault(file, cryptoFixture())
    await assert.rejects(vault.put('a', { token: 'fixture' }), /email_vault_unavailable/)
    assert.equal(fs.readFileSync(file, 'utf8'), 'null')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
