import fs from 'node:fs'
import path from 'node:path'
import type { EmailPublisherConfig } from '../../../shared/types/email'
function object(value: unknown, required: string[], optional: string[] = []): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => ![...required, ...optional].includes(key))) throw new Error('invalid_email_publisher_config')
}
function string(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= 2048 && !/[\u0000-\u0020]/.test(value) }
export function readEmailPublisherConfig(root: string): EmailPublisherConfig | null {
  const file = path.join(root, 'resources/email-oauth.json')
  let bytes: Buffer
  try { bytes = fs.readFileSync(file) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('invalid_email_publisher_config') }
  try {
    if (bytes.length > 16384) throw new Error()
    const value: unknown = JSON.parse(bytes.toString('utf8'))
    object(value, ['schemaVersion', 'google', 'microsoft'])
    if (value.schemaVersion !== 1) throw new Error()
    if (value.google !== null) {
      object(value.google, ['clientId'], ['desktopClientSecret'])
      if (!string(value.google.clientId) || (value.google.desktopClientSecret !== undefined && !string(value.google.desktopClientSecret))) throw new Error()
    }
    if (value.microsoft !== null) {
      object(value.microsoft, ['clientId', 'authority'])
      if (!string(value.microsoft.clientId) || value.microsoft.authority !== 'https://login.microsoftonline.com/common') throw new Error()
    }
    return value as unknown as EmailPublisherConfig
  } catch { throw new Error('invalid_email_publisher_config') }
}
