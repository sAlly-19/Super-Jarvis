import { showHudToast } from './toast'
import { updateStatusBadge } from './status-badge'
import type { LicenseInfo } from '@shared'

export class LicenseModal {
  private modalEl: HTMLElement | null = null
  private titleEl: HTMLElement | null = null
  private subtitleEl: HTMLElement | null = null
  private btnCloseEl: HTMLElement | null = null

  // Step 1: License Activation
  private stepLicenseEl: HTMLElement | null = null
  private inputKeyEl: HTMLInputElement | null = null
  private btnActivateEl: HTMLButtonElement | null = null
  private btnCopyHwidEl: HTMLButtonElement | null = null
  private hwidTextEl: HTMLElement | null = null
  private feedbackEl: HTMLElement | null = null

  // Step 2: Gemini API Key Onboarding
  private stepGeminiEl: HTMLElement | null = null
  private inputGeminiKeyEl: HTMLInputElement | null = null
  private btnToggleGeminiKeyEl: HTMLButtonElement | null = null
  private btnOpenAiStudioEl: HTMLButtonElement | null = null
  private btnSaveGeminiEl: HTMLButtonElement | null = null
  private geminiFeedbackEl: HTMLElement | null = null

  private isMandatory = false
  private currentHwid = ''

  public init(): void {
    this.modalEl = document.getElementById('modal-license-activation')
    this.titleEl = document.getElementById('license-modal-title')
    this.subtitleEl = document.getElementById('license-modal-subtitle')
    this.btnCloseEl = document.getElementById('btn-close-license-modal')

    // Step 1 elements
    this.stepLicenseEl = document.getElementById('step-license-activation')
    this.inputKeyEl = document.getElementById('input-license-key') as HTMLInputElement | null
    this.btnActivateEl = document.getElementById('btn-activate-license') as HTMLButtonElement | null
    this.btnCopyHwidEl = document.getElementById('btn-copy-hwid') as HTMLButtonElement | null
    this.hwidTextEl = document.getElementById('license-hwid-display')
    this.feedbackEl = document.getElementById('license-feedback-message')

    // Step 2 elements
    this.stepGeminiEl = document.getElementById('step-gemini-onboarding')
    this.inputGeminiKeyEl = document.getElementById('input-onboarding-gemini-key') as HTMLInputElement | null
    this.btnToggleGeminiKeyEl = document.getElementById('btn-toggle-onboarding-key') as HTMLButtonElement | null
    this.btnOpenAiStudioEl = document.getElementById('btn-open-google-ai-studio') as HTMLButtonElement | null
    this.btnSaveGeminiEl = document.getElementById('btn-save-onboarding-gemini') as HTMLButtonElement | null
    this.geminiFeedbackEl = document.getElementById('gemini-onboarding-feedback')

    if (!this.modalEl) return

    // Preenche o HWID da máquina
    window.electronAPI.getHwid().then((hw) => {
      this.currentHwid = hw.machineId
      if (this.hwidTextEl) {
        this.hwidTextEl.textContent = hw.machineId
      }
    }).catch(() => {})

    // Normaliza a chave no formato atual com checksum de digitação.
    this.inputKeyEl?.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement
      let val = target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '')
      target.value = val
    })

    // Botão de copiar HWID
    this.btnCopyHwidEl?.addEventListener('click', () => {
      if (this.currentHwid) {
        navigator.clipboard.writeText(this.currentHwid)
        showHudToast('Hardware ID', 'Hardware ID copiado com sucesso!', 'info', 3000)
      }
    })

    // Botão de ativar licença (Passo 1)
    this.btnActivateEl?.addEventListener('click', () => {
      this.handleActivate()
    })

    // Submissão com Enter no input da licença
    this.inputKeyEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        this.handleActivate()
      }
    })

    // Step 2: Toggle visibilidade da chave Gemini
    this.btnToggleGeminiKeyEl?.addEventListener('click', () => {
      if (!this.inputGeminiKeyEl) return
      const isPassword = this.inputGeminiKeyEl.type === 'password'
      this.inputGeminiKeyEl.type = isPassword ? 'text' : 'password'
      if (this.btnToggleGeminiKeyEl) {
        this.btnToggleGeminiKeyEl.textContent = isPassword ? 'Ocultar' : 'Mostrar'
      }
    })

    // Step 2: Abrir Google AI Studio
    this.btnOpenAiStudioEl?.addEventListener('click', () => {
      window.open('https://aistudio.google.com/app/apikey', '_blank')
    })

    // Step 2: Salvar Chave Gemini e Iniciar
    this.btnSaveGeminiEl?.addEventListener('click', () => {
      this.handleSaveGeminiKey()
    })

    this.inputGeminiKeyEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        this.handleSaveGeminiKey()
      }
    })

    // Fechar modal (apenas se não for obrigatório)
    this.btnCloseEl?.addEventListener('click', () => {
      if (!this.isMandatory) {
        this.hide()
      }
    })

    // Listener de Revogação de Licença / Bloqueio de 24h
    window.electronAPI.onLicenseRevoked((payload) => {
      console.warn('[LicenseModal] Notificação de revogação recebida.')
      updateStatusBadge('error', 'Licença Bloqueada')
      this.goToStep1()
      this.showFeedback(
        payload.message || 'Sua licença foi desativada ou revogada pelo administrador. Acesso bloqueado.',
        'error'
      )
      this.show(true)
      showHudToast('Acesso Revogado', payload.message || 'Licença suspensa ou expirada.', 'error', 7000)
    })
  }

  public goToStep1(): void {
    if (this.stepLicenseEl) this.stepLicenseEl.style.display = 'block'
    if (this.stepGeminiEl) this.stepGeminiEl.style.display = 'none'
    if (this.titleEl) this.titleEl.textContent = 'AUTENTICAÇÃO DE SEGURANÇA // ATIVAÇÃO'
    if (this.subtitleEl) this.subtitleEl.textContent = 'Jasper AI Desktop - Licenciamento Vitalício & Node-Locking'
    this.inputKeyEl?.focus()
  }

  public goToStep2(): void {
    if (this.stepLicenseEl) this.stepLicenseEl.style.display = 'none'
    if (this.stepGeminiEl) this.stepGeminiEl.style.display = 'block'
    if (this.titleEl) this.titleEl.textContent = 'PASSO 2: CONFIGURAÇÃO DO GOOGLE GEMINI AI'
    if (this.subtitleEl) this.subtitleEl.textContent = 'Chave Pessoal para Inteligência Artificial & Voz em Tempo Real'
    this.inputGeminiKeyEl?.focus()
  }

  private async handleActivate(): Promise<void> {
    const rawKey = this.inputKeyEl?.value.trim().toUpperCase() || ''

    if (!rawKey) {
      this.showFeedback('Informe sua chave de licença vitalícia.', 'error')
      return
    }

    if (this.btnActivateEl) {
      this.btnActivateEl.disabled = true
      this.btnActivateEl.textContent = 'VALIDANDO LICENÇA...'
    }

    this.showFeedback('Conectando ao Firestore seguro de autenticação...', 'info')

    try {
      const result = await window.electronAPI.activateLicense(rawKey)

      if (result.valid) {
        this.showFeedback(result.message || 'Licença ativada com sucesso nesta máquina!', 'success')
        showHudToast('Licença Ativada', 'Estação Jasper Desbloqueada com Sucesso!', 'info', 5000)
        updateStatusBadge('online', 'Licença Válida')

        // Sempre avança para o Passo 2 para solicitar a chave de API pessoal do Google Gemini do usuário
        setTimeout(() => {
          this.goToStep2()
        }, 800)
      } else {
        this.showFeedback(result.message || 'Falha ao ativar licença.', 'error')
      }
    } catch (err: any) {
      this.showFeedback('Erro de rede: Não foi possível conectar ao servidor de validação.', 'error')
    } finally {
      if (this.btnActivateEl) {
        this.btnActivateEl.disabled = false
        this.btnActivateEl.textContent = 'ATIVAR LICENÇA'
      }
    }
  }

  private async handleSaveGeminiKey(): Promise<void> {
    const rawGeminiKey = this.inputGeminiKeyEl?.value.trim() || ''

    if (!rawGeminiKey) {
      this.showGeminiFeedback('Por favor, informe sua GOOGLE_API_KEY do Gemini.', 'error')
      return
    }

    if (!rawGeminiKey.startsWith('AIza') || rawGeminiKey.length < 20) {
      this.showGeminiFeedback('A chave do Gemini normalmente inicia com "AIzaSy" e possui ~39 caracteres.', 'error')
      return
    }

    if (this.btnSaveGeminiEl) {
      this.btnSaveGeminiEl.disabled = true
      this.btnSaveGeminiEl.textContent = 'CONECTANDO AO GEMINI...'
    }

    this.showGeminiFeedback('Salvando chave criptografada e conectando...', 'info')

    try {
      await window.electronAPI.saveConfig({ apiKey: rawGeminiKey })

      const connResult = await window.electronAPI.connectGemini({ apiKey: rawGeminiKey })
      if (connResult.success) {
        this.showGeminiFeedback('Gemini conectado com sucesso! Bem-vindo ao Jasper.', 'success')
        showHudToast('Jasper Online', 'Assistente conectado com sua chave própria do Gemini!', 'info', 5000)
        updateStatusBadge('online', 'Jasper Pronto')

        setTimeout(() => {
          this.hide()
        }, 1200)
      } else {
        this.showGeminiFeedback(
          `Chave salva, porém a conexão retornou aviso: ${connResult.error || 'Verifique se a chave está ativa no Google AI Studio.'}`,
          'info'
        )
        setTimeout(() => {
          this.hide()
        }, 2000)
      }
    } catch (err: any) {
      this.showGeminiFeedback(`Falha ao conectar: ${err.message || 'Erro de rede'}`, 'error')
    } finally {
      if (this.btnSaveGeminiEl) {
        this.btnSaveGeminiEl.disabled = false
        this.btnSaveGeminiEl.textContent = 'SALVAR E INICIAR JASPER'
      }
    }
  }

  private showFeedback(msg: string, type: 'error' | 'success' | 'info'): void {
    if (!this.feedbackEl) return
    this.feedbackEl.textContent = msg
    this.feedbackEl.className = `license-feedback ${type}`
    this.feedbackEl.style.display = 'block'
  }

  private showGeminiFeedback(msg: string, type: 'error' | 'success' | 'info'): void {
    if (!this.geminiFeedbackEl) return
    this.geminiFeedbackEl.textContent = msg
    this.geminiFeedbackEl.className = `license-feedback ${type}`
    this.geminiFeedbackEl.style.display = 'block'
  }

  public show(mandatory = false): void {
    this.isMandatory = mandatory
    if (!this.modalEl) return

    if (this.btnCloseEl) {
      this.btnCloseEl.style.display = mandatory ? 'none' : 'block'
    }

    this.modalEl.classList.remove('hidden')
    this.modalEl.style.display = 'flex'
    this.inputKeyEl?.focus()
  }

  public hide(): void {
    if (!this.modalEl) return
    this.modalEl.classList.add('hidden')
    this.modalEl.style.display = 'none'
  }

  /**
   * Verifica o status da licença na inicialização do aplicativo
   */
  public async checkOnStartup(): Promise<LicenseInfo> {
    try {
      const info = await window.electronAPI.getLicenseStatus()

      if (!info.isLicensed) {
        console.warn('[LicenseModal] Estação sem licença ativa. Exibindo modal de ativação.')
        updateStatusBadge('error', 'Licença Pendente')
        this.goToStep1()
        this.show(true)
      } else {
        console.log('[LicenseModal] Estação licenciada.')
        // Se a licença estiver ativa, mas o usuário não tem a chave Gemini configurada
        const cfg = await window.electronAPI.getConfig()
        if (!cfg.hasFullKey) {
          console.warn('[LicenseModal] Licença ativa, mas chave do Gemini ausente. Solicitando ao usuário.')
          updateStatusBadge('disconnected', 'Configure a API Key')
          this.goToStep2()
          this.show(true)
        }
      }

      return info
    } catch {
      return {
        isLicensed: false,
        status: 'unlicensed',
        currentHwid: ''
      }
    }
  }
}

export const licenseModal = new LicenseModal()
