import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
test('web panel real Electron acceptance uses synthetic data without public networking', { timeout: 25000 }, () => {
  const result = spawnSync(process.execPath, ['scripts/test-web-ui.cjs'], { encoding: 'utf8', windowsHide: true, timeout: 22000 })
  assert.equal(result.status, 0, (result.stdout || '') + (result.stderr || ''))
  assert.match(result.stdout, /WEB_UI_PASS/)
})
