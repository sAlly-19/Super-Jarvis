import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { MEMORY_ENVELOPE_BYTES, memoryChanged, memoryUnavailable, type ProtectedMemoryEnvelope } from './contracts'
import { exactObject } from './source-codec'

export interface SourceFileSnapshot { document: unknown; fingerprint: string | null }
export interface SourceFileAccess {
  read(filePath: string): SourceFileSnapshot
  readBackup(filePath: string): SourceFileSnapshot
  commit(filePath: string, envelope: ProtectedMemoryEnvelope, expectedFingerprint: string | null, check: () => void): void
}
type WriteOps = Pick<typeof fs, 'renameSync' | 'writeFileSync' | 'fsyncSync'>
const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === 'ENOENT'

function readOne(filePath: string): SourceFileSnapshot {
  let fd: number | undefined
  try {
    let named: fs.Stats
    try { named = fs.lstatSync(filePath) } catch (error) { if (missing(error)) return { document: null, fingerprint: null }; throw error }
    if (!named.isFile() || named.isSymbolicLink() || named.size > MEMORY_ENVELOPE_BYTES) throw memoryUnavailable()
    fd = fs.openSync(filePath, 'r')
    const opened = fs.fstatSync(fd)
    if (!opened.isFile() || opened.dev !== named.dev || opened.ino !== named.ino || opened.size > MEMORY_ENVELOPE_BYTES) throw memoryUnavailable()
    const pieces: Buffer[] = []; let total = 0
    for (;;) {
      const piece = Buffer.allocUnsafe(Math.min(65536, MEMORY_ENVELOPE_BYTES + 1 - total))
      const size = fs.readSync(fd, piece, 0, piece.length, null)
      if (!size) break
      total += size
      if (total > MEMORY_ENVELOPE_BYTES) throw memoryUnavailable()
      pieces.push(piece.subarray(0, size))
    }
    const bytes = Buffer.concat(pieces, total)
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { document: JSON.parse(text), fingerprint: createHash('sha256').update(bytes).digest('hex') }
  } catch { throw memoryUnavailable() }
  finally { if (fd !== undefined) fs.closeSync(fd) }
}
function backupExists(filePath: string): boolean {
  for (const suffix of ['.bak', '.protected.bak', '.migration-v2.bak']) {
    try { fs.lstatSync(filePath + suffix); return true } catch (error) { if (!missing(error)) throw memoryUnavailable() }
  }
  return false
}
const protectedShape = (value: unknown): value is ProtectedMemoryEnvelope => exactObject(value, ['schemaVersion', 'sealed'])
  && value.schemaVersion === 2 && typeof value.sealed === 'string' && value.sealed.length > 0

export function createSourceFileAccess(overrides: Partial<WriteOps> = {}): SourceFileAccess {
  const io: WriteOps = { renameSync: fs.renameSync, writeFileSync: fs.writeFileSync, fsyncSync: fs.fsyncSync, ...overrides }
  const read = (filePath: string) => {
    const value = readOne(filePath)
    // An old backup can contain a deliberately deleted fact. Never silently restore it.
    if (value.fingerprint === null && backupExists(filePath)) throw memoryUnavailable()
    return value
  }
  const cleanup = (temporary: string | undefined) => {
    if (temporary) try { fs.unlinkSync(temporary) } catch { /* Only our freshly created temporary file; preserve the original error. */ }
  }
  function temporary(destination: string, value: ProtectedMemoryEnvelope): string {
    const text = JSON.stringify(value)
    if (Buffer.byteLength(text) > MEMORY_ENVELOPE_BYTES) throw memoryUnavailable()
    const filename = destination + '.tmp.' + randomUUID()
    const fd = fs.openSync(filename, 'wx', 0o600)
    try { io.writeFileSync(fd, text, { encoding: 'utf8' }); io.fsyncSync(fd) }
    catch (error) { fs.closeSync(fd); cleanup(filename); throw error }
    fs.closeSync(fd)
    return filename
  }
  return {
    read,
    readBackup: filePath => readOne(filePath + '.protected.bak'),
    commit(filePath, envelope, expectedFingerprint, check) {
      let primaryTemporary: string | undefined, backupTemporary: string | undefined
      try {
        check()
        if (!protectedShape(envelope)) throw memoryUnavailable()
        const current = read(filePath)
        if (current.fingerprint !== expectedFingerprint) throw memoryChanged()
        const oldBackup = readOne(filePath + '.protected.bak')
        if (oldBackup.fingerprint !== null && !protectedShape(oldBackup.document)) throw memoryUnavailable()
        fs.mkdirSync(path.dirname(filePath), { recursive: true })
        if (fs.lstatSync(path.dirname(filePath)).isSymbolicLink()) throw memoryUnavailable()
        primaryTemporary = temporary(filePath, envelope)
        if (current.fingerprint !== null) {
          // The first migration backs up the protected equivalent, never the legacy plaintext.
          const previous = protectedShape(current.document) ? current.document : envelope
          backupTemporary = temporary(filePath + '.protected.bak', previous)
          check()
          if (read(filePath).fingerprint !== expectedFingerprint || readOne(filePath + '.protected.bak').fingerprint !== oldBackup.fingerprint) throw memoryChanged()
          io.renameSync(backupTemporary, filePath + '.protected.bak'); backupTemporary = undefined
        }
        check()
        if (read(filePath).fingerprint !== expectedFingerprint) throw memoryChanged()
        // Node uses replacement rename on Windows. Never unlink the original to force success.
        io.renameSync(primaryTemporary, filePath); primaryTemporary = undefined
      } catch (error) {
        if (error instanceof Error && error.message === 'memory_changed') throw memoryChanged()
        throw memoryUnavailable()
      } finally { cleanup(primaryTemporary); cleanup(backupTemporary) }
    }
  }
}
export const readSourceFile = (filePath: string): SourceFileSnapshot => createSourceFileAccess().read(filePath)
export const commitProtected = (filePath: string, envelope: ProtectedMemoryEnvelope, expectedFingerprint: string | null, check: () => void): void =>
  createSourceFileAccess().commit(filePath, envelope, expectedFingerprint, check)
