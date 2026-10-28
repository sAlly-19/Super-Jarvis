import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeEmailText } from '../src/main/modules/email/message-text'
test('email text normalization removes active/remote content and bounds UTF-8 without splitting characters', () => {
  const result = normalizeEmailText({ html: '<script>privateScript()</script><style>.secret{}</style><p>Olá &amp; mundo</p><img src="https://remote.invalid/tracker"><a href="https://remote.invalid/link">Texto</a>' })
  assert.match(result.text, /Olá & mundo/)
  assert.doesNotMatch(result.text, /privateScript|secret|https:|tracker/)
  const long = normalizeEmailText({ text: '🙂'.repeat(40000) })
  assert.equal(long.truncated, true)
  assert.ok(Buffer.byteLength(long.text, 'utf8') <= 102400)
  assert.doesNotMatch(long.text, /\uFFFD/)
  assert.equal(normalizeEmailText({ text: 'Plain', html: '<p>Other</p>' }).text, 'Plain')
})
