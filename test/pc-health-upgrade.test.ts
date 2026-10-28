import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { StateDatabase } from '../src/main/storage/state-database'
import { PcHealthStore } from '../src/main/modules/pc-health/store'
import { ModuleStore } from '../src/main/modules/store'
import { ModuleRegistry } from '../src/main/modules/registry'
import { ipcMain } from 'electron'
import { registerPcHealthIpc } from '../src/main/ipc/pc-health-ipc'
import { assertTrustedSender } from '../src/main/ipc/register-ipc'
import { IPC_CHANNELS } from '../src/shared'

test('v6 health upgrade preserves existing tables, backs up database, preferences and module switch across reopen', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-health-upgrade-'))
  const names = ['001-module-state.sql','002-capability-invocations.sql','003-tasks.sql','004-task-evidence.sql','005-reminders.sql','006-reminder-imports.sql','007-pc-health.sql']
  const sql = names.map(name => fs.readFileSync(`src/main/storage/migrations/${name}`, 'utf8'))
  const file = path.join(root, 'state.db')
  const open = (version: number) => new StateDatabase(file, sql[0], sql.slice(1, version))
  let db = open(6)
  try {
    db.transaction(tx => { tx.exec('CREATE TABLE fixture_history(value TEXT)'); tx.prepare('INSERT INTO fixture_history VALUES(?)').run('preserved') })
    db.close(); db = open(7)
    const store = new PcHealthStore(db)
    store.update({ intervalSeconds: 60, alertsEnabled: true }, 0)
    assert.equal(store.claimAlert('cpu', 1000000), true)
    const modules = new ModuleStore(path.join(root, 'modules.json'), 'synthetic-installation')
    assert.equal(modules.get('pc-health').enabled, false)
    modules.setEnabled('pc-health', true, 0)
    db.close(); db = open(7)
    assert.equal(new PcHealthStore(db).get().intervalSeconds, 60)
    assert.equal(new PcHealthStore(db).claimAlert('cpu', 1000001), false)
    assert.equal(new ModuleStore(path.join(root, 'modules.json'), 'synthetic-installation').get('pc-health').enabled, true)
    assert.equal(db.transaction(tx => tx.prepare('SELECT value FROM fixture_history').get()!.value), 'preserved')
    assert.ok(fs.readdirSync(root).some(name => name.startsWith('state.db.pre-v7.')))
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }) }
})

test('health IPC denies untrusted frames before module access and its capability accepts no injected operations', () => {
  registerPcHealthIpc(event => assertTrustedSender(event))
  const handler = (ipcMain as any)._handlers.get(IPC_CHANNELS.PC_HEALTH_REFRESH)
  assert.throws(() => handler({ senderFrame: { parent: null, url: 'https://untrusted.example' }, sender: { mainFrame: {} } }), /Untrusted/)
  const registry = new ModuleRegistry(JSON.parse(fs.readFileSync('resources/modules/native-capabilities.json', 'utf8')))
  assert.throws(() => registry.validateInput('pc_health_read', { command: 'injected' }), /unknown/)
  assert.deepEqual(registry.list().filter(item => item.moduleId === 'pc-health').map(item => item.id), ['pc_health_read'])
})
