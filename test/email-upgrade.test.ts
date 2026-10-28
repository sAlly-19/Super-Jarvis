import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { emailDatabase } from './fixtures/email/database'
import { EmailStore } from '../src/main/modules/email/store'
import { PcHealthStore } from '../src/main/modules/pc-health/store'
import { RemindersStore } from '../src/main/modules/reminders/store'
import { ReminderCalendar } from '../src/main/modules/reminders/calendar'
test('email v7 to v8 upgrade preserves reminders and health, backs up and reopens with durable account state', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-email-upgrade-')), file = path.join(root, 'state.db')
  let db = emailDatabase(file, 7)
  try {
    new PcHealthStore(db).update({ intervalSeconds: 60 }, 0)
    const reminder = new RemindersStore(db, new ReminderCalendar(), 'UTC').mutate({ type: 'create', title: 'Synthetic', description: '', schedule: { policy: 'jasper', localDateTime: '2027-01-01T09:00:00', timeZone: 'UTC', recurrence: 'none', anchorDay: 1 } }, { invocationId: 'fixture-create', nowUtc: '2026-10-28T00:00:00.000Z' }).items[0]
    db.close(); db = emailDatabase(file)
    const store = new EmailStore(db), account = store.upsertIdentity({ provider: 'gmail', subjectId: 'fixture-sub', tenantId: null, address: 'test@example.invalid', displayName: 'Synthetic' }, 'vault-a')
    store.setDefault(account.id, 0)
    db.close(); db = emailDatabase(file)
    assert.equal(new PcHealthStore(db).get().intervalSeconds, 60)
    assert.equal(new RemindersStore(db, new ReminderCalendar(), 'UTC').get(reminder.id)!.title, 'Synthetic')
    assert.equal(new EmailStore(db).getPreferences().defaultAccountId, account.id)
    assert.ok(fs.readdirSync(root).some(name => name.startsWith('state.db.pre-v8.')))
    const second = emailDatabase(file)
    try { assert.throws(() => new EmailStore(second).setDefault(null, 0), /stale_email_revision/) } finally { second.close() }
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }) }
})
