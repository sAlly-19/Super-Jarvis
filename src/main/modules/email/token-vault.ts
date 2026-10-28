import path from 'node:path'
import { readEmailVaultDocument, writeEmailVaultDocument } from './vault-file'
import type { VaultCrypto } from './contracts'

const queues = new Map<string, Promise<unknown>>()
const limit = 2 * 1024 * 1024
export class EmailTokenVault {
  private readonly filename: string
  private readonly queueKey: string
  constructor(filename: string, private readonly crypto: VaultCrypto, private readonly write: (filename: string, data: unknown) => Promise<void> | void = writeEmailVaultDocument) {
    this.filename = path.resolve(filename)
    this.queueKey = process.platform === 'win32' ? this.filename.toLowerCase() : this.filename
  }
  private exclusive<T>(work: () => Promise<T> | T): Promise<T> {
    const previous = queues.get(this.queueKey) ?? Promise.resolve()
    const current = previous.catch(() => {}).then(work)
    queues.set(this.queueKey, current)
    const cleanup = () => { if (queues.get(this.queueKey) === current) queues.delete(this.queueKey) }
    void current.then(cleanup, cleanup)
    return current
  }
  private async read(): Promise<Record<string, unknown>> {
    if (!this.crypto.available()) throw new Error('email_crypto_unavailable')
    try {
      const raw = await readEmailVaultDocument(this.filename)
      if (raw === undefined) return Object.create(null)
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error()
      const document = raw as { schemaVersion: number; ciphertext: string }
      if (document.schemaVersion !== 1 || typeof document.ciphertext !== 'string' || !document.ciphertext || Object.keys(document).some(key => !['schemaVersion', 'ciphertext'].includes(key))) throw new Error()
      const plaintext = this.crypto.decrypt(Buffer.from(document.ciphertext, 'base64'))
      if (Buffer.byteLength(plaintext) > limit) throw new Error()
      const data: unknown = JSON.parse(plaintext)
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error()
      return data as Record<string, unknown>
    } catch { throw new Error('email_vault_unavailable') }
  }
  private async persist(data: Record<string, unknown>): Promise<void> {
    if (!this.crypto.available()) throw new Error('email_crypto_unavailable')
    try {
      const plaintext = JSON.stringify(data)
      if (Buffer.byteLength(plaintext) > limit) throw new Error()
      const encrypted = this.crypto.encrypt(plaintext)
      if (!encrypted.length) throw new Error()
      await this.write(this.filename, { schemaVersion: 1, ciphertext: Buffer.from(encrypted).toString('base64') })
    } catch { throw new Error('email_vault_write_failed') }
  }
  private id(accountId: string) { if (!/^[a-zA-Z0-9_-]{1,160}$/.test(accountId) || ['__proto__', 'constructor', 'prototype'].includes(accountId)) throw new Error('invalid_email_account') }
  get(accountId: string): Promise<unknown | null> {
    return this.exclusive(async () => { this.id(accountId); const data = await this.read(); return Object.hasOwn(data, accountId) ? structuredClone(data[accountId]) : null })
  }
  put(accountId: string, payload: unknown): Promise<void> {
    return this.exclusive(async () => {
      this.id(accountId)
      let value: unknown
      try { value = JSON.parse(JSON.stringify(payload)) } catch { throw new Error('invalid_email_vault_payload') }
      const data = await this.read(); data[accountId] = value; await this.persist(data)
    })
  }
  remove(accountId: string): Promise<void> {
    return this.exclusive(async () => { this.id(accountId); const data = await this.read(); if (Object.hasOwn(data, accountId)) { delete data[accountId]; await this.persist(data) } })
  }
}
