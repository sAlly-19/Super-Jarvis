import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

describe('commercial release signature workflow', () => {
  test('passes every discovered executable as one array to the verifier in the current PowerShell process', () => {
    const workflow = fs.readFileSync(path.join(process.cwd(), '.github', 'workflows', 'release.yml'), 'utf8')

    assert.match(workflow, /\$binaries\s*=\s*Get-ChildItem[^\n]+-Recurse[^\n]+FullName/)
    assert.match(
      workflow,
      /&\s+\.\\scripts\\verify-authenticode\.ps1\s+-Paths\s+\$binaries\s+-ExpectedPublisher\s+["']CN=Jasper Team, O=Jasper Team, L=Sao Paulo, C=BR["']/,
      'the verifier must receive the complete PowerShell array without crossing a process boundary'
    )
    assert.doesNotMatch(
      workflow,
      /powershell(?:\.exe)?[^\n]+verify-authenticode\.ps1[^\n]+-Paths\s+\$binaries/i,
      'spawning powershell.exe would flatten or lose the executable array'
    )
  })
})
