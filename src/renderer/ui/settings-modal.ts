import { DOM } from './dom'
import { AvatarController, MoodType } from '../scene/avatar'
import { WakeTrainerUI } from './wake-trainer-ui'
import { showHudToast } from './toast'
import { updateStatusBadge } from './status-badge'
import type { UpdateConfigPayload, UpdateState } from '@shared'

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

export class SettingsModal {
  constructor(private readonly options: SettingsModalOptions) {
    this.setupListeners()
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
    memoryFactsList.replaceChildren(...facts.map(({ fact }) => {
      const item = document.createElement('div')
      item.className = 'memory-fact-item'
      item.textContent = fact
      return item
    }))
  }

  public async refreshMemoryUI(): Promise<void> {
    if (!DOM.memoryFactsList) return
    try {
      this.renderMemoryFacts((await window.electronAPI.getMemory())?.facts || [])
    } catch {
      DOM.memoryFactsList.textContent = 'Erro ao carregar memórias.'
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
      inputApiKey,
      btnToggleKey,
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
      const targetId = rawTab.startsWith('tab-') ? rawTab : `tab-${rawTab}`
      document.querySelectorAll('.settings-tab-btn').forEach((button) => {
        const tab = button.getAttribute('data-tab') || ''
        button.classList.toggle('active', (tab.startsWith('tab-') ? tab : `tab-${tab}`) === targetId)
      })
      document.querySelectorAll('.settings-tab-pane').forEach((pane) => pane.classList.toggle('active', pane.id === targetId))
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
        this.options.getAvatar()?.setMood((button.getAttribute('data-mood') || 'neutral') as MoodType)
      })
    })

    inputAgentName?.addEventListener('input', () => {
      if (agentNamePreview) agentNamePreview.textContent = `ID: ${(inputAgentName.value.trim() || 'Jasper').toUpperCase()}`
    })

    btnSettings.addEventListener('click', async () => {
      activateTab('identity')
      settingsModal.classList.remove('hidden')
      const config = await window.electronAPI.getConfig()
      if (inputAgentName) inputAgentName.value = config.agentName || this.options.getAgentName() || 'Jasper'
      if (agentNamePreview) agentNamePreview.textContent = `ID: ${(inputAgentName?.value || 'Jasper').toUpperCase()}`
      if (DOM.geminiKeyMaskedDisplay) {
        DOM.geminiKeyMaskedDisplay.textContent = config.hasFullKey ? config.apiKey : 'NENHUMA CHAVE CONFIGURADA'
      }
      inputApiKey.value = ''
      inputApiKey.placeholder = config.hasFullKey ? `Chave ativa: ${config.apiKey} (digite para alterar)` : 'Digite sua chave do Gemini'
      selectVoice.value = config.voiceName
      selectModel.value = config.model
      if (checkWakeWord) checkWakeWord.checked = config.enableWakeWord
      if (checkBloom) checkBloom.checked = config.enableBloom
      if (checkNeuralBg) checkNeuralBg.checked = config.enableNeuralBg
      if (checkEyeTracking) checkEyeTracking.checked = config.enableEyeTracking
      if (checkScreenAwareness) checkScreenAwareness.checked = config.enableScreenAwareness
      if (checkUpdatesDaily) checkUpdatesDaily.checked = config.checkUpdatesDaily
      settingsStatus.textContent = config.isConnected ? 'Conectado ao agente.' : 'Desconectado.'
      await Promise.all([this.refreshMemoryUI(), this.refreshLicenseUI()])
      this.options.wakeTrainerUI.updateUI()
    })

    const close = (): void => settingsModal.classList.add('hidden')
    btnCloseSettings.addEventListener('click', close)
    btnCancelSettings?.addEventListener('click', close)

    btnToggleKey.addEventListener('click', () => {
      inputApiKey.type = inputApiKey.type === 'password' ? 'text' : 'password'
      btnToggleKey.textContent = inputApiKey.type === 'password' ? 'Mostrar' : 'Ocultar'
    })
    DOM.btnRemoveKey?.addEventListener('click', async () => {
      if (!confirm('Deseja remover a chave de API do Google Gemini?')) return
      await window.electronAPI.saveConfig({ apiKey: '' })
      await window.electronAPI.disconnectAgent()
      inputApiKey.value = ''
      settingsStatus.textContent = 'Chave removida; agente desconectado.'
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
      const previous = await window.electronAPI.getConfig()
      const update: UpdateConfigPayload = {
        agentName: inputAgentName?.value.trim() || this.options.getAgentName() || 'Jasper',
        voiceName: selectVoice.value,
        model: selectModel.value,
        checkUpdatesDaily: checkUpdatesDaily?.checked ?? true,
        enableWakeWord: checkWakeWord?.checked ?? true,
        enableBloom: checkBloom?.checked ?? true,
        enableNeuralBg: checkNeuralBg?.checked ?? true,
        enableEyeTracking: checkEyeTracking?.checked ?? true,
        enableScreenAwareness: checkScreenAwareness?.checked ?? true
      }
      if (inputApiKey.value.trim() || !previous.hasFullKey) update.apiKey = inputApiKey.value.trim()

      settingsStatus.textContent = 'Salvando e conectando...'
      btnSaveSettings.disabled = true
      try {
        await window.electronAPI.saveConfig(update)
        this.options.setAgentName(update.agentName!)
        this.options.setIsWakeWordEnabled(update.enableWakeWord!)
        this.options.setBloomEnabled(update.enableBloom!)
        this.options.setNeuralBgEnabled(update.enableNeuralBg!)
        this.options.setEyeTrackingEnabled(update.enableEyeTracking!)
        if (previous.enableWakeWord !== update.enableWakeWord) await this.options.reinitWakeWord()
        const result = await window.electronAPI.connectAgent(update)
        settingsStatus.textContent = result.success ? 'Configurações salvas e agente conectado.' : `Configurações salvas. ${result.error || 'Agente offline.'}`
        if (result.success) setTimeout(close, 800)
      } catch (error) {
        settingsStatus.textContent = error instanceof Error ? error.message : 'Falha ao salvar configurações.'
      } finally {
        btnSaveSettings.disabled = false
      }
    })
  }
}
