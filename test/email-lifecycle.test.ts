import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ModuleRegistry } from '../src/main/modules/registry'
import { ModulePolicy } from '../src/main/modules/policy'
import { EmailOperationStore } from '../src/main/modules/email/operation-store'
import { emailDatabase } from './fixtures/email/database'
import { emailAcceptanceHost } from './fixtures/email/acceptance-host'
test('lost send response stays unknown across restart with no replay and metadata-only operation history', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jasper-email-restart-')), filename = path.join(root, 'state.db')
  const registry = new ModuleRegistry(JSON.parse(await fs.readFile('resources/modules/native-capabilities.json', 'utf8')))
  const policy = new ModulePolicy(registry, { requireAgentAccess() {}, getSessionId: () => 1,
    getSnapshot: id => ({ id, enabled: true, configured: true, authorized: true, health: 'healthy', lifecycle: 'running', revision: 0 }),
    getPermissions: id => registry.list().filter(item => item.moduleId === id).flatMap(item => item.permissions) })
  let database = emailDatabase(filename), host = emailAcceptanceHost(database, root, policy)
  const context = { taskId: 't', stepId: 's', sessionId: 1, moduleRevision: 0, invocationId: 'read' }, signal = new AbortController().signal
  try {
    const ref = { accountId: host.gmail.id, messageId: 'same-message-id' }, read = await host.service.execute('email_read', { ref }, context, signal)
    host.counters.loseSendResponse = true
    const args = { ref, expectedVersion: read.version, text: 'PRIVATE_SYNTHETIC_REPLY', attachmentHandles: [] }
    const invocation = { ...context, invocationId: 'uncertain-send' }
    const result = await host.service.execute('email_reply', args, invocation, signal)
    assert.equal(result.kind, 'write'); if (result.kind !== 'write') throw new Error('expected write')
    assert.equal(result.operation.state, 'unknown'); assert.equal(host.counters.sends, 1)
    const operationId = result.operation.id
    await host.service.stop(); database.close()
    database = emailDatabase(filename); new EmailOperationStore(database).interruptDispatches()
    assert.equal(new EmailOperationStore(database).get(operationId)!.state, 'unknown')
    host = emailAcceptanceHost(database, root, policy)
    const replay = await host.service.execute('email_reply', args, invocation, signal)
    assert.equal(replay.kind, 'write'); if (replay.kind !== 'write') throw new Error('expected write')
    assert.equal(replay.operation.id, operationId); assert.equal(replay.operation.state, 'unknown'); assert.equal(host.counters.sends, 0)
    const records = database.transaction(tx => tx.prepare('SELECT * FROM email_operations').all())
    assert.doesNotMatch(JSON.stringify(records), /PRIVATE_SYNTHETIC_REPLY|synthetic-access-token/)
  } finally { await host.service.stop(); database.close(); await fs.rm(root, { recursive: true, force: true }) }
})
