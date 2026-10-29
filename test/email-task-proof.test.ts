import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ModulePolicy } from '../src/main/modules/policy'
import { ModuleRegistry } from '../src/main/modules/registry'
import { emailDatabase } from './fixtures/email/database'
import { emailAcceptanceHost } from './fixtures/email/acceptance-host'
test('Graph 202 remains accepted in Main proof without asserting delivery and revocation invalidates proof', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jasper-email-graph-proof-')), db = emailDatabase()
  let enabled = true
  const registry = new ModuleRegistry(JSON.parse(await fs.readFile('resources/modules/native-capabilities.json', 'utf8')))
  const policy = new ModulePolicy(registry, { requireAgentAccess() {}, getSessionId: () => 1,
    getSnapshot: id => ({ id, enabled: id === 'email' && enabled, authorized: true, configured: true, health: 'healthy', lifecycle: 'running', revision: 0 }),
    getPermissions: id => registry.list().filter(item => item.moduleId === id).flatMap(item => item.permissions) })
  const host = emailAcceptanceHost(db, root, policy), signal = new AbortController().signal
  const context = { taskId: 't', stepId: 's', sessionId: 1, moduleRevision: 0, invocationId: 'read' }
  try {
    const maliciousRef = { accountId: host.gmail.id, messageId: 'same-message-id' }
    const malicious = await host.service.execute('email_read', { ref: maliciousRef }, { ...context, invocationId: 'untrusted-read' }, signal)
    await assert.rejects(host.service.execute('email_reply', { ref: maliciousRef, expectedVersion: malicious.version, text: 'Attempt from untrusted email', attachmentHandles: ['forged-private-file-ticket'] }, { ...context, invocationId: 'forged-file' }, signal), /email_file_authority/)
    assert.equal(host.counters.sends, 0); assert.equal(host.counters.requests.some(request => request.includes(':POST:')), false)
    const ref = { accountId: host.outlook.id, messageId: 'same-message-id' }, read = await host.service.execute('email_read', { ref }, context, signal)
    const sending = { ...context, invocationId: 'reply' }
    const data = await host.service.execute('email_reply', { ref, expectedVersion: read.version, text: 'Synthetic response', attachmentHandles: [] }, sending, signal)
    assert.equal(data.kind, 'write'); if (data.kind !== 'write') throw new Error('expected write')
    assert.equal(data.operation.state, 'accepted', JSON.stringify({ operation: data.operation, requests: host.counters.requests })); assert.equal(host.counters.sends, 1)
    assert.equal(host.service.verify(sending, 'email_reply', { status: 'unknown', data, evidence: [] }).status, 'succeeded')
    assert.equal('delivered' in data.operation, false)
    enabled = false
    assert.equal(host.service.verify(sending, 'email_reply', { status: 'unknown', data, evidence: [] }).status, 'unknown')
  } finally { await host.service.stop(); db.close(); await fs.rm(root, { recursive: true, force: true }) }
})
