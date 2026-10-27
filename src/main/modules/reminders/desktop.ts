import { dialog } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getMainWindow, safeSend } from '../../windows/main-window'
import { IPC_CHANNELS } from '../../../shared'
import type { ReminderOverdueSummary } from '../../../shared/types/reminders'

const limit = 2 * 1024 * 1024
async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let abort: (() => void) | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      abort = () => reject(new Error('reminder_job_aborted'))
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })])
  } finally { if (abort) signal.removeEventListener('abort', abort) }
}
export async function chooseCalendar(signal: AbortSignal): Promise<Uint8Array | null> {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) throw new Error('reminder_window_unavailable')
  const result = await abortable(dialog.showOpenDialog(win, { title: 'Importar calendário', properties: ['openFile'], filters: [{ name: 'iCalendar', extensions: ['ics'] }] }), signal)
  signal.throwIfAborted()
  if (result.canceled || result.filePaths.length !== 1) return null
  const file = await fs.open(result.filePaths[0], 'r')
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > limit) throw new Error('ical_size_limit')
    const buffer = Buffer.alloc(limit + 1)
    let count = 0
    while (count < buffer.length) {
      signal.throwIfAborted()
      const read = await file.read(buffer, count, buffer.length - count, count)
      if (!read.bytesRead) break
      count += read.bytesRead
    }
    if (count > limit) throw new Error('ical_size_limit')
    return Uint8Array.from(buffer.subarray(0, count))
  } finally { await file.close() }
}
async function fingerprint(target: string): Promise<string | null> {
  try { const stat = await fs.stat(target); if (!stat.isFile()) throw new Error('invalid_export_target'); return `${stat.ino}:${stat.size}:${stat.mtimeMs}` }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
}
export async function saveCalendar(bytes: Uint8Array, signal: AbortSignal, check: () => void): Promise<boolean> {
  check()
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > limit) throw new Error('ical_size_limit')
  const win = getMainWindow()
  if (!win || win.isDestroyed()) throw new Error('reminder_window_unavailable')
  const selected = await abortable(dialog.showSaveDialog(win, { title: 'Exportar lembretes', defaultPath: 'lembretes.ics', filters: [{ name: 'iCalendar', extensions: ['ics'] }], properties: ['showOverwriteConfirmation'] }), signal)
  check()
  if (selected.canceled || !selected.filePath) return false
  const destination = selected.filePath, previous = await fingerprint(destination)
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${randomUUID()}.tmp`)
  let created = false
  try {
    check()
    const file = await fs.open(temporary, 'wx'); created = true
    try { await file.writeFile(bytes) } finally { await file.close() }
    check()
    if (await fingerprint(destination) !== previous) throw new Error('export_target_changed')
    check(); await fs.rename(temporary, destination)
    return true
  } finally { if (created) await fs.rm(temporary, { force: true }) }
}

export function createReminderPresentation(invalidated: () => void) {
  let tracked: ReturnType<typeof getMainWindow> = null, session = randomUUID()
  const invalidate = () => { session = randomUUID(); invalidated() }
  const detach = () => {
    if (tracked && !tracked.webContents.isDestroyed()) {
      tracked.webContents.removeListener('did-start-loading', invalidate)
      tracked.webContents.removeListener('destroyed', invalidate)
    }
    tracked = null
  }
  const sessionId = () => {
    const win = getMainWindow()
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return null
    if (win !== tracked) {
      detach(); tracked = win; session = randomUUID()
      win.webContents.on('did-start-loading', invalidate); win.webContents.on('destroyed', invalidate)
    }
    return session
  }
  return {
    sessionId,
    present: (batch: ReminderOverdueSummary) => { if (!sessionId()) return false; safeSend(IPC_CHANNELS.REMINDERS_OVERDUE, batch); return true },
    changed: () => { if (sessionId()) safeSend(IPC_CHANNELS.REMINDERS_CHANGED, null) },
    close: () => { detach(); invalidate() }
  }
}
