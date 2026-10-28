import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { ModuleRegistry } from '../src/main/modules/registry'
test('email catalog declares twelve bounded Main tools with exact verifiers and no login or arbitrary file path tool', () => {
  const definitions = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'resources/modules/native-capabilities.json'), 'utf8'))
  const registry = new ModuleRegistry(definitions)
  const email = registry.list().filter(item => item.moduleId === 'email')
  assert.equal(email.length, 12)
  for (const item of email) { assert.equal(item.timeoutMs, 30000); assert.equal(item.cancellable, true); assert.equal(item.inputSchema.additionalProperties, false); assert.ok(['email_read', 'email_write', 'email_file'].includes(item.verifierId!)) }
  registry.validateInput('email_search', { limit: 10 })
  registry.validateInput('email_reply', { ref: { accountId: 'a', messageId: 'm' }, expectedVersion: 'v', text: 'Fixture', attachmentHandles: [] })
  for (const args of [{ limit: 51 }, { limit: 10, token: 'untrusted' }, { limit: 10, accountIds: [] }]) assert.throws(() => registry.validateInput('email_search', args))
  assert.throws(() => registry.validateInput('email_download_attachment', { ref: { accountId: 'a', messageId: 'm' }, attachmentId: 'f', path: 'C:\\private' }))
  assert.throws(() => registry.validateInput('email_reply', { ref: { accountId: 'a', messageId: 'm', token: 'x' }, expectedVersion: 'v', text: 'Fixture', attachmentHandles: [] }))
})
