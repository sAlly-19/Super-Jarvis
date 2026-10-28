import type { EmailPanelState } from '@shared'
let initialized = false
export function initializeEmailSettings(): void {
  if (initialized) return
  const feedback = document.getElementById('email-feedback'), output = document.getElementById('email-accounts'), tickets = document.getElementById('email-tickets')
  const controls = document.getElementById('email-controls') as HTMLFieldSetElement | null
  if (!feedback || !output || !tickets || !controls) return
  initialized = true
  let generation = 0, busy = false, allowed = false, locked = false, state: EmailPanelState | null = null
  const gmail = document.getElementById('email-connect-gmail') as HTMLButtonElement
  const outlook = document.getElementById('email-connect-outlook') as HTMLButtonElement
  const select = document.getElementById('email-file-account') as HTMLSelectElement
  const reset = () => { allowed = false; state = null; controls.disabled = true; output.replaceChildren(); tickets.replaceChildren(); select.replaceChildren(); feedback.textContent = 'Ative E-mails nos módulos acima, com licença e consentimento válidos.' }
  const render = () => {
    if (!allowed || !state) return
    controls.disabled = busy
    gmail.disabled = !state.providers.gmail; outlook.disabled = !state.providers.outlook
    ;(document.getElementById('email-directory') as HTMLButtonElement).disabled = true
    output.replaceChildren(); select.replaceChildren()
    const configured = state.providers.gmail || state.providers.outlook
    const defaultAccount = state.accounts.find(account => account.id === state!.preferences.defaultAccountId)
    feedback.textContent = !configured ? 'Conexão indisponível: a configuração OAuth do publicador ainda não foi instalada.' : defaultAccount && defaultAccount.status !== 'connected' ? 'Conta padrão indisponível. Reconecte-a ou escolha outra; não será trocada automaticamente.' : state.status.health === 'healthy' ? 'Contas disponíveis. Respostas usam a conta que recebeu a mensagem.' : 'Conecte uma conta Gmail ou Outlook para começar.'
    for (const account of state.accounts) {
      const row = document.createElement('div'); row.className = 'email-account-row'
      const label = document.createElement('p'); label.textContent = `${account.provider === 'gmail' ? 'Gmail' : 'Outlook'} · ${account.address} · ${account.status === 'connected' ? 'Conectada' : account.status === 'reauth_required' ? 'Reconexão necessária' : 'Desconectada'}${account.id === state.preferences.defaultAccountId ? ' · Padrão para novos envios' : ''}`
      row.append(label)
      const button = (name: string, work: () => Promise<unknown>, disabled = false) => { const element = document.createElement('button'); element.type = 'button'; element.className = 'btn-toggle'; element.textContent = name; element.disabled = disabled; element.addEventListener('click', () => { void run(work) }); row.append(element) }
      button('Usar como padrão', () => window.electronAPI.setDefaultEmailAccount(account.id, state!.preferences.revision), account.status !== 'connected' || account.id === state.preferences.defaultAccountId)
      button('Desconectar', () => window.electronAPI.disconnectEmailAccount(account.id, account.revision), account.status === 'disconnected')
      output.append(row)
      if (account.status === 'connected') { const option = document.createElement('option'); option.value = account.id; option.textContent = account.address; select.append(option) }
    }
  }
  const refresh = async () => {
    const epoch = ++generation
    try {
      if (locked) { reset(); return }
      const modules = await window.electronAPI.listModules()
      if (epoch !== generation) return
      const module = modules.find(item => item.id === 'email')
      if (!module?.enabled || !module.authorized || !module.configured || module.lifecycle !== 'running') { reset(); return }
      const value = await window.electronAPI.listEmailAccounts()
      if (epoch !== generation || locked) return
      state = value; allowed = true; render()
    } catch { if (epoch === generation) { reset(); feedback.textContent = 'E-mails indisponível. Confira a licença e o estado do módulo.' } }
  }
  async function run(work: () => Promise<unknown>, fileResult = false) {
    if (!allowed || busy) return
    const epoch = generation; busy = true; controls!.disabled = true
    try {
      const value = await work()
      if (epoch !== generation || !allowed || locked) return
      if (fileResult && value) tickets!.textContent = 'Referências válidas por 5 minutos para usar no chat:\n' + JSON.stringify(value, null, 2)
    } catch (error) {
      if (epoch === generation && allowed) feedback!.textContent = String(error).includes('email_oauth_not_configured') ? 'O publicador precisa configurar o OAuth deste provedor antes da conexão.' : 'Não foi possível concluir. Confira a conexão e tente novamente.'
    } finally { busy = false; if (allowed && !locked) { controls!.disabled = false; void refresh() } }
  }
  gmail.addEventListener('click', () => { void run(() => window.electronAPI.connectEmailAccount('gmail')) })
  outlook.addEventListener('click', () => { void run(() => window.electronAPI.connectEmailAccount('outlook')) })
  document.getElementById('email-upload')!.addEventListener('click', () => { if (select.value) void run(() => window.electronAPI.selectEmailUploads(select.value), true) })
  document.getElementById('email-directory')!.addEventListener('click', () => { if (select.value) void run(() => window.electronAPI.selectEmailDownloadDirectory(select.value), true) })
  const changed = () => { void refresh() }
  window.addEventListener('jasper-modules-changed', changed)
  const unsubscribe = window.electronAPI.onEmailChanged(changed)
  const unsubscribeLicense = window.electronAPI.onLicenseState(snapshot => { locked = snapshot.state !== 'unlocked'; generation++; if (locked) reset(); else changed() })
  window.addEventListener('beforeunload', () => { generation++; reset(); unsubscribe(); unsubscribeLicense(); window.removeEventListener('jasper-modules-changed', changed) }, { once: true })
  void refresh()
}
