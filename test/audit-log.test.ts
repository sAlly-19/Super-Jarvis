import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { AuditLog, type AuditEvent } from '../src/main/services/audit-log'

describe('Local Audit Log Redaction & Rotation (audit-log.ts)', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-audit-test-'))
  })

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test('records event metadata with timestamp and sanitized outcome', async () => {
    const logger = new AuditLog({ logDir: tmpDir })
    await logger.write({
      event: 'tool_call',
      tool: 'run_command',
      durationMs: 142,
      status: 'success',
      details: { exitCode: 0 }
    })

    const logFile = path.join(tmpDir, 'audit.jsonl')
    assert.ok(fs.existsSync(logFile), 'audit.jsonl must exist')
    const lines = fs.readFileSync(logFile, 'utf-8').trim().split('\n')
    assert.equal(lines.length, 1)

    const parsed = JSON.parse(lines[0])
    assert.equal(parsed.event, 'tool_call')
    assert.equal(parsed.tool, 'run_command')
    assert.equal(parsed.durationMs, 142)
    assert.equal(parsed.status, 'success')
    assert.ok(parsed.timestamp, 'timestamp must be present')
  })

  test('strictly redacts API keys, JWT tokens, and bearer secrets from details', async () => {
    const logger = new AuditLog({ logDir: tmpDir })
    await logger.write({
      event: 'api_call',
      tool: 'litellm',
      status: 'error',
      details: {
        geminiKey: 'AIzaSyA1234567890abcdefghijklmnopqrstuv',
        groqKey: 'gsk_1234567890abcdef1234567890abcdef',
        jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
        authHeader: 'Bearer secret-auth-token-12345',
        password: 'my-super-secret-password'
      }
    })

    const logFile = path.join(tmpDir, 'audit.jsonl')
    const content = fs.readFileSync(logFile, 'utf-8')
    assert.ok(!content.includes('AIzaSyA1234567890abcdefghijklmnopqrstuv'), 'Gemini key must be redacted')
    assert.ok(!content.includes('gsk_1234567890abcdef1234567890abcdef'), 'Groq key must be redacted')
    assert.ok(!content.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'), 'JWT must be redacted')
    assert.ok(!content.includes('my-super-secret-password'), 'Password must be redacted')
    assert.ok(content.includes('[REDACTED]'))
  })

  test('never persists raw command, transcript, audio or screenshot binary', async () => {
    const logger = new AuditLog({ logDir: tmpDir })
    await logger.write({
      event: 'agent_turn',
      tool: 'exec_shell',
      status: 'completed',
      details: {
        rawCommand: 'rm -rf /sensitive/data',
        transcript: 'o usuário disse coisas confidenciais',
        audioBase64: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
        screenshotBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
      } as any
    })

    const logFile = path.join(tmpDir, 'audit.jsonl')
    const content = fs.readFileSync(logFile, 'utf-8')
    assert.ok(!content.includes('rm -rf /sensitive/data'))
    assert.ok(!content.includes('o usuário disse coisas confidenciais'))
    assert.ok(!content.includes('UklGRiQAAABXQVZF'))
    assert.ok(!content.includes('iVBORw0KGgoAAA'))
  })

  test('rotates log files when size exceeds 5 MiB and retains up to 5 files', async () => {
    // Test with smaller cap to verify rotation mechanism
    const maxSizeBytes = 1024
    const logger = new AuditLog({ logDir: tmpDir, maxSizeBytes, maxFiles: 3 })

    const bigEvent: AuditEvent = {
      event: 'tool_execution',
      tool: 'disk_audit',
      status: 'success',
      durationMs: 50,
      details: { filler: 'A'.repeat(300) }
    }

    // Write enough entries to cause rotations
    for (let i = 0; i < 15; i++) {
      await logger.write(bigEvent)
    }

    assert.ok(fs.existsSync(path.join(tmpDir, 'audit.jsonl')))
    assert.ok(fs.existsSync(path.join(tmpDir, 'audit.1.jsonl')))
    assert.ok(fs.existsSync(path.join(tmpDir, 'audit.2.jsonl')))
    // Should not retain more than maxFiles (3 files total: audit.jsonl, audit.1.jsonl, audit.2.jsonl)
    assert.ok(!fs.existsSync(path.join(tmpDir, 'audit.3.jsonl')))
  })
})
