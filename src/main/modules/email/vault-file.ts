import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

async function exists(filename: string): Promise<boolean> {
  try { await fs.access(filename); return true }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}
/** Local vault files only. Caller serializes all access to the resolved path. */
export async function readEmailVaultDocument(filename: string): Promise<unknown> {
  if (!await exists(filename)) {
    if (!await exists(`${filename}.bak`)) return undefined
    await fs.rename(`${filename}.bak`, filename)
  }
  const handle = await fs.open(filename, 'r')
  try {
    const stat = await handle.stat(), limit = 4 * 1024 * 1024
    if (!stat.isFile() || stat.size > limit) throw new Error('email_vault_unavailable')
    const buffer = Buffer.alloc(stat.size + 1)
    let count = 0
    while (count < buffer.length) {
      const { bytesRead } = await handle.read(buffer, count, buffer.length - count, count)
      if (!bytesRead) break
      count += bytesRead
    }
    if (count > stat.size) throw new Error('email_vault_unavailable')
    return JSON.parse(buffer.subarray(0, count).toString('utf8')) as unknown
  } finally { await handle.close() }
}
export async function writeEmailVaultDocument(filename: string, value: unknown, rename: (source: string, target: string) => Promise<void> = fs.rename): Promise<void> {
  await fs.mkdir(path.dirname(filename), { recursive: true })
  const temporary = `${filename}.tmp.${randomUUID()}`, backup = `${filename}.bak`
  let moved = false
  try {
    const handle = await fs.open(temporary, 'wx', 0o600)
    try { await handle.writeFile(JSON.stringify(value), 'utf8'); await handle.sync() } finally { await handle.close() }
    if (await exists(filename)) {
      await fs.rm(backup, { force: true })
      await rename(filename, backup); moved = true
    }
    await rename(temporary, filename)
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {})
    if (moved && !await exists(filename) && await exists(backup)) await rename(backup, filename)
    throw error
  }
  if (moved) {
    // The document is committed. Housekeeping must not imply a rollback.
    await fs.rm(backup, { force: true }).catch(() => {})
  }
}
