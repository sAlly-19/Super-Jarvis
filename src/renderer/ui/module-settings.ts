import type { ModuleId, ModuleSnapshot } from '@shared'

const LABELS: Record<ModuleId, string> = {
  computer: 'Controle do computador', reminders: 'Lembretes', 'pc-health': 'Saúde do PC', documents: 'Documentos',
  email: 'E-mails', 'web-research': 'Pesquisa web', 'home-assistant': 'Casa inteligente', webhooks: 'Webhooks',
  'semantic-memory': 'Memória semântica', 'knowledge-graph': 'Grafo de conhecimento', briefings: 'Resumos proativos'
}
let initialized = false

export function initializeModuleSettings(): void {
  if (initialized) return
  const container = document.getElementById('module-settings-list')
  const feedback = document.getElementById('module-settings-feedback')
  if (!container || !feedback) return
  initialized = true
  let generation = 0
  const render = (snapshots: ModuleSnapshot[]): void => {
    container.replaceChildren(...snapshots.map(snapshot => {
      const card = document.createElement('div')
      card.className = 'module-settings-card'
      const label = document.createElement('label')
      label.className = 'module-settings-toggle'
      const title = document.createElement('strong')
      title.textContent = LABELS[snapshot.id]
      const toggle = document.createElement('input')
      toggle.type = 'checkbox'
      toggle.checked = snapshot.enabled
      toggle.setAttribute('aria-label', LABELS[snapshot.id])
      toggle.disabled = !snapshot.configured || !snapshot.authorized || snapshot.lifecycle === 'stopping'
      label.append(title, toggle)
      const status = document.createElement('p')
      status.className = 'module-settings-status'
      status.textContent = !snapshot.configured ? 'Planejado — ainda não implementado'
        : !snapshot.authorized ? 'Aguardando consentimento operacional'
        : snapshot.lifecycle === 'stopping' ? 'Encerramento pendente — não reativar'
        : !snapshot.enabled ? 'Desativado'
        : snapshot.health !== 'healthy' ? 'Runtime indisponível — reconecte o agente'
        : snapshot.id === 'reminders' ? 'Ativo — agenda local com o aplicativo aberto' : 'Ativo — ferramentas nativas autorizadas'
      const detail = document.createElement('small')
      detail.textContent = snapshot.id === 'computer' ? 'PowerShell livre para scripts e automação do Windows, teclado/mouse, volume, telemetria e captura. Sem confirmação por operação. Comandos e erros são apresentados sem presumir que o objetivo foi concluído.' : snapshot.id === 'reminders' ? 'Agenda e calendário manual .ics no painel abaixo. Avisos sem som; resumo de atrasados na retomada. Não depende de conexão com a IA.' : 'Configuração será disponibilizada na fase deste módulo.'
      const diagnostic = document.createElement('button')
      diagnostic.type = 'button'
      diagnostic.className = 'btn-toggle'
      diagnostic.textContent = 'Diagnosticar'
      diagnostic.disabled = !snapshot.configured || !snapshot.authorized
      diagnostic.addEventListener('click', async () => {
        diagnostic.disabled = true
        try { await window.electronAPI.diagnoseModule(snapshot.id); await refresh() }
        catch { feedback.textContent = 'Diagnóstico indisponível. Verifique licença e conexão do agente.'; diagnostic.disabled = false }
      })
      toggle.addEventListener('change', async () => {
        ++generation
        toggle.disabled = true
        try {
          await window.electronAPI.setModuleEnabled(snapshot.id, toggle.checked, snapshot.revision)
          window.dispatchEvent(new Event('jasper-modules-changed'))
          await refresh()
        } catch {
          await refresh()
          feedback.textContent = 'Não foi possível atualizar o módulo. Estado recarregado; confira licença e conexão.'
        }
      })
      card.append(label, status, detail, diagnostic)
      return card
    }))
  }
  async function refresh(): Promise<void> {
    const current = ++generation
    try {
      const snapshots = await window.electronAPI.listModules()
      if (current !== generation) return
      render(snapshots)
      feedback!.textContent = 'A desativação bloqueia novas ferramentas e solicita o encerramento das que estão em curso. Se habilitar um módulo durante uma chamada, encerre e inicie a chamada novamente para disponibilizar suas ferramentas. A chamada atual continua aberta.'
    } catch { if (current === generation) feedback!.textContent = 'Módulos indisponíveis. Ative a licença e reconecte o agente.' }
  }
  document.getElementById('btn-settings')?.addEventListener('click', () => { void refresh() })
  document.getElementById('module-settings-refresh')?.addEventListener('click', () => { void refresh() })
}
