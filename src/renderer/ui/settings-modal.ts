import { DOM } from './dom'
import { AvatarController, MoodType } from '../scene/avatar'
import { WakeTrainerUI } from './wake-trainer-ui'
import { showHudToast } from './toast'
import { updateStatusBadge } from './status-badge'
import {
  AI_PROVIDER_CATALOG,
  isAIProvider,
  type AIProvider,
  type ConfigSummary,
  type RemoteAIProvider,
  type UpdateState
} from '@shared'
import {
  buildSettingsUpdate,
  classifySettingsChanges,
  createSettingsDraft,
  modelsForProvider,
  rollbackSettingsDraft,
  switchDraftProvider,
  type SettingsDraft
} from './settings-draft'

export interface SettingsModalOptions {
  getAgentName: () => string
  setAgentName: (name: string) => void
  getAvatar: () => AvatarController | null
  setBloomEnabled: (enabled: boolean) => void
  setNeuralBgEnabled: (enabled: boolean) => void
  setEyeTrackingEnabled: (enabled: boolean) => void
  setIsWakeWordEnabled: (enabled: boolean) => void
  reinitWakeWord: () => Promise<void>
  wakeTrainerUI: WakeTrainerUI
}

const SECTION_META: Readonly<Record<string, { title: string; description: string }>> = {
  general: {
    title: 'GERAL & APARÊNCIA',
    description: 'Personalize a identidade, expressões faciais e efeitos holográficos do Jasper.'
  },
  'ai-voice': {
    title: 'IA & VOZ',
    description: 'Configure provedores independentes (Gemini, Groq e Ollama Local), modelo ativo e síntese de voz.'
  },
  system: {
    title: 'SISTEMA & AUTOMAÇÃO',
    description: 'Gerencie o contexto visual da tela, capacidades nativas do Windows e atualizações assinadas.'
  },
  memory: {
    title: 'MEMÓRIA PERSISTIDA',
    description: 'Consulte e gerencie os fatos memorizados localmente durante suas conversas com o Jasper.'
  },
  license: {
    title: 'LICENÇA & ARRENDAMENTO 72H',
    description: 'Verifique a licença vitalícia vinculada ao hardware (HWID) e a janela de validação de 72 horas.'
  }
}

export class SettingsModal {
  private openingDraft: SettingsDraft | null = null
  private currentMood: MoodType = 'neutral'

  constructor(private readonly options: SettingsModalOptions) {
    this.setupListeners()
  }

  private clearCredentialInputs(): void {
    if (DOM.inputGeminiKey) {
      DOM.inputGeminiKey.value = ''
      DOM.inputGeminiKey.type = 'password'
    }
    if (DOM.btnToggleGeminiKey) {
      DOM.btnToggleGeminiKey.textContent = 'Mostrar'
    }
    if (DOM.inputGroqKey) {
      DOM.inputGroqKey.value = ''
      DOM.inputGroqKey.type = 'password'
    }
    if (DOM.btnToggleGroqKey) {
      DOM.btnToggleGroqKey.textContent = 'Mostrar'
    }
  }

  private populateModelOptions(provider: AIProvider, selectedModel?: string): void {
    if (!DOM.selectModel) return
    const models = modelsForProvider(provider)
    DOM.selectModel.replaceChildren(
      ...models.map((entry) => {
        const opt = document.createElement('option')
        opt.value = entry.id
        opt.textContent = `${entry.label} (${entry.id})`
        return opt
      })
    )
    const target = models.some((m) => m.id === selectedModel) ? selectedModel! : models[0].id
    DOM.selectModel.value = target
  }

  private renderProviderState(summary: ConfigSummary, selectedProvider: AIProvider): void {
    const geminiCred = summary.credentials.gemini
    const groqCred = summary.credentials.groq

    if (DOM.geminiCredentialStatus) {
      DOM.geminiCredentialStatus.textContent = geminiCred.configured
        ? `Configurada (${geminiCred.masked})`
        : 'Não configurada'
    }
    if (DOM.inputGeminiKey) {
      DOM.inputGeminiKey.placeholder = geminiCred.configured
        ? `Chave salva: ${geminiCred.masked} (digite para substituir)`
        : 'Digite sua chave do Google Gemini...'
    }
    if (DOM.btnRemoveGeminiKey) {
      DOM.btnRemoveGeminiKey.disabled = !geminiCred.configured
    }

    if (DOM.groqCredentialStatus) {
      DOM.groqCredentialStatus.textContent = groqCred.configured
        ? `Configurada (${groqCred.masked})`
        : 'Não configurada'
    }
    if (DOM.inputGroqKey) {
      DOM.inputGroqKey.placeholder = groqCred.configured
        ? `Chave salva: ${groqCred.masked} (digite para substituir)`
        : 'Digite sua chave da Groq (gsk_...)...'
    }
    if (DOM.btnRemoveGroqKey) {
      DOM.btnRemoveGroqKey.disabled = !groqCred.configured
    }

    if (DOM.ollamaProviderStatus) {
      DOM.ollamaProviderStatus.textContent =
        selectedProvider === 'ollama' && summary.isConnected
          ? 'Ativo localmente (http://127.0.0.1:11434)'
          : 'Sem chave necessária (http://127.0.0.1:11434)'
    }

    document.querySelectorAll('.provider-credential-card').forEach((card) => {
      const cardProvider = card.getAttribute('data-provider-card')
      card.classList.toggle('active-provider-card', cardProvider === selectedProvider)
    })

    const providerLabel = AI_PROVIDER_CATALOG[selectedProvider]?.label || selectedProvider
    if (DOM.settingsConnectionStatus) {
      DOM.settingsConnectionStatus.textContent = summary.isConnected
        ? `Conectado (${providerLabel})`
        : `Desconectado (${providerLabel})`
    }
  }

  private renderMemoryFacts(facts: Array<{ fact: string }>): void {
    const { memoryFactsList, memoryCountBadge } = DOM
    if (!memoryFactsList) return
    if (memoryCountBadge) memoryCountBadge.textContent = `${facts.length} ${facts.length === 1 ? 'fato' : 'fatos'}`
    if (facts.length === 0) {
      const emptyState = document.createElement('span')
      emptyState.className = 'memory-empty'
      emptyState.textContent = 'Nenhum fato memorizado ainda.'
      memoryFactsList.replaceChildren(emptyState)
      return
    }
    memoryFactsList.replaceChildren(
      ...facts.map(({ fact }) => {
        const item = document.createElement('div')
        item.className = 'memory-fact-item'
        item.textContent = fact
        return item
      })
    )
  }

  public async refreshMemoryUI(): Promise<void> {
    if (!DOM.memoryFactsList) return
    try {
      this.renderMemoryFacts((await window.electronAPI.getMemory())?.facts || [])
    } catch {
      DOM.memoryFactsList.textContent = 'Erro ao carregar memórias.'
    }
  }

  public async refreshConsentUI(): Promise<void> {
    if (!DOM.operationalConsentStatus) return
    try {
      const accepted = await window.electronAPI.isConsentAccepted()
      DOM.operationalConsentStatus.textContent = accepted
        ? 'Consentimento ativo nesta instalação'
        : 'Consentimento pendente'
    } catch {
      DOM.operationalConsentStatus.textContent = 'Indisponível'
    }
  }

  public async refreshLicenseUI(): Promise<void> {
    try {
      const info = await window.electronAPI.getLicenseStatus()
      if (DOM.tabLicenseHwid) DOM.tabLicenseHwid.textContent = info.currentHwid || 'N/A'
      if (DOM.tabLicenseClientName) DOM.tabLicenseClientName.textContent = info.clientName || 'Não registrado'
      if (DOM.tabLicenseActivatedAt) {
        DOM.tabLicenseActivatedAt.textContent = info.activatedAt ? new Date(info.activatedAt).toLocaleString() : '-'
      }
      if (DOM.tabLicenseLastChecked) {
        const checkedAt = info.lastSeenAt || info.gateSnapshot?.expiresAt || info.activatedAt
        DOM.tabLicenseLastChecked.textContent = checkedAt ? new Date(checkedAt).toLocaleString() : 'Validação a cada 72h'
      }
      if (DOM.tabLicenseBadgeStatus) {
        DOM.tabLicenseBadgeStatus.className = `license-status-badge ${info.status || 'unlicensed'}`
        DOM.tabLicenseBadgeStatus.textContent = info.isLicensed
          ? 'LICENÇA ATIVA'
          : info.status === 'disabled'
            ? 'NODE BLOQUEADO'
            : info.status === 'revoked'
              ? 'REVOGADA'
              : 'NÃO ATIVADO'
      }
      if (DOM.tabLicenseKey && info.keyMasked) DOM.tabLicenseKey.placeholder = `Chave atual: ${info.keyMasked}`
      if (DOM.tabLicenseFeedback) DOM.tabLicenseFeedback.style.display = 'none'
    } catch (error) {
      console.warn('[SettingsModal] Falha ao carregar status da licença:', error)
    }
  }

  private collectCurrentDraft(fallback: SettingsDraft): SettingsDraft {
    const checkUpdatesDaily = document.getElementById('check-updates-daily') as HTMLInputElement | null
    const rawProvider = DOM.selectAiProvider?.value
    const aiProvider: AIProvider = isAIProvider(rawProvider) ? rawProvider : fallback.aiProvider
    const switched = switchDraftProvider(fallback, aiProvider)

    return {
      aiProvider,
      model: DOM.selectModel?.value || switched.model,
      voiceName: DOM.selectVoice?.value || fallback.voiceName,
      agentName: DOM.inputAgentName?.value.trim() || fallback.agentName || 'Jasper',
      checkUpdatesDaily: checkUpdatesDaily ? checkUpdatesDaily.checked : fallback.checkUpdatesDaily,
      enableWakeWord: DOM.checkWakeWord ? DOM.checkWakeWord.checked : fallback.enableWakeWord,
      enableBloom: DOM.checkBloom ? DOM.checkBloom.checked : fallback.enableBloom,
      enableNeuralBg: DOM.checkNeuralBg ? DOM.checkNeuralBg.checked : fallback.enableNeuralBg,
      enableEyeTracking: DOM.checkEyeTracking ? DOM.checkEyeTracking.checked : fallback.enableEyeTracking,
      enableScreenAwareness: DOM.checkScreenAwareness
        ? DOM.checkScreenAwareness.checked
        : fallback.enableScreenAwareness,
      avatarMood: this.currentMood
    }
  }

  private setupListeners(): void {
    const {
      btnSettings,
      settingsModal,
      btnCloseSettings,
      btnCancelSettings,
      btnSaveSettings,
      settingsStatus,
      inputAgentName,
      agentNamePreview,
      selectAiProvider,
      inputGeminiKey,
      btnToggleGeminiKey,
      btnRemoveGeminiKey,
      inputGroqKey,
      btnToggleGroqKey,
      btnRemoveGroqKey,
      selectVoice,
      selectModel,
      checkWakeWord,
      checkBloom,
      checkNeuralBg,
      checkEyeTracking,
      checkScreenAwareness,
      btnClearMemory
    } = DOM

    const checkUpdatesDaily = document.getElementById('check-updates-daily') as HTMLInputElement | null
    const btnCheckUpdates = document.getElementById('btn-check-updates') as HTMLButtonElement | null
    const btnDownloadUpdate = document.getElementById('btn-download-update') as HTMLButtonElement | null
    const btnInstallUpdate = document.getElementById('btn-install-update') as HTMLButtonElement | null
    const updateStatus = document.getElementById('update-status')

    const renderUpdateState = (state: UpdateState): void => {
      if (updateStatus) updateStatus.textContent = state.message
      btnDownloadUpdate?.classList.toggle('hidden', state.phase !== 'available' || state.portable)
      btnInstallUpdate?.classList.toggle('hidden', state.phase !== 'downloaded')
      if (btnCheckUpdates) btnCheckUpdates.disabled = state.phase === 'checking' || state.phase === 'downloading'
    }
    window.electronAPI.onUpdateStatus(renderUpdateState)
    btnCheckUpdates?.addEventListener('click', async () => renderUpdateState(await window.electronAPI.checkForUpdates()))
    btnDownloadUpdate?.addEventListener('click', async () => renderUpdateState(await window.electronAPI.downloadUpdate()))
    btnInstallUpdate?.addEventListener('click', async () => {
      const result = await window.electronAPI.installUpdate()
      if (!result.success && updateStatus) updateStatus.textContent = result.message
    })

    const activateTab = (rawTab: string): void => {
      const sectionKey = rawTab.replace(/^tab-/, '')
      const targetId = `tab-${sectionKey}`
      document.querySelectorAll('.settings-tab-btn').forEach((button) => {
        const tab = (button.getAttribute('data-tab') || '').replace(/^tab-/, '')
        button.classList.toggle('active', tab === sectionKey)
      })
      document.querySelectorAll('.settings-tab-pane').forEach((pane) => {
        pane.classList.toggle('active', pane.id === targetId)
      })
      const meta = SECTION_META[sectionKey]
      if (meta) {
        if (DOM.settingsSectionTitle) DOM.settingsSectionTitle.textContent = meta.title
        if (DOM.settingsSectionDescription) DOM.settingsSectionDescription.textContent = meta.description
      }
    }

    document.querySelectorAll('.settings-tab-btn').forEach((button) => {
      button.addEventListener('click', () => {
        const tab = button.getAttribute('data-tab')
        if (tab) activateTab(tab)
      })
    })

    document.querySelectorAll('.emotion-btn').forEach((button) => {
      button.addEventListener('click', () => {
        document.querySelectorAll('.emotion-btn').forEach((item) => item.classList.remove('active'))
        button.classList.add('active')
        this.currentMood = (button.getAttribute('data-mood') || 'neutral') as MoodType
        this.options.getAvatar()?.setMood(this.currentMood)
      })
    })

    inputAgentName?.addEventListener('input', () => {
      const previewName = inputAgentName.value.trim() || 'Jasper'
      if (agentNamePreview) agentNamePreview.textContent = `ID: ${previewName.toUpperCase()}`
      this.options.setAgentName(previewName)
    })

    checkBloom?.addEventListener('change', () => {
      this.options.setBloomEnabled(checkBloom.checked)
    })
    checkNeuralBg?.addEventListener('change', () => {
      this.options.setNeuralBgEnabled(checkNeuralBg.checked)
    })
    checkEyeTracking?.addEventListener('change', () => {
      this.options.setEyeTrackingEnabled(checkEyeTracking.checked)
    })

    selectAiProvider?.addEventListener('change', async () => {
      const nextProvider: AIProvider = isAIProvider(selectAiProvider.value) ? selectAiProvider.value : 'gemini'
      this.populateModelOptions(nextProvider)
      const summary = await window.electronAPI.getConfig()
      this.renderProviderState(summary, nextProvider)
    })

    btnSettings.addEventListener('click', async () => {
      activateTab('general')
      settingsModal.classList.remove('hidden')
      this.clearCredentialInputs()

      const config = await window.electronAPI.getConfig()
      this.openingDraft = createSettingsDraft(config, this.currentMood)

      if (inputAgentName) inputAgentName.value = this.openingDraft.agentName
      if (agentNamePreview) agentNamePreview.textContent = `ID: ${this.openingDraft.agentName.toUpperCase()}`
      if (selectAiProvider) selectAiProvider.value = this.openingDraft.aiProvider
      this.populateModelOptions(this.openingDraft.aiProvider, this.openingDraft.model)
      if (selectVoice) selectVoice.value = this.openingDraft.voiceName
      if (checkWakeWord) checkWakeWord.checked = this.openingDraft.enableWakeWord
      if (checkBloom) checkBloom.checked = this.openingDraft.enableBloom
      if (checkNeuralBg) checkNeuralBg.checked = this.openingDraft.enableNeuralBg
      if (checkEyeTracking) checkEyeTracking.checked = this.openingDraft.enableEyeTracking
      if (checkScreenAwareness) checkScreenAwareness.checked = this.openingDraft.enableScreenAwareness
      if (checkUpdatesDaily) checkUpdatesDaily.checked = this.openingDraft.checkUpdatesDaily

      this.renderProviderState(config, this.openingDraft.aiProvider)
      settingsStatus.textContent = config.isConnected ? 'Conectado ao agente.' : 'Agente desconectado.'

      await Promise.all([this.refreshMemoryUI(), this.refreshConsentUI(), this.refreshLicenseUI()])
      this.options.wakeTrainerUI.updateUI()
    })

    const rollbackAndClose = (): void => {
      this.clearCredentialInputs()
      if (this.openingDraft) {
        const restored = rollbackSettingsDraft(this.openingDraft)
        this.options.setAgentName(restored.agentName)
        this.options.setBloomEnabled(restored.enableBloom)
        this.options.setNeuralBgEnabled(restored.enableNeuralBg)
        this.options.setEyeTrackingEnabled(restored.enableEyeTracking)
        this.currentMood = restored.avatarMood
        this.options.getAvatar()?.setMood(restored.avatarMood)
      }
      settingsModal.classList.add('hidden')
    }

    btnCloseSettings.addEventListener('click', rollbackAndClose)
    btnCancelSettings?.addEventListener('click', rollbackAndClose)

    btnToggleGeminiKey?.addEventListener('click', () => {
      if (!inputGeminiKey) return
      inputGeminiKey.type = inputGeminiKey.type === 'password' ? 'text' : 'password'
      btnToggleGeminiKey.textContent = inputGeminiKey.type === 'password' ? 'Mostrar' : 'Ocultar'
    })

    btnToggleGroqKey?.addEventListener('click', () => {
      if (!inputGroqKey) return
      inputGroqKey.type = inputGroqKey.type === 'password' ? 'text' : 'password'
      btnToggleGroqKey.textContent = inputGroqKey.type === 'password' ? 'Mostrar' : 'Ocultar'
    })

    const handleRemoveCredential = async (provider: RemoteAIProvider): Promise<void> => {
      const label = provider === 'gemini' ? 'Google Gemini' : 'Groq'
      if (!confirm(`Deseja remover a credencial salva de ${label}?`)) return
      try {
        const result = await window.electronAPI.removeProviderCredential(provider)
        this.clearCredentialInputs()
        const updatedSummary = await window.electronAPI.getConfig()
        const selectedProvider: AIProvider = isAIProvider(selectAiProvider?.value)
          ? selectAiProvider.value
          : updatedSummary.aiProvider
        this.renderProviderState(updatedSummary, selectedProvider)
        settingsStatus.textContent = result.message
        if (result.runtimeStatus === 'missing-credential') {
          updateStatusBadge('disconnected', 'Credencial removida')
        }
      } catch (error) {
        settingsStatus.textContent = error instanceof Error ? error.message : 'Falha ao remover credencial.'
      }
    }

    btnRemoveGeminiKey?.addEventListener('click', () => {
      void handleRemoveCredential('gemini')
    })
    btnRemoveGroqKey?.addEventListener('click', () => {
      void handleRemoveCredential('groq')
    })

    btnClearMemory?.addEventListener('click', async () => {
      if (!confirm('Deseja apagar todos os fatos memorizados?')) return
      await window.electronAPI.clearMemory()
      await this.refreshMemoryUI()
    })

    DOM.tabBtnCopyHwid?.addEventListener('click', async () => {
      const hwid = DOM.tabLicenseHwid?.textContent
      if (hwid && hwid !== 'N/A') await navigator.clipboard.writeText(hwid)
    })
    DOM.tabLicenseKey?.addEventListener('input', () => {
      if (DOM.tabLicenseKey) DOM.tabLicenseKey.value = DOM.tabLicenseKey.value.toUpperCase().replace(/[^A-Z0-9-]/g, '')
    })
    DOM.tabBtnActivateKey?.addEventListener('click', async () => {
      const key = DOM.tabLicenseKey?.value.trim()
      if (!key || !DOM.tabLicenseFeedback) return
      DOM.tabBtnActivateKey!.disabled = true
      try {
        const outcome = await window.electronAPI.activateLicense(key)
        const unlocked = outcome.snapshot.state === 'unlocked'
        DOM.tabLicenseFeedback.textContent = outcome.snapshot.message
        DOM.tabLicenseFeedback.className = `license-feedback ${unlocked ? 'success' : 'error'}`
        DOM.tabLicenseFeedback.style.display = 'block'
        if (unlocked) {
          showHudToast('Licença ativada', 'Estação Jasper desbloqueada.', 'info', 5000)
          updateStatusBadge('online', 'Jasper pronto')
          await this.refreshLicenseUI()
        }
      } finally {
        DOM.tabBtnActivateKey!.disabled = false
      }
    })

    btnSaveSettings.addEventListener('click', async () => {
      const baseline = this.openingDraft || createSettingsDraft(await window.electronAPI.getConfig(), this.currentMood)
      const nextDraft = this.collectCurrentDraft(baseline)
      const typedCredentials = {
        geminiApiKey: inputGeminiKey?.value || '',
        groqApiKey: inputGroqKey?.value || ''
      }
      const classification = classifySettingsChanges(baseline, nextDraft, typedCredentials)
      const update = buildSettingsUpdate(baseline, nextDraft, typedCredentials)

      settingsStatus.textContent = 'Salvando configurações...'
      btnSaveSettings.disabled = true
      try {
        const saveResult = await window.electronAPI.saveConfig(update)
        this.clearCredentialInputs()

        this.options.setAgentName(nextDraft.agentName)
        this.options.setIsWakeWordEnabled(nextDraft.enableWakeWord)
        this.options.setBloomEnabled(nextDraft.enableBloom)
        this.options.setNeuralBgEnabled(nextDraft.enableNeuralBg)
        this.options.setEyeTrackingEnabled(nextDraft.enableEyeTracking)

        if (classification.requiresWakeWordReinit) {
          await this.options.reinitWakeWord()
        }

        let finalMessage = saveResult.message
        if (classification.requiresBackendSync && saveResult.runtimeStatus === 'offline') {
          const connectOutcome = await window.electronAPI.connectAgent()
          finalMessage = connectOutcome.success
            ? 'Configurações salvas e agente conectado.'
            : `Configurações salvas. ${connectOutcome.error || 'Agente desconectado.'}`
        }

        const refreshed = await window.electronAPI.getConfig()
        this.openingDraft = createSettingsDraft(refreshed, this.currentMood)
        this.renderProviderState(refreshed, this.openingDraft.aiProvider)
        settingsStatus.textContent = finalMessage
      } catch (error) {
        settingsStatus.textContent = error instanceof Error ? error.message : 'Falha ao salvar configurações.'
      } finally {
        btnSaveSettings.disabled = false
      }
    })
  }
}
