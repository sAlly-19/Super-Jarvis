export interface ControlConsentModalOptions {
  onConsentAccepted?: () => void
}

export class ControlConsentModal {
  private element: HTMLElement | null = null
  private onConsentAccepted?: () => void

  constructor(options: ControlConsentModalOptions = {}) {
    this.onConsentAccepted = options.onConsentAccepted
    this.ensureElement()
  }

  private ensureElement(): void {
    if (this.element || typeof document === 'undefined') return

    const existing = document.getElementById('modal-control-consent')
    if (existing) {
      this.element = existing
      return
    }

    const modal = document.createElement('div')
    modal.id = 'modal-control-consent'
    modal.className = 'modal-overlay hidden'
    modal.innerHTML = `
      <div class="modal-card consent-card">
        <div class="modal-header">
          <h3>Autorização de Controle Operacional do Sistema</h3>
        </div>
        <div class="modal-body">
          <p class="consent-intro">
            O <strong>Super-Jarvis</strong> é um assistente autônomo com capacidades avançadas de controle local do sistema operacional. Para prosseguir, é necessário autorizar explicitamente as seguintes capacidades:
          </p>
          <ul class="consent-capabilities-list">
            <li><strong>Execução de comandos e ferramentas locais:</strong> Capacidade de executar scripts de automação, ferramentas de linha de comando e utilitários do sistema.</li>
            <li><strong>Manipulação de arquivos do projeto:</strong> Criação, edição e organização de pastas e documentos no seu espaço de trabalho.</li>
            <li><strong>Interação com interface gráfica e mídia:</strong> Ativação de controles de mídia, janelas e automação visual do sistema.</li>
            <li><strong>Sensoriamento de áudio e tela:</strong> Captura e processamento multimodal local para comandos de voz e análise de contexto.</li>
          </ul>
          <p class="consent-notice">
            Esta autorização é única e fica vinculada com segurança a esta instalação e máquina.
          </p>
        </div>
        <div class="modal-footer">
          <button type="button" id="btn-accept-control-consent" class="btn-primary">
            Autorizar e Ativar Agente
          </button>
        </div>
      </div>
    `
    document.body.appendChild(modal)
    this.element = modal

    const acceptBtn = modal.querySelector('#btn-accept-control-consent')
    acceptBtn?.addEventListener('click', async () => {
      try {
        await window.electronAPI.acceptControlConsent()
        this.hide()
        if (this.onConsentAccepted) {
          this.onConsentAccepted()
        }
      } catch (err) {
        console.error('[ConsentModal] Erro ao registrar consentimento:', err)
      }
    })
  }

  public show(): void {
    this.ensureElement()
    this.element?.classList.remove('hidden')
  }

  public hide(): void {
    this.element?.classList.add('hidden')
  }

  public async checkAndPrompt(): Promise<boolean> {
    const accepted = await window.electronAPI.isConsentAccepted()
    if (!accepted) {
      this.show()
      return false
    }
    return true
  }
}

export const controlConsentModal = new ControlConsentModal()
