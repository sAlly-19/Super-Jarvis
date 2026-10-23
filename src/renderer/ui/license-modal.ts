import { showHudToast } from './toast'
import { updateStatusBadge } from './status-badge'
import {
  defaultModelForProvider,
  isAIProvider,
  type AIProvider,
  type LicenseInfo,
  type UpdateConfigPayload
} from '@shared'

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

  // Step 2: Provider Onboarding
  private stepOnboardingEl: HTMLElement | null = null
  private selectProviderEl: HTMLSelectElement | null = null
  private keyGroupEl: HTMLElement | null = null
  private keyLabelEl: HTMLElement | null = null
  private inputProviderKeyEl: HTMLInputElement | null = null
  private btnToggleKeyEl: HTMLButtonElement | null = null
  private btnOpenPortalEl: HTMLButtonElement | null = null
  private btnSaveProviderEl: HTMLButtonElement | null = null
  private providerFeedbackEl: HTMLElement | null = null

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
    this.stepOnboardingEl = document.getElementById('step-gemini-onboarding')
    this.selectProviderEl = document.getElementById('select-onboarding-provider') as HTMLSelectElement | null
    this.keyGroupEl = document.getElementById('onboarding-provider-key-group')
    this.keyLabelEl = document.getElementById('label-onboarding-provider-key')
    this.inputProviderKeyEl = document.getElementById('input-onboarding-provider-key') as HTMLInputElement | null
    this.btnToggleKeyEl = document.getElementById('btn-toggle-onboarding-key') as HTMLButtonElement | null
    this.btnOpenPortalEl = document.getElementById('btn-open-google-ai-studio') as HTMLButtonElement | null
    this.btnSaveProviderEl = document.getElementById('btn-save-onboarding-gemini') as HTMLButtonElement | null
    this.providerFeedbackEl = document.getElementById('onboarding-provider-feedback')

    if (!this.modalEl) return

    window.electronAPI
      .getHwid()
      .then((hw) => {
        this.currentHwid = hw.machineId
        if (this.hwidTextEl) {
          this.hwidTextEl.textContent = hw.machineId
        }
      })
      .catch(() => {})

    this.inputKeyEl?.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement
      target.value = target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '')
    })

    this.btnCopyHwidEl?.addEventListener('click', () => {
      if (this.currentHwid) {
        navigator.clipboard.writeText(this.currentHwid)
        showHudToast('Hardware ID', 'Hardware ID copiado com sucesso!', 'info', 3000)
      }
    })

    this.btnActivateEl?.addEventListener('click', () => {
      void this.handleActivate()
    })

    this.inputKeyEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        void this.handleActivate()
      }
    })

    this.selectProviderEl?.addEventListener('change', () => {
      this.syncOnboardingProviderUI()
    })

    this.btnToggleKeyEl?.addEventListener('click', () => {
      if (!this.inputProviderKeyEl) return
      const isPassword = this.inputProviderKeyEl.type === 'password'
      this.inputProviderKeyEl.type = isPassword ? 'text' : 'password'
      if (this.btnToggleKeyEl) {
        this.btnToggleKeyEl.textContent = isPassword ? 'Ocultar' : 'Mostrar'
      }
    })

    this.btnOpenPortalEl?.addEventListener('click', () => {
      const provider = this.getSelectedProvider()
      const url =
        provider === 'groq'
          ? 'https://console.groq.com/keys'
          : 'https://aistudio.google.com/app/apikey'
      window.open(url, '_blank')
    })

    this.btnSaveProviderEl?.addEventListener('click', () => {
      void this.handleSaveProviderOnboarding()
    })

    this.inputProviderKeyEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        void this.handleSaveProviderOnboarding()
      }
    })

    this.btnCloseEl?.addEventListener('click', () => {
      if (!this.isMandatory) {
        this.clearOnboardingSecret()
        this.hide()
      }
    })

    this.syncOnboardingProviderUI()
  }

  private getSelectedProvider(): AIProvider {
    const raw = this.selectProviderEl?.value
    return isAIProvider(raw) ? raw : 'gemini'
  }

  private clearOnboardingSecret(): void {
    if (this.inputProviderKeyEl) {
      this.inputProviderKeyEl.value = ''
      this.inputProviderKeyEl.type = 'password'
    }
    if (this.btnToggleKeyEl) {
      this.btnToggleKeyEl.textContent = 'Mostrar'
    }
  }

  private syncOnboardingProviderUI(): void {
    const provider = this.getSelectedProvider()
    this.clearOnboardingSecret()
    if (this.providerFeedbackEl) {
      this.providerFeedbackEl.style.display = 'none'
    }

    if (provider === 'ollama') {
      this.keyGroupEl?.classList.add('hidden')
      return
    }

    this.keyGroupEl?.classList.remove('hidden')
    if (this.keyLabelEl) {
      this.keyLabelEl.textContent =
        provider === 'groq' ? 'SUA CHAVE DE API DA GROQ:' : 'SUA CHAVE DE API DO GOOGLE GEMINI:'
    }
    if (this.inputProviderKeyEl) {
      this.inputProviderKeyEl.placeholder =
        provider === 'groq' ? 'gsk_...' : 'AIzaSy...'
    }
    if (this.btnOpenPortalEl) {
      this.btnOpenPortalEl.textContent =
        provider === 'groq'
          ? 'Abrir Groq Console para Obter Chave ↗'
          : 'Abrir Google AI Studio para Obter Chave ↗'
    }
  }

  public goToStep1(): void {
    this.stepLicenseEl?.classList.remove('hidden')
    this.stepOnboardingEl?.classList.add('hidden')
    if (this.titleEl) this.titleEl.textContent = 'AUTENTICAÇÃO DE SEGURANÇA // ATIVAÇÃO'
    if (this.subtitleEl) this.subtitleEl.textContent = 'Jasper AI Desktop - Licenciamento Vitalício & Node-Locking'
    this.inputKeyEl?.focus()
  }

  public goToStep2(provider: AIProvider = 'gemini'): void {
    this.stepLicenseEl?.classList.add('hidden')
    this.stepOnboardingEl?.classList.remove('hidden')
    if (this.selectProviderEl) {
      this.selectProviderEl.value = provider
    }
    this.syncOnboardingProviderUI()
    if (this.titleEl) this.titleEl.textContent = 'PASSO 2: PROVEDOR DE IA DO JASPER'
    if (this.subtitleEl) this.subtitleEl.textContent = 'Configure Gemini, Groq ou Ollama Local'
    this.inputProviderKeyEl?.focus()
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

    this.showFeedback('Conectando ao servidor seguro de licenciamento...', 'info')

    try {
      const result = await window.electronAPI.activateLicense(rawKey)

      if (result.snapshot.state === 'unlocked') {
        this.showFeedback(result.snapshot.message || 'Licença ativada com sucesso nesta máquina!', 'success')
        showHudToast('Licença Ativada', 'Estação Jasper Desbloqueada com Sucesso!', 'info', 5000)
        updateStatusBadge('online', 'Licença Válida')

        setTimeout(() => {
          this.goToStep2('gemini')
        }, 800)
      } else {
        this.showFeedback(result.snapshot.message || result.validation.message || 'Falha ao ativar licença.', 'error')
      }
    } catch {
      this.showFeedback('Erro de rede: Não foi possível conectar ao servidor de validação.', 'error')
    } finally {
      if (this.btnActivateEl) {
        this.btnActivateEl.disabled = false
        this.btnActivateEl.textContent = 'ATIVAR LICENÇA'
      }
    }
  }

  private async handleSaveProviderOnboarding(): Promise<void> {
    const provider = this.getSelectedProvider()
    const rawKey = this.inputProviderKeyEl?.value.trim() || ''

    const payload: UpdateConfigPayload = {
      aiProvider: provider,
      model: defaultModelForProvider(provider)
    }

    if (provider === 'gemini') {
      if (!rawKey) {
        this.showProviderFeedback('Informe sua chave de API do Google Gemini.', 'error')
        return
      }
      payload.geminiApiKey = rawKey
    } else if (provider === 'groq') {
      if (!rawKey) {
        this.showProviderFeedback('Informe sua chave de API da Groq.', 'error')
        return
      }
      payload.groqApiKey = rawKey
    }

    if (this.btnSaveProviderEl) {
      this.btnSaveProviderEl.disabled = true
      this.btnSaveProviderEl.textContent = 'CONECTANDO AO JASPER...'
    }

    this.showProviderFeedback('Salvando configuração criptografada e iniciando o agente...', 'info')

    try {
      await window.electronAPI.saveConfig(payload)
      this.clearOnboardingSecret()

      const connResult = await window.electronAPI.connectAgent()
      if (connResult.success) {
        this.showProviderFeedback('Provedor configurado com sucesso! Bem-vindo ao Jasper.', 'success')
        showHudToast('Jasper Online', 'Assistente iniciado com o provedor selecionado.', 'info', 5000)
        updateStatusBadge('online', 'Jasper Pronto')

        setTimeout(() => {
          this.hide()
        }, 1000)
      } else {
        this.showProviderFeedback(
          `Configuração salva, porém a conexão retornou aviso: ${connResult.error || 'Verifique o serviço do provedor.'}`,
          'info'
        )
        setTimeout(() => {
          this.hide()
        }, 1800)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao salvar configuração'
      this.showProviderFeedback(`Falha ao configurar provedor: ${msg}`, 'error')
    } finally {
      if (this.btnSaveProviderEl) {
        this.btnSaveProviderEl.disabled = false
        this.btnSaveProviderEl.textContent = 'SALVAR E INICIAR JASPER'
      }
    }
  }

  private showFeedback(msg: string, type: 'error' | 'success' | 'info'): void {
    if (!this.feedbackEl) return
    this.feedbackEl.textContent = msg
    this.feedbackEl.className = `license-feedback ${type}`
    this.feedbackEl.style.display = 'block'
  }

  private showProviderFeedback(msg: string, type: 'error' | 'success' | 'info'): void {
    if (!this.providerFeedbackEl) return
    this.providerFeedbackEl.textContent = msg
    this.providerFeedbackEl.className = `license-feedback ${type}`
    this.providerFeedbackEl.style.display = 'block'
  }

  public show(mandatory = false): void {
    this.isMandatory = mandatory
    if (!this.modalEl) return

    this.btnCloseEl?.classList.toggle('hidden', mandatory)
    this.modalEl.classList.remove('hidden')
    this.inputKeyEl?.focus()
  }

  public hide(): void {
    if (!this.modalEl) return
    this.clearOnboardingSecret()
    this.modalEl.classList.add('hidden')
  }

  public async checkOnStartup(): Promise<LicenseInfo> {
    try {
      const info = await window.electronAPI.getLicenseStatus()

      const isOperationallyUnlocked = info.gateSnapshot
        ? info.gateSnapshot.state === 'unlocked'
        : info.isLicensed

      if (!info.isLicensed || !isOperationallyUnlocked) {
        console.warn('[LicenseModal] Estação sem licença ativa. Exibindo modal de ativação.')
        updateStatusBadge('error', 'Licença Pendente')
        this.goToStep1()
        this.show(true)
      } else {
        const cfg = await window.electronAPI.getConfig()
        const needsRemoteKey =
          (cfg.aiProvider === 'gemini' && !cfg.credentials.gemini.configured) ||
          (cfg.aiProvider === 'groq' && !cfg.credentials.groq.configured)

        if (needsRemoteKey) {
          updateStatusBadge('disconnected', 'Configure o Provedor de IA')
          this.goToStep2(cfg.aiProvider)
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
