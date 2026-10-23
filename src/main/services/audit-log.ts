import fs from 'fs'
import path from 'path'
import { app } from 'electron'

export interface AuditEvent {
  timestamp?: string
  event: string
  tool?: string
  durationMs?: number
  status?: string
  details?: Record<string, any>
}

export interface AuditLogOptions {
  logDir?: string
  maxSizeBytes?: number
  maxFiles?: number
}

const SECRET_PATTERNS = [
  /AIza[0-9A-Za-z-_]{30,}/g,
  /gsk_[0-9A-Za-z]{16,}/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+/g,
  /Bearer\s+[A-Za-z0-9._-]+/gi,
  /"password"\s*:\s*"[^"]+"/gi
]

const FORBIDDEN_DETAIL_KEYS = new Set([
  'rawcommand',
  'command',
  'transcript',
  'usertext',
  'audiobase64',
  'screenshotbase64',
  'screenshot',
  'audio',
  'modelresponse',
  'fullresponse'
])

const SENSITIVE_KEY_NAMES = new Set([
  'apikey',
  'geminikey',
  'groqkey',
  'jwt',
  'authheader',
  'password',
  'secret',
  'token',
  'authorization'
])

export class AuditLog {
  private logDir: string
  private maxSizeBytes: number
  private maxFiles: number
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(options: AuditLogOptions = {}) {
    if (options.logDir) {
      this.logDir = options.logDir
    } else {
      try {
        this.logDir = path.join(app.getPath('userData'), 'logs')
      } catch {
        this.logDir = path.join(process.cwd(), 'logs')
      }
    }
    this.maxSizeBytes = options.maxSizeBytes ?? 5 * 1024 * 1024
    this.maxFiles = options.maxFiles ?? 5
  }

  private sanitizeDetails(details?: Record<string, any>): Record<string, any> | undefined {
    if (!details || typeof details !== 'object') return undefined
    const cleaned: Record<string, any> = {}

    for (const [key, val] of Object.entries(details)) {
      const lowerKey = key.toLowerCase()
      if (FORBIDDEN_DETAIL_KEYS.has(lowerKey)) {
        continue
      }
      if (SENSITIVE_KEY_NAMES.has(lowerKey)) {
        cleaned[key] = '[REDACTED]'
        continue
      }
      if (typeof val === 'string') {
        let sanitized = val
        for (const pattern of SECRET_PATTERNS) {
          sanitized = sanitized.replace(pattern, '[REDACTED]')
        }
        cleaned[key] = sanitized
      } else if (val && typeof val === 'object' && !Array.isArray(val)) {
        cleaned[key] = this.sanitizeDetails(val)
      } else {
        cleaned[key] = val
      }
    }
    return cleaned
  }

  public async write(event: AuditEvent): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      await this.performWrite(event)
    })
    return this.writeQueue
  }

  private async performWrite(event: AuditEvent): Promise<void> {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true })
    }

    const payload: AuditEvent = {
      timestamp: event.timestamp || new Date().toISOString(),
      event: event.event,
      tool: event.tool,
      durationMs: event.durationMs,
      status: event.status,
      details: this.sanitizeDetails(event.details)
    }

    let line = JSON.stringify(payload) + '\n'
    for (const pattern of SECRET_PATTERNS) {
      line = line.replace(pattern, '[REDACTED]')
    }

    const primaryFile = path.join(this.logDir, 'audit.jsonl')
    let currentSize = 0
    if (fs.existsSync(primaryFile)) {
      currentSize = fs.statSync(primaryFile).size
    }

    if (currentSize + Buffer.byteLength(line, 'utf-8') > this.maxSizeBytes) {
      this.rotateFiles(primaryFile)
    }

    fs.appendFileSync(primaryFile, line, 'utf-8')
  }

  private rotateFiles(primaryFile: string): void {
    const oldestFile = path.join(this.logDir, `audit.${this.maxFiles - 1}.jsonl`)
    if (fs.existsSync(oldestFile)) {
      fs.rmSync(oldestFile, { force: true })
    }

    for (let i = this.maxFiles - 2; i >= 1; i--) {
      const src = path.join(this.logDir, `audit.${i}.jsonl`)
      const dst = path.join(this.logDir, `audit.${i + 1}.jsonl`)
      if (fs.existsSync(src)) {
        fs.renameSync(src, dst)
      }
    }

    if (fs.existsSync(primaryFile)) {
      fs.renameSync(primaryFile, path.join(this.logDir, 'audit.1.jsonl'))
    }
  }
}

export const auditLog = new AuditLog()
