import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ModuleStore } from '../src/main/modules/store'
import { StateDatabase } from '../src/main/storage/state-database'

test('module settings persist, reject stale revision and preserve invalid stored data', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-module-store-'))
  try {
    const filename = path.join(root, 'modules.json')
    const store = new ModuleStore(filename, 'installation-a')
    assert.equal(store.get('computer').enabled, true)
    assert.equal(store.get('email').enabled, false)
    assert.equal(store.setEnabled('computer', false, 0).revision, 1)
    assert.throws(() => store.setEnabled('computer', true, 0), /stale/)
    assert.equal(new ModuleStore(filename, 'installation-a').get('computer').enabled, false)
    assert.throws(() => new ModuleStore(filename, 'installation-b'), /installation/)
    fs.writeFileSync(filename, '{invalid')
    assert.throws(() => new ModuleStore(filename, 'installation-a'))
    assert.equal(fs.readFileSync(filename, 'utf8'), '{invalid')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('database rolls back on exception and rejects async transaction callbacks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-state-db-'))
  const filename = path.join(root, 'state.sqlite')
  const migration = fs.readFileSync(path.join(process.cwd(), 'src/main/storage/migrations/001-module-state.sql'), 'utf8')
  let db: StateDatabase | undefined
  try {
    db = new StateDatabase(filename, migration)
    assert.throws(() => db!.transaction(tx => { tx.exec("INSERT INTO module_events (module_id, revision, outcome) VALUES ('computer', 1, 'stopped')"); throw new Error('abort') }))
    assert.equal(db.transaction(tx => tx.prepare('SELECT COUNT(*) AS n FROM module_events').get()!.n), 0)
    assert.throws(() => db!.transaction(async () => {}), /async/)
    db.transaction(tx => tx.exec("INSERT INTO module_events (module_id, revision, outcome) VALUES ('computer', 1, 'stopped')"))
    db.close()
    db = new StateDatabase(filename, migration)
    assert.equal(db.transaction(tx => tx.prepare('SELECT COUNT(*) AS n FROM module_events').get()!.n), 1)
  } finally { db?.close(); fs.rmSync(root, { recursive: true, force: true }) }
})
