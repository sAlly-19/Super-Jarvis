// Compatibility probe only: no production database, credentials or application boot.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process')
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-sqlite-probe-'))
  const env = { ...process.env, JASPER_SQLITE_PROBE_DIR: temporary }
  delete env.ELECTRON_RUN_AS_NODE
  try {
    require('esbuild').buildSync({
      entryPoints: { 'state-database': path.join(__dirname, '../src/main/storage/state-database.ts'),
        'invocation-store': path.join(__dirname, '../src/main/modules/invocation-store.ts') },
      outdir: temporary, platform: 'node', format: 'cjs', bundle: true
    })
    const result = spawnSync(require('electron'), [__filename], {
      env, stdio: 'inherit', windowsHide: true, timeout: 30000
    })
    if (result.error) console.error(result.error.message)
    process.exitCode = result.status ?? 1
  } finally {
    const resolved = path.resolve(temporary)
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)
        && path.basename(resolved).startsWith('jasper-sqlite-probe-')) {
      fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3 })
    }
  }
} else {
  const { app } = require('electron')
  const assert = require('node:assert/strict')
  const directory = process.env.JASPER_SQLITE_PROBE_DIR
  if (!directory) throw new Error('Missing isolated probe directory')
  app.setPath('userData', path.join(directory, 'profile'))
  app.whenReady().then(() => {
    const { DatabaseSync } = require('node:sqlite')
    const filename = path.join(directory, 'probe.sqlite')
    let db
    try {
      db = new DatabaseSync(filename)
      db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;')
      assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1)
      assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal')
      db.exec('CREATE TABLE tasks (id TEXT PRIMARY KEY, revision INTEGER NOT NULL);')
      db.exec('CREATE TABLE steps (id TEXT PRIMARY KEY, task_id TEXT REFERENCES tasks(id));')
      assert.throws(() => db.prepare('INSERT INTO steps VALUES (?, ?)').run('orphan', 'missing'))
      db.exec('BEGIN IMMEDIATE;')
      db.prepare('INSERT INTO tasks VALUES (?, ?)').run('committed', 1)
      db.exec('COMMIT;')
      db.exec('BEGIN IMMEDIATE;')
      db.prepare('INSERT INTO tasks VALUES (?, ?)').run('rolled-back', 1)
      db.exec('ROLLBACK;')
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM tasks').get().count, 1)
      const update = db.prepare('UPDATE tasks SET revision = revision + 1 WHERE id = ? AND revision = ? RETURNING revision')
      assert.equal(update.get('committed', 1).revision, 2)
      assert.equal(update.get('committed', 1), undefined)
      assert.throws(() => db.prepare('INSERT INTO tasks VALUES (?, ?)').run('committed', 5))
      db.close()
      db = new DatabaseSync(filename)
      assert.equal(db.prepare('SELECT revision FROM tasks WHERE id = ?').get('committed').revision, 2)
      const version = db.prepare('SELECT sqlite_version() AS version').get().version
      console.log(JSON.stringify({ result: 'ELECTRON_SQLITE_PASS', electron: process.versions.electron,
        node: process.versions.node, sqlite: version,
        checks: ['disk persistence', 'commit', 'rollback', 'foreign keys enabled', 'WAL', 'revision CAS', 'unique constraint'] }))
    } finally {
      db?.close()
    }
    const { StateDatabase } = require(path.join(directory, 'state-database.js'))
    const { InvocationStore } = require(path.join(directory, 'invocation-store.js'))
    const sql = name => fs.readFileSync(path.join(__dirname, '../src/main/storage/migrations', name), 'utf8')
    const durableFilename = path.join(directory, 'production-adapter.sqlite')
    let durable
    try {
      durable = new StateDatabase(durableFilename, sql('001-module-state.sql'))
      durable.close()
      durable = new StateDatabase(durableFilename, sql('001-module-state.sql'), [sql('002-capability-invocations.sql')])
      const context = { taskId: 'probe-task', stepId: 'probe-step', invocationId: 'probe-id', sessionId: 1, moduleRevision: 0 }
      assert.equal(new InvocationStore(durable).reserve('run_powershell', context), true)
      durable.close()
      durable = new StateDatabase(durableFilename, sql('001-module-state.sql'), [sql('002-capability-invocations.sql')])
      assert.equal(new InvocationStore(durable).reserve('run_powershell', { ...context, sessionId: 2 }), false)
      console.log('ELECTRON_INVOCATION_STORE_PASS: production adapters, migration, backup and durable deduplication')
    } finally { durable?.close() }
    app.exit(0)
  }).catch(error => {
    console.error('ELECTRON_SQLITE_FAIL:', error.message)
    app.exit(1)
  })
}
