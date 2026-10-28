import path from 'node:path'
import { createHmac, randomBytes } from 'node:crypto'
import type { VaultCrypto } from './contracts'
import { readEmailVaultDocument, writeEmailVaultDocument } from './vault-file'
const locks = new Map<string, Promise<unknown>>()
function canonical(value: unknown): string {
  const seen = new Set<object>()
  const normalize = (input: unknown, depth: number): unknown => {
    if (depth > 32) throw new Error('invalid_email_request')
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input
    if (typeof input === 'number' && Number.isFinite(input)) return input
    if (!input || typeof input !== 'object' || seen.has(input)) throw new Error('invalid_email_request')
    if (!Array.isArray(input) && ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error('invalid_email_request')
    seen.add(input)
    const result = Array.isArray(input) ? input.map(value => normalize(value, depth + 1)) : Object.fromEntries(Object.keys(input).sort().map(key => [key, normalize((input as Record<string, unknown>)[key], depth + 1)]))
    seen.delete(input)
    return result
  }
  const text = JSON.stringify(normalize(value, 0))
  if (Buffer.byteLength(text) > 1048576) throw new Error('invalid_email_request')
  return text
}
export class EmailOperationCodec {
  private readonly filename: string
  constructor(filename: string, private readonly crypto: VaultCrypto) { this.filename = path.resolve(filename) }
  private async key(): Promise<Buffer> {
    if (!this.crypto.available()) throw new Error('email_crypto_unavailable')
    const pathKey = process.platform === 'win32' ? this.filename.toLowerCase() : this.filename
    const current = (locks.get(pathKey) ?? Promise.resolve()).catch(() => {}).then(async () => {
      if (!this.crypto.available()) throw new Error('email_crypto_unavailable')
      try {
        const raw = await readEmailVaultDocument(this.filename)
        if (raw === undefined) {
          const key = randomBytes(32)
          const ciphertext = Buffer.from(this.crypto.encrypt(key.toString('base64'))).toString('base64')
          if (!ciphertext) throw new Error()
          await writeEmailVaultDocument(this.filename, { schemaVersion: 1, ciphertext })
          return key
        }
        const document = raw as { schemaVersion: number; ciphertext: string }
        if (!document || document.schemaVersion !== 1 || typeof document.ciphertext !== 'string' || Object.keys(document).some(key => !['schemaVersion', 'ciphertext'].includes(key))) throw new Error()
        const key = Buffer.from(this.crypto.decrypt(Buffer.from(document.ciphertext, 'base64')), 'base64')
        if (key.length !== 32) throw new Error()
        return key
      } catch { throw new Error('email_operation_key_unavailable') }
    })
    locks.set(pathKey, current)
    const cleanup = () => { if (locks.get(pathKey) === current) locks.delete(pathKey) }
    void current.then(cleanup, cleanup)
    return current
  }
  async fingerprint(value: unknown): Promise<string> { const text = canonical(value); return createHmac('sha256', await this.key()).update(text).digest('hex') }
  async seal(value: unknown): Promise<string> {
    if (!this.crypto.available()) throw new Error('email_crypto_unavailable')
    const text = canonical(value)
    if (Buffer.byteLength(text) > 65536) throw new Error('invalid_email_correlation')
    try { return `v1:${Buffer.from(this.crypto.encrypt(text)).toString('base64')}` }
    catch { throw new Error('email_operation_crypto_failed') }
  }
  async open(ciphertext: string): Promise<unknown> {
    if (!this.crypto.available()) throw new Error('email_crypto_unavailable')
    try {
      if (!/^v1:[A-Za-z0-9+/]+={0,2}$/.test(ciphertext) || ciphertext.length > 262144) throw new Error()
      const text = this.crypto.decrypt(Buffer.from(ciphertext.slice(3), 'base64'))
      if (Buffer.byteLength(text) > 65536) throw new Error()
      return JSON.parse(text) as unknown
    } catch { throw new Error('email_operation_crypto_failed') }
  }
}
