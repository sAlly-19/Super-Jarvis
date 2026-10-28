import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { EmailAttachmentInfo } from '../../../shared/types/email'
import type { EmailScope, PreparedEmailAttachment } from './contracts'
import { checkEmailFileScope, EMAIL_FILE_LIMIT, emailFileIdentity, inspectEmailPath, readEmailFile, safeEmailFilename } from './desktop-files'
interface Dependencies {
  selectFiles(): Promise<string[]>
  selectDirectory(): Promise<string | null>
  download(info: EmailAttachmentInfo, scope: EmailScope): AsyncIterable<Uint8Array>
  now?(): number
}
interface Ticket { accountId: string; sessionId: number; revision: number; generation: number; expires: number; filename: string; identity: string; hash?: string; size: number; kind: 'upload' | 'directory' }
export class EmailAttachments {
  private readonly tickets = new Map<string, Ticket>()
  private generation = 0
  constructor(private readonly deps: Dependencies) {}
  private now(): number { return this.deps.now?.() ?? Date.now() }
  private check(scope: EmailScope, generation = this.generation): void {
    checkEmailFileScope(scope); if (generation !== this.generation) throw new Error('email_file_authority')
  }
  private put(ticket: Ticket): string {
    for (const [key, value] of this.tickets) if (value.expires <= this.now()) this.tickets.delete(key)
    if (this.tickets.size >= 100) throw new Error('email_file_ticket_limit')
    const handle = randomUUID(); this.tickets.set(handle, ticket); return handle
  }
  private get(handle: string, accountId: string, kind: Ticket['kind'], scope: EmailScope): Ticket {
    this.check(scope)
    const ticket = this.tickets.get(handle)
    if (!ticket || ticket.accountId !== accountId || ticket.kind !== kind || ticket.sessionId !== scope.context.sessionId || ticket.revision !== scope.context.moduleRevision || ticket.generation !== this.generation || ticket.expires <= this.now()) throw new Error('email_file_authority')
    return ticket
  }
  async selectUploads(accountId: string, scope: EmailScope): Promise<Array<{ handle: string; name: string; sizeBytes: number }>> {
    const generation = this.generation; this.check(scope)
    const filenames = await this.deps.selectFiles(); this.check(scope, generation)
    if (filenames.length > 10) throw new Error('email_attachment_limit')
    const staged: Array<{ ticket: Ticket; name: string }> = []; let total = 0
    for (const filename of filenames) {
      const result = await readEmailFile(filename, scope); this.check(scope, generation)
      total += result.bytes.length; if (total > EMAIL_FILE_LIMIT) throw new Error('email_attachment_limit')
      staged.push({ name: safeEmailFilename(path.basename(filename)), ticket: { accountId, sessionId: scope.context.sessionId, revision: scope.context.moduleRevision, generation, expires: this.now() + 300000, filename, identity: result.identity, hash: result.hash, size: result.bytes.length, kind: 'upload' } })
    }
    if (this.tickets.size + staged.length > 100) throw new Error('email_file_ticket_limit')
    return staged.map(({ ticket, name }) => ({ handle: this.put(ticket), name, sizeBytes: ticket.size }))
  }
  async resolveUploads(handles: string[], accountId: string, scope: EmailScope): Promise<ReadonlyArray<PreparedEmailAttachment>> {
    if (!Array.isArray(handles) || handles.length > 10 || new Set(handles).size !== handles.length) throw new Error('email_attachment_limit')
    const generation = this.generation, result: PreparedEmailAttachment[] = []; let total = 0
    for (const handle of handles) {
      const ticket = this.get(handle, accountId, 'upload', scope), file = await readEmailFile(ticket.filename, scope)
      this.check(scope, generation)
      if (file.identity !== ticket.identity || file.hash !== ticket.hash) throw new Error('email_file_changed')
      total += file.bytes.length; if (total > EMAIL_FILE_LIMIT) throw new Error('email_attachment_limit')
      result.push({ name: safeEmailFilename(path.basename(ticket.filename)), contentType: 'application/octet-stream', bytes: file.bytes })
    }
    return result
  }
  async chooseDownloadDirectory(accountId: string, scope: EmailScope): Promise<string | null> {
    const generation = this.generation; this.check(scope)
    const filename = await this.deps.selectDirectory(); this.check(scope, generation)
    if (!filename) return null
    const stat = await inspectEmailPath(filename, true); this.check(scope, generation)
    // Directory timestamps change as files are added; only its filesystem identity is bound.
    return this.put({ accountId, sessionId: scope.context.sessionId, revision: scope.context.moduleRevision, generation, expires: this.now() + 300000, filename, identity: `${stat.dev}:${stat.ino}`, size: 0, kind: 'directory' })
  }
  async download(info: EmailAttachmentInfo, destinationHandle: string, scope: EmailScope): Promise<{ receiptRef: string; name: string; sizeBytes: number }> {
    const generation = this.generation, ticket = this.get(destinationHandle, info.ref.accountId, 'directory', scope)
    if (info.sizeBytes !== null && (!Number.isSafeInteger(info.sizeBytes) || info.sizeBytes < 0 || info.sizeBytes > EMAIL_FILE_LIMIT)) throw new Error('email_attachment_limit')
    const directory = await inspectEmailPath(ticket.filename, true)
    if (`${directory.dev}:${directory.ino}` !== ticket.identity) throw new Error('email_file_changed')
    const temporary = path.join(ticket.filename, `.jasper-${randomUUID()}.part`)
    const output = await fs.open(temporary, 'wx', 0o600); let size = 0, published: string | null = null
    try {
      for await (const chunk of this.deps.download(info, scope)) {
        this.check(scope, generation); size += chunk.byteLength
        if (size > EMAIL_FILE_LIMIT || info.sizeBytes !== null && size > info.sizeBytes) throw new Error('email_attachment_size')
        await output.writeFile(chunk)
      }
      if (info.sizeBytes !== null && size !== info.sizeBytes) throw new Error('email_attachment_size')
      await output.sync(); await output.close(); this.check(scope, generation)
      const current = await inspectEmailPath(ticket.filename, true)
      if (`${current.dev}:${current.ino}` !== ticket.identity) throw new Error('email_file_changed')
      const base = safeEmailFilename(info.name)
      for (let i = 0; i < 100; i++) {
        const name = i ? `${i}-${base}` : base, target = path.join(ticket.filename, name)
        try { await fs.link(temporary, target); published = target; this.check(scope, generation); return { receiptRef: randomUUID(), name, sizeBytes: size } }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
      }
      throw new Error('email_file_collision_limit')
    } catch (error) {
      if (published) {
        const [tempStat, publishedStat] = await Promise.all([fs.stat(temporary), fs.lstat(published)]).catch(() => [null, null])
        if (tempStat && publishedStat && emailFileIdentity(tempStat) === emailFileIdentity(publishedStat)) await fs.unlink(published).catch(() => {})
      }
      if (error instanceof Error && /^email_/.test(error.message)) throw error
      scope.signal.throwIfAborted(); throw new Error('email_file_unavailable')
    } finally { await output.close().catch(() => {}); await fs.unlink(temporary).catch(() => {}) }
  }
  clear(): void { this.generation++; this.tickets.clear() }
}
