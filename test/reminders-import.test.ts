import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { StateDatabase } from '../src/main/storage/state-database'
import { RemindersStore } from '../src/main/modules/reminders/store'
import { ReminderCalendar } from '../src/main/modules/reminders/calendar'
import { parseCalendar } from '../src/main/modules/reminders/ical-codec'
import { RemindersImportService } from '../src/main/modules/reminders/import-service'

test('import keeps IDs, updates untouched items, preserves local edits and rejects stale external sequence', async () => {
  const names = ['001-module-state.sql', '002-capability-invocations.sql', '003-tasks.sql', '004-task-evidence.sql', '005-reminders.sql', '006-reminder-imports.sql']
  const sql = names.map(name => fs.readFileSync(`src/main/storage/migrations/${name}`, 'utf8'))
  const db = new StateDatabase(':memory:', sql[0], sql.slice(1)), store = new RemindersStore(db, new ReminderCalendar(), 'UTC')
  const importer = new RemindersImportService(store, () => {})
  const candidate = (title: string, sequence: number) => parseCalendar(new TextEncoder().encode(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:synthetic-import\r\nSUMMARY:${title}\r\nSEQUENCE:${sequence}\r\nDTSTART:20271101T090000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`), store.getPreferences()).candidates
  const signal = new AbortController().signal
  try {
    const first = await importer.apply(candidate('First', 1), { invocationId: 'one', nowUtc: '2027-01-01T00:00:00.000Z' }, signal)
    assert.equal(first.created, 1)
    const item = store.list({ limit: 100 }).items[0]
    assert.equal((await importer.apply(candidate('First', 1), { invocationId: 'two', nowUtc: '2027-01-01T00:00:00.000Z' }, signal)).unchanged, 1)
    assert.equal((await importer.apply(candidate('Changed', 2), { invocationId: 'three', nowUtc: '2027-01-01T00:00:00.000Z' }, signal)).updated, 1)
    assert.equal(store.get(item.id)!.title, 'Changed')
    assert.equal((await importer.apply(candidate('Older', 1), { invocationId: 'four', nowUtc: '2027-01-01T00:00:00.000Z' }, signal)).conflicts[0].reason, 'stale-source')
    store.mutate({ type: 'update', id: item.id, expectedRevision: 1, patch: { title: 'Local' } }, { invocationId: 'edit', nowUtc: '2027-01-01T00:00:00.000Z' })
    const conflict = await importer.apply(candidate('External', 3), { invocationId: 'five', nowUtc: '2027-01-01T00:00:00.000Z' }, signal)
    assert.equal(conflict.conflicts[0].reason, 'local-edited')
    assert.equal(store.list({ limit: 100 }).items.length, 1)
    assert.equal(store.get(item.id)!.title, 'Local')
    assert.deepEqual(await importer.apply(candidate('First', 1), { invocationId: 'one', nowUtc: '2027-01-01T00:00:00.000Z' }, signal), first)
    const aborted = new AbortController(); aborted.abort()
    await assert.rejects(importer.apply(candidate('No effect', 4), { invocationId: 'cancel', nowUtc: '2027-01-01T00:00:00.000Z' }, aborted.signal))
    assert.equal(store.get(item.id)!.title, 'Local')
  } finally { db.close() }
})
