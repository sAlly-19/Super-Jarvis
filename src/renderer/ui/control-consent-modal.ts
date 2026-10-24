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
    modal.className = 'modal-backdrop hidden'
    modal.innerHTML = `
      <div class="modal-card consent-card">
        <div class="modal-header">
          <div class="modal-title-wrap">
            <div class="modal-arc-ring">
              <span class="modal-arc-dot"></span>
            </div>
            <div>
              <h3>Autorização Operacional do Agente</h3>
              <span class="modal-subtitle">Consentimento obrigatório para execução autônoma local.</span>
            </div>
          </div>
          <button type="button" class="modal-close" id="btn-close-control-consent" aria-label="Fechar">&times;</button>
        </div>
        <div class="modal-body consent-body">
          <p class="consent-intro">
            O <strong>Super-Jarvis</strong> opera com controle operacional avançado do Windows. Para ativar a IA e os provedores configurados, autorize as seguintes capacidades locais:
          </p>
          <ul class="consent-capabilities-list">
            <li><strong>Ferramentas e automação local:</strong> Execução de scripts PowerShell, utilitários do sistema e controle de hardware.</li>
            <li><strong>Interação com interface e mídia:</strong> Controle de janelas, volume, teclado/mouse e sintetização de voz.</li>
            <li><strong>Sensoriamento e tela:</strong> Captura local de tela sob demanda e processamento de áudio para comandos.</li>
          </ul>
          <p class="consent-notice">
            Esta autorização é estritamente local e fica vinculada ao hardware desta estação de trabalho.
          </p>
        </div>
        <div class="modal-footer consent-footer">
          <button type="button" id="btn-cancel-control-consent" class="btn-cancel">
            Recusar (Manter Offline)
          </button>
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

    const closeBtn = modal.querySelector('#btn-close-control-consent')
    const cancelBtn = modal.querySelector('#btn-cancel-control-consent')
    const dismiss = (): void => {
      this.hide()
    }
    closeBtn?.addEventListener('click', dismiss)
    cancelBtn?.addEventListener('click', dismiss)
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
