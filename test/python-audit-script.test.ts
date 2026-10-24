import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

describe('Fail-Closed Python Dependency Audit (Task 8)', () => {
  const root = process.cwd()
  const auditLockPath = path.join(root, 'jasper-backend', 'requirements-audit.lock')
  const auditScriptPath = path.join(root, 'scripts', 'python-audit.ps1')

  test('requirements-audit.lock pins pip-audit==2.10.1 with SHA-256 hashes', () => {
    assert.equal(fs.existsSync(auditLockPath), true, 'jasper-backend/requirements-audit.lock must exist')
    const lockContent = fs.readFileSync(auditLockPath, 'utf8')
    assert.match(lockContent, /pip-audit==2\.10\.1\b/, 'must pin pip-audit==2.10.1')
    assert.match(lockContent, /--hash=sha256:[a-f0-9]{64}/, 'must include SHA-256 hashes')
  })

  test('scripts/python-audit.ps1 installs hashed requirements-audit.lock in an isolated env and never falls back to hash-only checks', () => {
    assert.equal(fs.existsSync(auditScriptPath), true, 'scripts/python-audit.ps1 must exist')
    const scriptContent = fs.readFileSync(auditScriptPath, 'utf8')

    assert.match(scriptContent, /requirements-audit\.lock/, 'must install from requirements-audit.lock')
    assert.match(scriptContent, /--require-hashes/, 'must enforce --require-hashes when installing audit tooling')
    assert.match(scriptContent, /pip-audit(?:\.exe)?/, 'must invoke pip-audit')
    assert.match(scriptContent, /\$LASTEXITCODE\s*-ne\s*0/, 'must fail closed on non-zero exit codes')
    assert.doesNotMatch(
      scriptContent,
      /pip-audit not in global path; validating pinned dependency hashes/i,
      'must not contain the hash-only fallback when pip-audit is unavailable'
    )
  })
})

