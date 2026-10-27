import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { powerMonitor } from 'electron'
import { StateDatabase } from '../src/main/storage/state-database'
import { RemindersStore } from '../src/main/modules/reminders/store'
import { ReminderCalendar } from '../src/main/modules/reminders/calendar'
import { startRemindersApplication } from '../src/main/modules/reminders/application'

test('process-local scheduler suspends, recovers on resume and removes listeners before database close', async () => {
  const scripts = ['001-module-state.sql', '002-capability-invocations.sql', '003-tasks.sql', '004-task-evidence.sql', '005-reminders.sql'].map(n => fs.readFileSync(`src/main/storage/migrations/${n}`, 'utf8'))
  const db = new StateDatabase(':memory:', scripts[0], scripts.slice(1))
  const before = [powerMonitor.listenerCount('suspend'), powerMonitor.listenerCount('resume')]
  const runtime = startRemindersApplication(new RemindersStore(db, new ReminderCalendar(), 'UTC'), () => true)
  try {
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(runtime.scheduler.isRunning(), true)
    powerMonitor.emit('suspend')
    assert.equal(runtime.scheduler.isRunning(), false)
    powerMonitor.emit('resume')
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(runtime.scheduler.isRunning(), true)
    runtime.close()
    assert.equal(runtime.scheduler.isRunning(), false)
    assert.deepEqual([powerMonitor.listenerCount('suspend'), powerMonitor.listenerCount('resume')], before)
    db.close()
    runtime.stop(); runtime.close()
    powerMonitor.emit('resume')
  } finally { runtime.close(); db.close() }
})
