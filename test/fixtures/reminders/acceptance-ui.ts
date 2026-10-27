import { initializeRemindersSettings } from '../../../src/renderer/ui/reminders-settings'

const wait = async (predicate: () => boolean) => { const deadline = Date.now() + 15000; while (!predicate()) { if (Date.now() > deadline) throw new Error('fixture UI timeout'); await new Promise(resolve => setTimeout(resolve, 20)) } }
const element = (id: string) => document.getElementById(id) as HTMLInputElement
async function run() {
  document.querySelectorAll('.modal-backdrop').forEach(node => (node as HTMLElement).style.display = 'none')
  const modal = document.getElementById('settings-modal')!
  modal.classList.remove('hidden'); modal.style.display = 'flex'
  document.querySelectorAll('.settings-tab-pane').forEach(node => node.classList.remove('active'))
  element('tab-system').classList.add('active')
  initializeRemindersSettings()
  await wait(() => !element('reminders-controls').disabled)
  element('reminders-new').click(); element('reminder-title').value = 'ACCEPTANCE_REMINDER'
  element('reminder-date').value = '2027-12-01T09:00:00'; element('reminder-zone').value = 'UTC'; element('reminder-anchor').value = '1'
  ;(element('reminders-editor') as unknown as HTMLFormElement).requestSubmit()
  await wait(() => element('reminders-editor').hidden && !element('reminders-controls').disabled)
  element('reminders-import').click()
  await wait(() => !element('reminders-import-preview').hidden && !element('reminders-controls').disabled)
  element('reminders-import-apply').click()
  await wait(() => !!element('reminders-feedback').textContent?.includes('2 criados') && !element('reminders-controls').disabled)
  element('reminders-export').click()
  await wait(() => element('reminders-feedback').textContent === 'Calendário exportado.')
  await (window as any).remindersAcceptance.recover()
  await wait(() => !element('reminders-overdue').hidden)
  const deadline = Date.now() + 10000
  while (!await (window as any).remindersAcceptance.acknowledged()) {
    if (Date.now() > deadline) throw new Error(`summary ack missing; visibility=${document.visibilityState}; rects=${element('reminders-overdue').getClientRects().length}`)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  element('reminders-heading').scrollIntoView({ block: 'start' })
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  await (window as any).remindersAcceptance.ready()
}
run().catch(error => console.error('REMINDERS_ACCEPTANCE_FAIL', String(error)))
