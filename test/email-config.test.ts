import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readEmailPublisherConfig } from '../src/main/modules/email/publisher-config'
test('email publisher configuration is optional, strict and restricts Microsoft authority', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-email-config-'))
  const file = path.join(root, 'resources/email-oauth.json')
  try {
    assert.equal(readEmailPublisherConfig(root), null)
    fs.mkdirSync(path.dirname(file))
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, google: { clientId: 'synthetic.apps.googleusercontent.com' }, microsoft: null }))
    assert.equal(readEmailPublisherConfig(root)!.google!.clientId, 'synthetic.apps.googleusercontent.com')
    for (const config of [
      { schemaVersion: 1, google: null, microsoft: { clientId: 'x', authority: 'https://evil.invalid' } },
      { schemaVersion: 1, google: null, microsoft: null, token: 'unexpected' },
      { schemaVersion: 1, google: { clientId: '', unexpected: true }, microsoft: null }
    ]) {
      fs.writeFileSync(file, JSON.stringify(config))
      assert.throws(() => readEmailPublisherConfig(root), /invalid_email_publisher_config/)
    }
    fs.writeFileSync(file, '{broken')
    assert.throws(() => readEmailPublisherConfig(root), /invalid_email_publisher_config/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
