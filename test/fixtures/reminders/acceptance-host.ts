import { app, BrowserWindow, ipcMain, session } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { StateDatabase } from '../../../src/main/storage/state-database'
import { TaskStore } from '../../../src/main/tasks/task-store'
import { RemindersStore } from '../../../src/main/modules/reminders/store'
import { ReminderCalendar } from '../../../src/main/modules/reminders/calendar'
import { RemindersService } from '../../../src/main/modules/reminders/service'
import { RemindersImportService } from '../../../src/main/modules/reminders/import-service'
import { RemindersDashboard } from '../../../src/main/modules/reminders/dashboard'
import { ICalendarCodec } from '../../../src/main/modules/reminders/ical-client'
import { ReminderScheduler } from '../../../src/main/modules/reminders/scheduler'
import { ModuleRegistry } from '../../../src/main/modules/registry'
import { ModulePolicy } from '../../../src/main/modules/policy'

const [archive, temporary, fixture, output] = process.argv.slice(2)
app.setPath('userData', path.join(temporary, 'profile'))
const timeout = setTimeout(() => { console.error('REMINDERS_ACCEPTANCE_TIMEOUT'); app.exit(2) }, 45000)
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => callback({ cancel: true }))
  const scripts = ['001-module-state.sql', '002-capability-invocations.sql', '003-tasks.sql', '004-task-evidence.sql', '005-reminders.sql', '006-reminder-imports.sql'].map(name => fs.readFileSync(path.join(archive, 'src/main/storage/migrations', name), 'utf8'))
  const filename = path.join(temporary, 'state.db')
  let database = new StateDatabase(filename, scripts[0], scripts.slice(1, 4))
  const previous = new TaskStore(database).create('chat', 1)
  database.close()
  database = new StateDatabase(filename, scripts[0], scripts.slice(1))
  assert.equal(new TaskStore(database).get(previous.taskId)!.taskId, previous.taskId)
  assert.ok(fs.readdirSync(temporary).some(name => name.startsWith('state.db.pre-v5.') && name.endsWith('.bak')))
  assert.ok(fs.readdirSync(temporary).some(name => name.startsWith('state.db.pre-v6.') && name.endsWith('.bak')))
  const store = new RemindersStore(database, new ReminderCalendar(), 'UTC')
  const registry = new ModuleRegistry(JSON.parse(fs.readFileSync(path.join(archive, 'resources/modules/native-capabilities.json'), 'utf8')))
  let allowed = true, acknowledgements = 0, unexpectedToasts = 0
  const gate = () => { if (!allowed) throw new Error('test_access_denied') }
  const policy = new ModulePolicy(registry, { requireAgentAccess: gate, getSessionId: () => 1,
    getSnapshot: id => ({ id, enabled: true, configured: true, authorized: allowed, health: 'healthy', lifecycle: 'running', revision: 0 }),
    getPermissions: id => registry.list().filter(capability => capability.moduleId === id).flatMap(capability => capability.permissions) })
  const reminders = new RemindersService(store, registry, { nowUtc: () => '2026-10-27T00:00:00.000Z', authorize: (id, context) => { if (!policy.authorize(id, context).allowed) throw new Error('denied') } })
  const codec = new ICalendarCodec(path.join(archive, 'out/main/reminders-ical-worker.js'))
  const win = new BrowserWindow({ show: false, width: 1180, height: 900, webPreferences: { preload: path.join(temporary, 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false, offscreen: true } })
  const scheduler = new ReminderScheduler(store, { allowed: () => allowed, nowUtc: () => '2028-01-01T00:00:00.000Z',
    notifier: { supported: () => false, prepare: () => { unexpectedToasts++; throw new Error('toasts forbidden') } },
    presenter: { sessionId: () => win.isDestroyed() ? null : 'fixture-window', present: batch => { win.webContents.send('fixture:overdue', batch); return true } } })
  let exported = false
  const dashboard = new RemindersDashboard(store, reminders, new RemindersImportService(store, gate), codec, {
    authorize: gate, sessionId: () => win.isDestroyed() ? null : 'fixture-window',
    context: () => ({ taskId: 'fixture', stepId: 'ui', invocationId: randomUUID(), sessionId: 1, moduleRevision: 0 }),
    chooseImport: async () => Uint8Array.from(fs.readFileSync(fixture)),
    exportFile: async (bytes, signal, check) => { signal.throwIfAborted(); check(); fs.writeFileSync(path.join(temporary, 'export.ics'), bytes); const parsed = await codec.parse(bytes, store.getPreferences(), signal); assert.equal(parsed.candidates.length, 3); exported = true; return true },
    changed: () => win.webContents.send('fixture:changed')
  })
  const methods: Record<string, (...args: any[]) => any> = {
    listModules: () => [{ id: 'reminders', enabled: true, authorized: allowed, configured: true, health: 'healthy', lifecycle: 'running', revision: 0 }],
    listReminders: query => dashboard.list(query), getReminder: id => dashboard.get(id), mutateReminder: request => dashboard.mutate(request),
    reminderPreferences: request => dashboard.preferences(request), importReminders: request => dashboard.import(request), exportReminders: request => dashboard.export(request),
    getOverdueReminders: (cursor, batchId) => { gate(); return store.pendingBatch(cursor, batchId) },
    acknowledgeOverdueReminders: (id, total) => { const result = scheduler.acknowledgeBatch(id, total); if (result) acknowledgements++; return result },
    recover: async () => { await scheduler.recover('2028-01-01T00:00:00.000Z') },
    acknowledged: () => acknowledgements > 0,
    ready: async () => {
      assert.equal(exported, true); assert.equal(store.list({ limit: 100 }).items.length, 3)
      assert.ok(acknowledgements > 0); assert.equal(unexpectedToasts, 0)
      const dom = await win.webContents.executeJavaScript(`(()=>{const summary=document.getElementById('reminders-overdue');const rect=summary.getBoundingClientRect();return {rows:document.querySelectorAll('#reminders-list .reminder-row').length,summaryVisible:!summary.hidden && summary.contains(document.elementFromPoint(rect.left+30,rect.top+20))}})()`)
      assert.equal(dom.rows, 3); assert.equal(dom.summaryVisible, true)
      fs.writeFileSync(path.join(output, 'reminders-ui.png'), (await win.webContents.capturePage()).toPNG())
      win.once('closed', () => { void (async () => {
        allowed = false; scheduler.stop(); await dashboard.close(); database.close()
        const reopened = new StateDatabase(filename, scripts[0], scripts.slice(1))
        try {
          assert.equal(new RemindersStore(reopened, new ReminderCalendar(), 'UTC').list({ limit: 100 }).items.length, 3)
          assert.equal(new TaskStore(reopened).get(previous.taskId)!.taskId, previous.taskId)
          const history = reopened.transaction(tx => JSON.stringify(tx.prepare('SELECT * FROM task_events').all()))
          assert.equal(history.includes('ACCEPTANCE_REMINDER'), false)
        } finally { reopened.close() }
        fs.writeFileSync(path.join(output, 'reminders-acceptance.json'), JSON.stringify({ mode: 'isolated-harness-against-packaged-resources', commercialRuntimeUnlocked: false, provider: 'none', network: 'blocked', pathSanitized: true, packagedWorker: true, upgradeFromV4: true, persistedAfterClose: true, acknowledgements, unexpectedToasts, syntheticDataOnly: true }, null, 2))
        console.log('REMINDERS_ACCEPTANCE_PASS'); clearTimeout(timeout); app.exit(0)
      })().catch(fail) })
      setImmediate(() => win.close())
    }
  }
  ipcMain.handle('fixture:call', (event, method: string, ...args) => {
    if (event.sender !== win.webContents || !Object.hasOwn(methods, method)) throw new Error('untrusted_fixture_call')
    return methods[method](...args)
  })
  win.webContents.on('console-message', (_event, _level, message) => { if (message.includes('REMINDERS_ACCEPTANCE_FAIL')) fail(new Error(message)) })
  await win.loadFile(path.join(temporary, 'index.html'))
}).catch(fail)
function fail(error: unknown) { console.error(String(error)); clearTimeout(timeout); app.exit(1) }
