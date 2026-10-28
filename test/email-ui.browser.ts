import { initializeEmailSettings } from '../src/renderer/ui/email-settings'
;(async () => {
  let allowed = false, reads = 0, changed!: () => void, licensed!: (value: any) => void
  const state: any = { accounts: [{ id: 'a', provider: 'gmail', address: '<img src=x onerror=external()>', displayName: 'Fixture', status: 'connected', revision: 1 }, { id: 'b', provider: 'outlook', address: 'b@example.invalid', status: 'reauth_required', revision: 2 }], preferences: { defaultAccountId: 'b', revision: 0 }, status: { health: 'unavailable', errorCode: 'email_account_unavailable' }, providers: { gmail: true, outlook: true } }
  Object.defineProperty(window, 'electronAPI', { value: {
    listModules: async () => [{ id: 'email', enabled: allowed, configured: true, authorized: allowed, lifecycle: allowed ? 'running' : 'stopped' }],
    listEmailAccounts: async () => { reads++; return state }, onEmailChanged: (cb: () => void) => { changed = cb; return () => {} }, onLicenseState: (cb: typeof licensed) => { licensed = cb; return () => {} },
    connectEmailAccount: async () => state.accounts[0], setDefaultEmailAccount: async () => state.preferences, disconnectEmailAccount: async () => {}, selectEmailUploads: async () => [], selectEmailDownloadDirectory: async () => null
  } })
  const wait = async (predicate: () => boolean) => { const end = Date.now() + 3000; while (!predicate()) { if (Date.now() > end) throw new Error('email UI timeout'); await new Promise(resolve => setTimeout(resolve, 10)) } }
  const element = (id: string) => document.getElementById(id)!
  initializeEmailSettings(); await wait(() => element('email-feedback').textContent!.includes('Ative'))
  if (reads) throw new Error('Disabled email queried')
  allowed = true; window.dispatchEvent(new Event('jasper-modules-changed'))
  await wait(() => element('email-accounts').children.length === 2)
  if (element('email-accounts').querySelector('img')) throw new Error('Unsafe account HTML')
  if (!element('email-feedback').textContent!.includes('padrão indisponível')) throw new Error('Unavailable default hidden')
  if ((element('email-connect-gmail') as HTMLButtonElement).disabled) throw new Error('First connection incorrectly blocked')
  const before = reads; allowed = false; changed(); await wait(() => !element('email-accounts').children.length)
  if (reads !== before) throw new Error('Revoked module queried')
  licensed({ state: 'locked' }); await new Promise(resolve => setTimeout(resolve, 20))
  if (element('email-tickets').textContent) throw new Error('Revoked file tickets retained')
  console.log('EMAIL_UI_PASS')
})().catch(error => console.error('EMAIL_UI_FAIL ' + String(error)))
