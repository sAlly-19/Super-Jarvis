import { initializeEmailSettings } from '../../../src/renderer/ui/email-settings'
const state = {
  accounts: [
    { id: 'synthetic-gmail', provider: 'gmail', address: 'gmail@example.invalid', displayName: 'Conta de teste', status: 'connected', revision: 1 },
    { id: 'synthetic-outlook', provider: 'outlook', address: 'outlook@example.invalid', displayName: 'Conta de teste', status: 'reauth_required', revision: 2 }
  ], preferences: { defaultAccountId: 'synthetic-outlook', revision: 1 }, providers: { gmail: true, outlook: true }, status: { health: 'healthy' }
}
Object.defineProperty(window, 'electronAPI', { value: {
  listModules: async () => [{ id: 'email', enabled: true, configured: true, authorized: true, lifecycle: 'running' }],
  listEmailAccounts: async () => state, onEmailChanged: () => () => {}, onLicenseState: () => () => {},
  connectEmailAccount: async () => { throw new Error('synthetic_fixture_no_login') }, disconnectEmailAccount: async () => {}, setDefaultEmailAccount: async () => state.preferences,
  selectEmailUploads: async () => [], selectEmailDownloadDirectory: async () => { throw new Error('email_download_unavailable') }
} })
;(async () => {
  document.getElementById('settings-modal')!.classList.remove('hidden')
  document.querySelectorAll('.settings-tab-pane').forEach(node => node.classList.remove('active'))
  document.getElementById('tab-system')!.classList.add('active')
  initializeEmailSettings()
  const deadline = Date.now() + 5000
  while (document.getElementById('email-accounts')!.children.length !== 2) {
    if (Date.now() > deadline) throw new Error('email_panel_timeout')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  document.getElementById('settings-section-title')!.textContent = 'E-mails · teste sintético'
  document.getElementById('email-heading')!.scrollIntoView({ block: 'start' })
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  console.log('EMAIL_ACCEPTANCE_READY')
})().catch(error => console.error('EMAIL_ACCEPTANCE_FAIL ' + String(error)))
