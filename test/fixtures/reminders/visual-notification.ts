import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { StateDatabase } from '../../../src/main/storage/state-database'
import { ReminderCalendar } from '../../../src/main/modules/reminders/calendar'
import { RemindersStore } from '../../../src/main/modules/reminders/store'
import { ReminderScheduler } from '../../../src/main/modules/reminders/scheduler'
import { createVisualReminderNotifier } from '../../../src/main/modules/reminders/visual-notifier'

const [, , profile, projectRoot, screenshot] = process.argv
app.setPath('userData', profile)
app.whenReady().then(async () => {
  const names = ['001-module-state.sql', '002-capability-invocations.sql', '003-tasks.sql', '004-task-evidence.sql', '005-reminders.sql']
  const scripts = names.map(name => fs.readFileSync(path.join(projectRoot, 'src/main/storage/migrations', name), 'utf8'))
  const database = new StateDatabase(':memory:', scripts[0], scripts.slice(1))
  const store = new RemindersStore(database, new ReminderCalendar(), 'UTC')
  const main = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  const now = new Date(), due = new Date(Math.ceil(now.getTime() / 1000) * 1000 + 2000).toISOString()
  const scheduler = new ReminderScheduler(store, { allowed: () => true, nowUtc: () => due, notifier: createVisualReminderNotifier(undefined, () => main) })
  try {
    const item = store.mutate({ type: 'create', title: 'TESTE VISUAL DO JASPER', description: '<script>external()</script>', schedule: {
      policy: 'jasper', localDateTime: due.slice(0, 19), timeZone: 'UTC', recurrence: 'none', anchorDay: Number(due.slice(8, 10))
    } }, { invocationId: 'isolated-visual', nowUtc: now.toISOString() }).items[0]
    scheduler.tick(due)
    const deadline = Date.now() + 10000
    while (store.occurrences(item.id)[0].state !== 'notified') {
      if (Date.now() > deadline) throw new Error('Visual notification was not presented')
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    const windows = BrowserWindow.getAllWindows()
    assert.equal(windows.length, 2)
    const popup = windows.find(window => window !== main)!
    assert.equal(popup.isVisible(), true)
    assert.equal(popup.isAlwaysOnTop(), true)
    const page = await popup.webContents.executeJavaScript(`({text:document.body.textContent,scripts:document.scripts.length,node:typeof require,api:typeof window.electronAPI})`)
    assert.match(page.text, /TESTE VISUAL DO JASPER/)
    assert.match(page.text, /<script>external\(\)<\/script>/)
    assert.equal(page.scripts, 0); assert.equal(page.node, 'undefined'); assert.equal(page.api, 'undefined')
    await new Promise(resolve => setTimeout(resolve, 200))
    fs.writeFileSync(screenshot, (await popup.webContents.capturePage()).toPNG())
    const closed = new Promise<void>(resolve => popup.once('closed', () => resolve()))
    main.close()
    await closed
    assert.equal(popup.isDestroyed(), true)
    assert.equal(main.isDestroyed(), true)
    console.log('REMINDERS_VISUAL_PASS: real window visible; isolated synthetic reminder; no native toast or commercial runtime access')
    app.exit(0)
  } catch (error) { console.error(error); app.exit(1) }
  finally { scheduler.stop(); database.close() }
}).catch(error => { console.error(error); app.exit(1) })
