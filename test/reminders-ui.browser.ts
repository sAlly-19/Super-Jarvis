import { initializeRemindersSettings, renderReminderRows } from '../src/renderer/ui/reminders-settings'

const assert = (value: unknown, message: string) => { if (!value) throw new Error(message) }
async function run() {
  const target = document.createElement('div'); document.body.append(target)
  let selected = ''
  const item: any = { id: 'fixture', revision: 2, title: '<img src=x onerror=alert(1)>', description: '<script>bad</script>',
    source: 'jasper', state: 'active', occurrenceKey: 'fixture', nextDueUtc: '2027-01-01T09:00:00.000Z', schedule: { policy: 'jasper', localDateTime: '2027-01-01T09:00:00', timeZone: 'UTC', recurrence: 'none', anchorDay: 1 } }
  renderReminderRows(target, [item], action => { selected = action })
  assert(target.querySelector('img,script') === null, 'Untrusted title became markup')
  assert(target.textContent!.includes(item.title), 'Title lost literal text')
  const buttons = target.querySelectorAll<HTMLButtonElement>('button')
  buttons[0].click()
  assert(selected === 'edit', 'Edit action missing')
  assert(target.textContent!.includes('UTC'), 'Original timezone missing')
  renderReminderRows(target, [], () => {})
  assert(target.textContent!.includes('Nenhum lembrete'), 'Empty state missing')
  let mutation: any, exported: any, licenseChanged: any, overdueChanged: any
  const emptyReport = { created: 0, updated: 0, unchanged: 0, conflicts: [], rejected: [], warnings: [] }
  Object.defineProperty(window, 'electronAPI', { value: {
    listModules: async () => [{ id: 'reminders', enabled: true, authorized: true, configured: true, lifecycle: 'running' }],
    listReminders: async () => ({ items: [item], nextCursor: null }),
    getReminder: async () => item,
    mutateReminder: async (request: unknown) => { mutation = request },
    reminderPreferences: async () => ({ timeZone: 'UTC', allDayTime: '09:00', notificationsEnabled: true, revision: 0 }),
    getOverdueReminders: async () => null,
    importReminders: async (request: any) => request.type === 'preview' ? { status: 'preview', token: 'fixture', count: 1, report: emptyReport }
      : { status: 'applied', report: { ...emptyReport, created: 1 } },
    exportReminders: async (request: unknown) => { exported = request; return true },
    acknowledgeOverdueReminders: async () => true,
    onRemindersChanged: () => () => {}, onOverdueReminders: (callback: unknown) => { overdueChanged = callback; return () => {} },
    onLicenseState: (callback: unknown) => { licenseChanged = callback; return () => {} }
  } })
  const until = async (predicate: () => boolean) => {
    const deadline = Date.now() + 3000
    while (!predicate()) { if (Date.now() > deadline) throw new Error('UI state timed out'); await new Promise(resolve => setTimeout(resolve, 10)) }
  }
  const el = (id: string) => document.getElementById(id) as HTMLInputElement
  initializeRemindersSettings()
  await until(() => !el('reminders-controls').disabled)
  assert(document.querySelector('#reminders-list img, #reminders-list script') === null, 'List interpreted markup')
  el('reminders-new').click()
  el('reminder-title').value = 'Synthetic created reminder'
  el('reminder-date').value = '2027-04-10T10:00:00'
  el('reminder-zone').value = 'UTC'; el('reminder-anchor').value = '10'
  ;(document.getElementById('reminders-editor') as HTMLFormElement).requestSubmit()
  await until(() => mutation?.type === 'create' && !el('reminders-controls').disabled)
  assert(mutation.schedule.localDateTime === '2027-04-10T10:00:00' && mutation.schedule.timeZone === 'UTC', 'Editor changed civil time/zone')
  el('reminders-import').click()
  await until(() => !el('reminders-import-preview').hidden && !el('reminders-controls').disabled)
  el('reminders-import-apply').click()
  await until(() => !!el('reminders-feedback').textContent?.includes('1 criados') && !el('reminders-controls').disabled)
  el('reminders-export').click()
  await until(() => !!exported && !el('reminders-controls').disabled)
  assert(exported.items[0].id === item.id && exported.items[0].expectedRevision === item.revision, 'Export omitted CAS revision')
  overdueChanged({ batchId: 'fixture', total: 1, cursor: null, preview: [{ key: 'overdue-instance', reminderId: item.id, nominalLocalTime: '2026-10-01T09:00:00', dueUtc: '2026-10-01T09:00:00.000Z', state: 'missed', snoozedUntilUtc: null }] })
  await until(() => !el('reminders-overdue').hidden)
  ;(document.querySelector('#reminders-overdue-list button') as HTMLButtonElement).click()
  await until(() => mutation.type === 'complete')
  assert(mutation.occurrenceKey === 'overdue-instance', 'Summary action targeted a future instance')
  licenseChanged({ state: 'locked' })
  assert(el('reminders-controls').disabled && !el('reminders-list').textContent, 'Revocation left private rows interactive')
  console.log('REMINDERS_UI_PASS')
}
run().catch(error => console.error('REMINDERS_UI_FAIL', String(error)))
