import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RemindersDashboard } from '../src/main/modules/reminders/dashboard'
import { ipcMain } from 'electron'
import { registerRemindersIpc } from '../src/main/ipc/reminders-ipc'
import { assertTrustedSender } from '../src/main/ipc/register-ipc'
import { IPC_CHANNELS } from '../src/shared'

test('dashboard rejects denied access and renderer paths before filesystem or worker effects', async () => {
  let allowed = false, dialogs = 0
  const dashboard = new RemindersDashboard({} as any, {} as any, {} as any, {} as any, {
    authorize: () => { if (!allowed) throw new Error('denied') }, sessionId: () => 'fixture',
    context: () => ({} as any), chooseImport: async () => { dialogs++; return null },
    exportFile: async () => { dialogs++; return false }, changed: () => {}
  })
  await assert.rejects(dashboard.import({ type: 'preview' }), /denied/)
  assert.equal(dialogs, 0)
  allowed = true
  await assert.rejects(dashboard.import({ type: 'preview', path: 'C:/untrusted.ics' } as any), /fields/)
  assert.equal(dialogs, 0)
  const cancelled = await dashboard.import({ type: 'preview' })
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(dialogs, 1)
  await assert.rejects(dashboard.import({ type: 'apply', token: 'forged' }), /preview/)
  await dashboard.close()
})

test('reminder IPC rejects an untrusted frame before obtaining any domain or filesystem access', () => {
  registerRemindersIpc(event => assertTrustedSender(event))
  const handle = (ipcMain as any)._handlers.get(IPC_CHANNELS.REMINDERS_IMPORT)
  assert.throws(() => handle({ senderFrame: { parent: null, url: 'https://untrusted.example' }, sender: { mainFrame: {} } }, { type: 'preview' }), /Untrusted IPC sender origin/)
})

test('changed export revision cannot reach the atomic file write', async () => {
  let revision = 7, writes = 0
  const dashboard = new RemindersDashboard({ get: () => ({ id: 'fixture', revision }), hasExportExceptions: () => false } as any, {} as any, {} as any,
    { serialize: async () => { revision++; return new Uint8Array() } } as any, {
      authorize: () => {}, sessionId: () => 'fixture', context: () => ({} as any), chooseImport: async () => null,
      exportFile: async (_bytes, _signal, check) => { check(); writes++; return true }, changed: () => {}
    })
  try { await assert.rejects(dashboard.export({ items: [{ id: 'fixture', expectedRevision: 7 }] }), /stale_reminder_export/); assert.equal(writes, 0) }
  finally { await dashboard.close() }
})

test('dashboard returns committed import counts when the job is interrupted after a batch', async () => {
  let dashboard: RemindersDashboard
  const report = { created: 100, updated: 0, unchanged: 0, conflicts: [], rejected: [], warnings: ['interrupted'], interrupted: true }
  dashboard = new RemindersDashboard({ getPreferences: () => ({}) } as any, {} as any, {
    apply: async () => { void dashboard.abortAll(); return report }
  } as any, { parse: async () => ({ candidates: [{}], report: { ...report, created: 0, warnings: [], interrupted: false } }) } as any, {
    authorize: () => {}, sessionId: () => 'fixture', context: () => ({} as any), chooseImport: async () => new Uint8Array(), exportFile: async () => false, changed: () => {}
  })
  try {
    const preview = await dashboard.import({ type: 'preview' })
    const result = await dashboard.import({ type: 'apply', token: preview.token! })
    assert.equal(result.report.created, 100)
    assert.equal(result.report.interrupted, true)
  } finally { await dashboard.close() }
})
