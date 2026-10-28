import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import { Notification } from 'electron'
import { createVisualReminderNotifier, type ReminderPopup } from '../src/main/modules/reminders/visual-notifier'
import { electronReminderNotifier } from '../src/main/modules/reminders/notifier'
import { ReminderScheduler } from '../src/main/modules/reminders/scheduler'
import { StateDatabase } from '../src/main/storage/state-database'
import { RemindersStore } from '../src/main/modules/reminders/store'
import { ReminderCalendar } from '../src/main/modules/reminders/calendar'
import type { Reminder } from '../src/shared/types/reminders'

class Popup extends EventEmitter implements ReminderPopup {
  html = ''; visible = false; destroyed = false; shows = 0
  load: () => Promise<unknown> = async () => {}
  loadURL(url: string) { this.html = decodeURIComponent(url.split(',').slice(1).join(',')); return this.load() }
  showInactive() { this.visible = true; this.shows++ }
  isVisible() { return this.visible }
  isDestroyed() { return this.destroyed }
  close() { this.destroyed = true; this.visible = false; this.emit('closed') }
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve))
const item = (title = 'Synthetic') => ({ title, description: '<script>external()</script>' }) as Reminder

test('visual reminders aggregate in a visible window, escape content and survive delivery cleanup', async () => {
  const popup = new Popup(), notifier = createVisualReminderNotifier(() => popup)
  let shown = 0, failed = 0
  const hooks = { beforeShow: () => true, shown: () => { shown++ }, failed: () => { failed++ } }
  const first = notifier.prepare(item('<img src=x onerror=external()>'), hooks)
  first.show(); notifier.prepare(item('Second'), hooks).show()
  await flush()
  assert.equal(shown, 2); assert.equal(failed, 0); assert.equal(popup.shows, 1)
  assert.match(popup.html, /&lt;img/); assert.match(popup.html, /&lt;script/)
  assert.doesNotMatch(popup.html, /<script>|<img/)
  first.cancel()
  assert.equal(popup.isVisible(), true, 'scheduler cleanup must not recall a visible notice')
  notifier.close!()
  assert.equal(popup.isDestroyed(), true)
})

test('revocation while loading and shutdown reject late presentation without claiming delivery', async () => {
  for (const stop of [false, true]) {
    const popup = new Popup(), notifier = createVisualReminderNotifier(() => popup)
    let resolve!: () => void, allowed = true, shown = 0, failed = 0
    popup.load = () => new Promise<void>(done => { resolve = done })
    notifier.prepare(item(), { beforeShow: () => allowed, shown: () => { shown++ }, failed: () => { failed++ } }).show()
    await flush()
    if (stop) notifier.close!(); else allowed = false
    resolve(); await flush(); await flush()
    assert.equal(shown, 0); assert.equal(failed, 1); assert.equal(popup.shows, 0)
    assert.equal(popup.destroyed, true)
  }
})

test('failed visual window creation never claims successful delivery', async () => {
  let shown = 0, failed = 0
  const notifier = createVisualReminderNotifier(() => { throw new Error('window unavailable') })
  notifier.prepare(item(), { beforeShow: () => true, shown: () => { shown++ }, failed: () => { failed++ } }).show()
  await flush()
  assert.equal(shown, 0); assert.equal(failed, 1)
})

test('closing the main window also closes the reminder without keeping the app alive', async () => {
  const main = new EventEmitter(), popup = new Popup()
  const notifier = createVisualReminderNotifier(() => popup, () => main)
  notifier.prepare(item(), { beforeShow: () => true, shown: () => {}, failed: () => assert.fail('delivery failed') }).show()
  await flush()
  assert.equal(popup.visible, true)
  main.emit('closed')
  assert.equal(popup.destroyed, true)
  assert.equal(main.listenerCount('closed'), 0)
})

test('native acceptance cannot settle a reminder before the Jasper window becomes visible', async () => {
  const supported = Notification.isSupported, show = Notification.prototype.show, close = Notification.prototype.close
  Notification.isSupported = () => true
  Notification.prototype.show = function () { this.emit('show') }
  Notification.prototype.close = function () { this.emit('close') }
  const popup = new Popup(), visual = createVisualReminderNotifier(() => popup), notifier = electronReminderNotifier(visual)
  let shown = 0
  try {
    notifier.prepare(item(), { beforeShow: () => true, shown: () => { shown++ }, failed: () => assert.fail('delivery failed') }).show()
    assert.equal(shown, 0, 'native show alone is not proof of visual delivery')
    await flush()
    assert.equal(shown, 1); assert.equal(popup.visible, true)
    notifier.close!()
    assert.equal(popup.destroyed, true)
  } finally {
    Notification.isSupported = supported; Notification.prototype.show = show; Notification.prototype.close = close
  }
})

test('real scheduler records visible delivery once and closes its notice when access stops', async () => {
  const names = ['001-module-state.sql', '002-capability-invocations.sql', '003-tasks.sql', '004-task-evidence.sql', '005-reminders.sql']
  const scripts = names.map(name => fs.readFileSync(`src/main/storage/migrations/${name}`, 'utf8'))
  const database = new StateDatabase(':memory:', scripts[0], scripts.slice(1))
  const store = new RemindersStore(database, new ReminderCalendar(), 'UTC'), popup = new Popup()
  const scheduler = new ReminderScheduler(store, {
    allowed: () => true, nowUtc: () => '2027-01-01T09:00:00.000Z',
    notifier: electronReminderNotifier(createVisualReminderNotifier(() => popup))
  })
  try {
    const reminder = store.mutate({ type: 'create', title: 'Synthetic', description: '', schedule: {
      policy: 'jasper', localDateTime: '2027-01-01T09:00:00', timeZone: 'UTC', recurrence: 'none', anchorDay: 1
    } }, { invocationId: 'visual-fixture', nowUtc: '2027-01-01T00:00:00.000Z' }).items[0]
    scheduler.tick('2027-01-01T09:00:00.000Z')
    assert.equal(store.occurrences(reminder.id)[0].state, 'pending')
    await flush(); await flush()
    assert.equal(store.occurrences(reminder.id)[0].state, 'notified')
    assert.equal(popup.visible, true)
    scheduler.tick('2027-01-01T09:00:00.000Z'); await flush()
    assert.equal(popup.shows, 1)
    scheduler.stop(); assert.equal(popup.destroyed, true)
  } finally { scheduler.stop(); database.close() }
})
