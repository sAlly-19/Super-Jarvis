import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'

function recoverBackup(filePath: string): void {
  const backupPath = `${filePath}.bak`
  if (!fs.existsSync(filePath) && fs.existsSync(backupPath)) {
    fs.renameSync(backupPath, filePath)
  }
}

export function readJsonFileSync<T>(filePath: string): T {
  recoverBackup(filePath)
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
}

export function atomicWriteJsonSync(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })

  const temporaryPath = `${filePath}.tmp.${randomUUID()}`
  const backupPath = `${filePath}.bak`
  fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), { encoding: 'utf-8', mode: 0o600 })

  let movedExistingFile = false
  try {
    if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath)
    if (fs.existsSync(filePath)) {
      fs.renameSync(filePath, backupPath)
      movedExistingFile = true
    }
    fs.renameSync(temporaryPath, filePath)
  } catch (error) {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath)
    if (!fs.existsSync(filePath) && movedExistingFile && fs.existsSync(backupPath)) {
      fs.renameSync(backupPath, filePath)
    }
    throw error
  }

  // The rename above committed the new document. Backup housekeeping must not
  // report that committed write as a failure or trigger rollback semantics.
  if (movedExistingFile) {
    try {
      if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath)
    } catch {
      // Preserve the backup for later cleanup; never log its path or contents.
      console.warn('[AtomicJSON] Write committed; backup cleanup deferred.')
    }
  }
}
