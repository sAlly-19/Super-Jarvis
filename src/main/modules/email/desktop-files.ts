import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { EmailScope } from './contracts'
export const EMAIL_FILE_LIMIT = 10485760
export function checkEmailFileScope(scope: EmailScope): void { scope.signal.throwIfAborted(); scope.check() }
export async function inspectEmailPath(filename: string, directory = false): Promise<Awaited<ReturnType<typeof fs.stat>>> {
  try {
    const absolute = path.resolve(filename)
    if (!path.isAbsolute(filename) || absolute !== filename) throw new Error()
    let part = absolute
    while (true) {
      const stat = await fs.lstat(part)
      if (stat.isSymbolicLink()) throw new Error()
      const parent = path.dirname(part); if (parent === part) break; part = parent
    }
    const stat = await fs.stat(absolute)
    const resolved = await fs.stat(await fs.realpath(absolute))
    if (resolved.dev !== stat.dev || resolved.ino !== stat.ino) throw new Error()
    if (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1) throw new Error()
    return stat
  } catch { throw new Error('email_file_unavailable') }
}
export function emailFileIdentity(stat: Awaited<ReturnType<typeof fs.stat>>): string {
  return [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':')
}
export async function readEmailFile(filename: string, scope: EmailScope): Promise<{ bytes: Buffer; identity: string; hash: string }> {
  checkEmailFileScope(scope)
  const before = await inspectEmailPath(filename), identity = emailFileIdentity(before)
  if (before.size > EMAIL_FILE_LIMIT) throw new Error('email_attachment_limit')
  const handle = await fs.open(filename, 'r').catch(() => { throw new Error('email_file_unavailable') })
  try {
    if (emailFileIdentity(await handle.stat()) !== identity) throw new Error('email_file_changed')
    const parts: Buffer[] = []; let size = 0
    while (true) {
      checkEmailFileScope(scope)
      const buffer = Buffer.alloc(65536), { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
      if (!bytesRead) break
      size += bytesRead; if (size > EMAIL_FILE_LIMIT) throw new Error('email_attachment_limit')
      parts.push(buffer.subarray(0, bytesRead))
    }
    if (emailFileIdentity(await handle.stat()) !== identity || emailFileIdentity(await inspectEmailPath(filename)) !== identity) throw new Error('email_file_changed')
    checkEmailFileScope(scope)
    const bytes = Buffer.concat(parts)
    return { bytes, identity, hash: createHash('sha256').update(bytes).digest('hex') }
  } finally { await handle.close() }
}
export function safeEmailFilename(value: string): string {
  let name = value.normalize('NFKC').replace(/[\x00-\x1f\x7f\\/:*?"<>|]/g, '_').replace(/^\.+|[. ]+$/g, '').slice(0, 120)
  if (!name || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) name = `attachment_${name || 'file'}`
  if (/\.(?:exe|com|bat|cmd|ps1|vbs|js|jse|wsf|scr|msi|lnk|url|hta|reg)$/i.test(name)) name += '.download'
  return name
}
