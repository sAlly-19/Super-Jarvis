import { DOM } from './dom'
import { AvatarController, MoodType } from '../scene/avatar'
import { WakeTrainerUI } from './wake-trainer-ui'
import { SVG_ICONS } from './icons'
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

function setIconMessage(element: HTMLElement, icon: string, message: string): void {
  const iconElement = document.createElement('span')
  iconElement.setAttribute('aria-hidden', 'true')
  iconElement.innerHTML = icon
  element.replaceChildren(iconElement, document.createTextNode(` ${message}`))
}

export class SettingsModal {
  private options: SettingsModalOptions

  constructor(options: SettingsModalOptions) {
    this.options = options
    this.setupListeners()
  }

  private renderMemoryFacts(facts: Array<{ fact: string }>): void {
    const { memoryFactsList, memoryCountBadge } = DOM
    if (!memoryFactsList) return

    if (memoryCountBadge) {
      memoryCountBadge.textContent = `${facts.length} ${facts.length === 1 ? 'fato' : 'fatos'}`
    }
    if (facts.length === 0) {
      const emptyState = document.createElement('span')
      emptyState.className = 'memory-empty'
      emptyState.textContent = 'Nenhum fato memorizado ainda. Converse com o agente para ele aprender sobre você.'
      memoryFactsList.replaceChildren(emptyState)
      return
    }
    const items = facts.map((fact) => {
      const item = document.createElement('div')
      item.className = 'memory-fact-item'
      item.textContent = fact.fact
      return item
    })
    memoryFactsList.replaceChildren(...items)
  }

  public async refreshMemoryUI(): Promise<void> {
    const { memoryFactsList } = DOM
    if (!memoryFactsList) return

    try {
      const mem = await window.electronAPI.getMemory()
      const facts = mem?.facts || []
      this.renderMemoryFacts(facts)
    } catch {
      const errorState = document.createElement('span')
      errorState.className = 'memory-empty'
      errorState.textContent = 'Erro ao carregar memórias.'
      memoryFactsList.replaceChildren(errorState)
    }
  }

  public async refreshLicenseUI(): Promise<void> {
    const {
      tabLicenseHwid,
      tabLicenseBadgeStatus,
      tabLicenseClientName,
      tabLicenseActivatedAt,
      tabLicenseKey,
      tabLicenseFeedback
    } = DOM

    try {
      const info = await window.electronAPI.getLicenseStatus()
      if (tabLicenseHwid) {
        tabLicenseHwid.textContent = info.currentHwid || 'N/A'
      }
      if (tabLicenseClientName) {
        tabLicenseClientName.textContent = info.clientName || 'Não Registrado'
      }
      if (tabLicenseActivatedAt) {
        tabLicenseActivatedAt.textContent = info.activatedAt
          ? new Date(info.activatedAt).toLocaleString()
          : '-'
      }
      if (tabLicenseBadgeStatus) {
        tabLicenseBadgeStatus.className = `license-status-badge ${info.status || 'unlicensed'}`
        if (info.isLicensed) {
          tabLicenseBadgeStatus.textContent = 'VITALÍCIA ATIVA'
        } else if (info.status === 'disabled') {
          tabLicenseBadgeStatus.textContent = 'NODE BLOQUEADO'
        } else if (info.status === 'revoked') {
          tabLicenseBadgeStatus.textContent = 'REVOGADA'
        } else {
          tabLicenseBadgeStatus.textContent = 'NÃO ATIVADO'
        }
      }
      if (tabLicenseKey && info.keyMasked) {
        tabLicenseKey.placeholder = `Chave atual: ${info.keyMasked}`
      }
      if (tabLicenseFeedback) {
        tabLicenseFeedback.style.display = 'none'
      }
    } catch (err) {
      console.warn('[SettingsModal] Erro ao carregar status da licença:', err)
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
      checkSystemTools,
      checkMediaTools,
      checkScreenAwareness,
      checkWindowTracker,
      checkClipboardWatcher,
      checkCronEngine,
      checkDailyBriefing,
      checkSystemHealth,
      checkSemanticMemory,
      checkKnowledgeGraph,
      checkHeadlessBrowser,
      checkGitWatcher,
      checkFolderOrganizer,
      checkSubagents,
      checkReflexionLoop,
      checkCalendarEmail,
      checkWebhooks,
      checkSmartHome,
      checkProcessManager,
      checkUiAutomation,
      checkMediaController,
      checkReportGenerator,
      checkFileSummarizer,
      checkQrService,
      checkOcrService,
      checkPresentationMode,
      checkFocusMode,
      btnClearMemory,
      inputGitRepoPath,
      btnBrowseGitRepo,
      selectFolderTarget,
      inputEmailHost,
      inputEmailPort,
      inputEmailUser,
      inputEmailPassword,
      btnToggleEmailPw,
      inputWebhookUrl,
      btnTestWebhook,
      webhookTestFeedback,
      inputHassUrl,
      inputHassToken,
      btnToggleHassToken,
      btnTestHass,
      hassTestFeedback
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

    const modalFooter = settingsModal?.querySelector('.modal-footer') as HTMLElement | null
    const instructionTextEl = settingsModal?.querySelector('.tab-instruction-line span') as HTMLElement | null
    const sidebarLiveCard = document.getElementById('sidebar-live-card')
    const clockTimeEl = document.getElementById('dashboard-clock-time')
    const clockDateEl = document.getElementById('dashboard-clock-date')

    const tabInstructions: Record<string, string> = {
      'tab-identity': 'Customize a aparência, comportamento visual e identidade do seu assistente de IA.',
      'tab-ai': 'Configure o modelo Gemini Live, chave de API, síntese de voz e calibração neural.',
      'tab-tools': 'Gerencie integrações de sistema, controle de mídia e ferramentas nativas.',
      'tab-memory': 'Visualize e gerencie fatos e preferências memorizados pelo assistente.',
      'tab-autonomy': 'Configure permissões de autonomia, automações proativas e agentes secundários.',
      'tab-license': 'Gerencie sua licença vitalícia Node-Locked e identificação de hardware.'
    }

    const updateDashboardClock = (): void => {
      const now = new Date()
      if (clockTimeEl) {
        const hh = String(now.getHours()).padStart(2, '0')
        const mm = String(now.getMinutes()).padStart(2, '0')
        clockTimeEl.textContent = `${hh}:${mm}`
      }
      if (clockDateEl) {
        const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
        const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
        clockDateEl.textContent = `${days[now.getDay()]}, ${String(now.getDate()).padStart(2, '0')} de ${months[now.getMonth()]}`
      }
    }
    updateDashboardClock()
    setInterval(updateDashboardClock, 15000)

    const activateTab = (rawTab: string): void => {
      const targetId = rawTab.startsWith('tab-') ? rawTab : `tab-${rawTab}`
      document.querySelectorAll('.settings-tab-btn').forEach((b) => {
        const btnTab = b.getAttribute('data-tab') || ''
        const normalized = btnTab.startsWith('tab-') ? btnTab : `tab-${btnTab}`
        b.classList.toggle('active', normalized === targetId)
      })
      document.querySelectorAll('.settings-tab-pane').forEach((p) => {
        p.classList.toggle('active', p.id === targetId)
      })
      if (modalFooter) {
        modalFooter.classList.toggle('hidden-on-identity', targetId === 'tab-identity')
      }
      if (instructionTextEl && tabInstructions[targetId]) {
        instructionTextEl.textContent = tabInstructions[targetId]
      }
    }

    const persistIdentitySettings = async (): Promise<void> => {
      const newName = inputAgentName?.value.trim() || this.options.getAgentName() || 'Jasper'
      const enableBloom = checkBloom ? checkBloom.checked : true
      const enableNeuralBg = checkNeuralBg ? checkNeuralBg.checked : true
      const enableEyeTracking = checkEyeTracking ? checkEyeTracking.checked : true

      this.options.setAgentName(newName)
      this.options.setBloomEnabled(enableBloom)
      this.options.setNeuralBgEnabled(enableNeuralBg)
      this.options.setEyeTrackingEnabled(enableEyeTracking)

      try {
        await window.electronAPI.saveConfig({
          agentName: newName,
          enableBloom,
          enableNeuralBg,
          enableEyeTracking
        })
      } catch (err) {
        console.warn('[SettingsModal] Auto-save identity config failed:', err)
      }
    }

    // Live update of agent name preview badge
    inputAgentName?.addEventListener('input', () => {
      const val = inputAgentName.value.trim() || this.options.getAgentName() || 'Jasper'
      if (agentNamePreview) {
        agentNamePreview.textContent = `ID: ${val.toUpperCase()}`
      }
    })

    inputAgentName?.addEventListener('change', () => {
      void persistIdentitySettings()
    })

    // Settings Tabs switching (syncs both Sidebar and Top Horizontal Bar)
    document.querySelectorAll('.settings-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab')
        if (!tab) return
        activateTab(tab)
      })
    })

    // Emotion Preset Buttons (instant avatar mood preview)
    document.querySelectorAll('.emotion-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.emotion-btn').forEach((b) => b.classList.remove('active'))
        btn.classList.add('active')
        const mood = (btn.getAttribute('data-mood') || 'neutral') as MoodType
        this.options.getAvatar()?.setMood(mood)
      })
    })

    btnSettings.addEventListener('click', async () => {
      updateDashboardClock()
      activateTab('tab-identity')
      this.options.wakeTrainerUI.updateUI()
      settingsModal.classList.remove('hidden')

      const config = await window.electronAPI.getConfig()
      const currentName = this.options.getAgentName()

      if (inputAgentName) {
        inputAgentName.value = config.agentName || currentName || 'Jasper'
      }
      if (agentNamePreview) {
        agentNamePreview.textContent = `ID: ${(inputAgentName?.value || currentName).toUpperCase()}`
      }
      if (DOM.geminiKeyMaskedDisplay) {
        if (config.apiKey && config.hasFullKey) {
          DOM.geminiKeyMaskedDisplay.textContent = config.apiKey
          DOM.geminiKeyMaskedDisplay.style.color = '#ffffff'
          inputApiKey.placeholder = `Chave ativa: ${config.apiKey} (digite para alterar)`
        } else {
          DOM.geminiKeyMaskedDisplay.textContent = 'NENHUMA CHAVE CONFIGURADA'
          DOM.geminiKeyMaskedDisplay.style.color = '#a1a1aa'
          inputApiKey.placeholder = 'Digite sua chave do Gemini (AIzaSy...)'
        }
      }
      const voiceVal = config.voiceName && config.voiceName.includes('Neural')
        ? config.voiceName
        : 'pt-BR-AntonioNeural'
      selectVoice.value = voiceVal
      const modelVal = config.model && config.model.includes('/')
        ? config.model
        : 'gemini/gemini-2.5-flash'
      selectModel.value = modelVal
      if (checkUpdatesDaily) checkUpdatesDaily.checked = config.checkUpdatesDaily !== false
      renderUpdateState(await window.electronAPI.getUpdateState())

      if (checkWakeWord) {
        checkWakeWord.checked = config.enableWakeWord !== false
      }
      if (checkBloom) {
        checkBloom.checked = config.enableBloom !== false
      }
      if (checkNeuralBg) {
        checkNeuralBg.checked = config.enableNeuralBg !== false
      }
      if (checkEyeTracking) {
        checkEyeTracking.checked = config.enableEyeTracking !== false
      }
      if (checkSystemTools) {
        checkSystemTools.checked = config.enableSystemTools !== false
      }
      if (checkMediaTools) {
        checkMediaTools.checked = config.enableMediaTools !== false
      }
      if (checkScreenAwareness) {
        checkScreenAwareness.checked = config.enableScreenAwareness !== false
      }
      if (checkWindowTracker) {
        checkWindowTracker.checked = config.enableWindowTracker !== false
      }
      if (checkClipboardWatcher) {
        checkClipboardWatcher.checked = config.enableClipboardWatcher !== false
      }
      if (checkCronEngine) {
        checkCronEngine.checked = config.enableCronEngine !== false
      }
      if (checkDailyBriefing) {
        checkDailyBriefing.checked = config.enableDailyBriefing !== false
      }
      if (checkSystemHealth) {
        checkSystemHealth.checked = config.enableSystemHealth !== false
      }
      if (checkSemanticMemory) {
        checkSemanticMemory.checked = config.enableSemanticMemory !== false
      }
      if (checkKnowledgeGraph) {
        checkKnowledgeGraph.checked = config.enableKnowledgeGraph !== false
      }
      if (checkHeadlessBrowser) {
        checkHeadlessBrowser.checked = config.enableHeadlessBrowser !== false
      }
      if (checkGitWatcher) {
        checkGitWatcher.checked = config.enableGitWatcher !== false
      }
      if (checkFolderOrganizer) {
        checkFolderOrganizer.checked = config.enableFolderOrganizer !== false
      }
      if (checkSubagents) {
        checkSubagents.checked = config.enableSubagents !== false
      }
      if (checkReflexionLoop) {
        checkReflexionLoop.checked = config.enableReflexionLoop !== false
      }
      if (checkCalendarEmail) {
        checkCalendarEmail.checked = config.enableCalendarEmail !== false
      }
      if (checkWebhooks) {
        checkWebhooks.checked = config.enableWebhooks !== false
      }
      if (checkSmartHome) {
        checkSmartHome.checked = config.enableSmartHome !== false
      }
      if (checkProcessManager) {
        checkProcessManager.checked = config.enableProcessManager !== false
      }
      if (checkUiAutomation) {
        checkUiAutomation.checked = config.enableUiAutomation !== false
      }
      if (checkMediaController) {
        checkMediaController.checked = config.enableMediaController !== false
      }
      if (checkReportGenerator) {
        checkReportGenerator.checked = config.enableReportGenerator !== false
      }
      if (checkFileSummarizer) {
        checkFileSummarizer.checked = config.enableFileSummarizer !== false
      }
      if (checkQrService) {
        checkQrService.checked = config.enableQrService !== false
      }
      if (checkOcrService) {
        checkOcrService.checked = config.enableOcrService !== false
      }
      if (checkPresentationMode) {
        checkPresentationMode.checked = config.enablePresentationMode !== false
      }
      if (checkFocusMode) {
        checkFocusMode.checked = config.enableFocusMode !== false
      }

      // Populate module specific settings
      if (inputGitRepoPath) {
        inputGitRepoPath.value = config.gitRepoPath || ''
      }
      if (selectFolderTarget) {
        selectFolderTarget.value = config.folderDefaultTarget || 'downloads'
      }
      if (inputEmailHost) {
        inputEmailHost.value = config.emailImapHost || ''
      }
      if (inputEmailPort) {
        inputEmailPort.value = config.emailImapPort ? String(config.emailImapPort) : '993'
      }
      if (inputEmailUser) {
        inputEmailUser.value = config.emailUser || ''
      }
      if (inputEmailPassword) {
        inputEmailPassword.value = ''
        inputEmailPassword.placeholder = config.hasEmailPassword ? 'Senha salva (digite para alterar)' : 'Senha do app'
      }
      if (inputWebhookUrl) {
        inputWebhookUrl.value = config.webhookDefaultUrl || ''
      }
      if (inputHassUrl) {
        inputHassUrl.value = config.hassUrl || ''
      }
      if (inputHassToken) {
        inputHassToken.value = ''
        inputHassToken.placeholder = config.hasHassToken ? 'Token salvo (digite para alterar)' : 'Cole o token gerado no perfil'
      }
      if (hassTestFeedback) {
        hassTestFeedback.textContent = ''
        hassTestFeedback.className = 'config-test-feedback'
      }
      if (webhookTestFeedback) {
        webhookTestFeedback.textContent = ''
        webhookTestFeedback.className = 'config-test-feedback'
      }

      settingsStatus.textContent = config.isConnected ? 'Conectado ao Gemini Live.' : 'Desconectado.'
      settingsStatus.className = 'modal-status'

      // Refresh memory items
      await this.refreshMemoryUI()

      // Refresh license status
      await this.refreshLicenseUI()
      this.options.wakeTrainerUI.updateUI()
    })

    const closeDashboard = (): void => {
      void persistIdentitySettings()
      settingsModal.classList.add('hidden')
    }

    btnCloseSettings.addEventListener('click', closeDashboard)
    sidebarLiveCard?.addEventListener('click', closeDashboard)

    btnCancelSettings?.addEventListener('click', () => {
      settingsModal.classList.add('hidden')
    })

    // License Tab event listeners
    DOM.tabBtnCopyHwid?.addEventListener('click', () => {
      const hwid = DOM.tabLicenseHwid?.textContent
      if (hwid && hwid !== 'HWID-CALCULANDO...') {
        navigator.clipboard.writeText(hwid)
        showHudToast('Hardware ID', 'Hardware ID copiado com sucesso!', 'info', 3000)
      }
    })

    DOM.tabLicenseKey?.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement
      target.value = target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '')
    })

    DOM.tabBtnActivateKey?.addEventListener('click', async () => {
      const key = DOM.tabLicenseKey?.value.trim().toUpperCase()
      if (!key) {
        if (DOM.tabLicenseFeedback) {
          DOM.tabLicenseFeedback.textContent = 'Informe sua chave de licença vitalícia.'
          DOM.tabLicenseFeedback.className = 'license-feedback error'
          DOM.tabLicenseFeedback.style.display = 'block'
        }
        return
      }

      if (DOM.tabBtnActivateKey) {
        DOM.tabBtnActivateKey.disabled = true
        DOM.tabBtnActivateKey.textContent = 'VALIDANDO...'
      }

      try {
        const res = await window.electronAPI.activateLicense(key)
        const isUnlocked = res.snapshot.state === 'unlocked'
        if (DOM.tabLicenseFeedback) {
          DOM.tabLicenseFeedback.textContent = res.snapshot.message || (isUnlocked ? 'Licença ativada com sucesso!' : 'Erro na ativação.')
          DOM.tabLicenseFeedback.className = `license-feedback ${isUnlocked ? 'success' : 'error'}`
          DOM.tabLicenseFeedback.style.display = 'block'
        }

        if (isUnlocked) {
          showHudToast('Licença Ativada', 'Estação Jasper Desbloqueada com Sucesso!', 'info', 5000)
          updateStatusBadge('online', 'Jasper Pronto')
          await this.refreshLicenseUI()
        }
      } catch (err: any) {
        if (DOM.tabLicenseFeedback) {
          DOM.tabLicenseFeedback.textContent = 'Erro ao conectar ao servidor de autenticação.'
          DOM.tabLicenseFeedback.className = 'license-feedback error'
          DOM.tabLicenseFeedback.style.display = 'block'
        }
      } finally {
        if (DOM.tabBtnActivateKey) {
          DOM.tabBtnActivateKey.disabled = false
          DOM.tabBtnActivateKey.textContent = 'Ativar Chave'
        }
      }
    })

    btnToggleKey.addEventListener('click', () => {
      if (inputApiKey.type === 'password') {
        inputApiKey.type = 'text'
        btnToggleKey.textContent = 'Ocultar'
      } else {
        inputApiKey.type = 'password'
        btnToggleKey.textContent = 'Mostrar'
      }
    })

    DOM.btnRemoveKey?.addEventListener('click', async () => {
      if (!confirm('Deseja realmente remover a sua chave de API do Google Gemini? O assistente ficará desconectado até que uma nova chave seja informada.')) {
        return
      }

      inputApiKey.value = ''
      if (DOM.geminiKeyMaskedDisplay) {
        DOM.geminiKeyMaskedDisplay.textContent = 'NENHUMA CHAVE CONFIGURADA'
        DOM.geminiKeyMaskedDisplay.style.color = '#a1a1aa'
      }
      inputApiKey.placeholder = 'Digite sua chave do Gemini (AIzaSy...)'

      try {
        await window.electronAPI.saveConfig({ apiKey: '' })
        await window.electronAPI.disconnectGemini()
        updateStatusBadge('offline', 'Sem Chave Gemini')
        showHudToast('Chave Removida', 'A chave do Google Gemini foi removida com sucesso.', 'info', 4000)
      } catch (err: any) {
        showHudToast('Erro', `Falha ao remover chave: ${err.message || err}`, 'error', 5000)
      }
    })

    checkBloom?.addEventListener('change', () => {
      this.options.setBloomEnabled(checkBloom.checked)
      void persistIdentitySettings()
    })

    checkNeuralBg?.addEventListener('change', () => {
      this.options.setNeuralBgEnabled(checkNeuralBg.checked)
      void persistIdentitySettings()
    })

    checkEyeTracking?.addEventListener('change', () => {
      this.options.setEyeTrackingEnabled(checkEyeTracking.checked)
      void persistIdentitySettings()
    })

    btnClearMemory?.addEventListener('click', async () => {
      if (confirm('Tem certeza de que deseja apagar a memória acumulada do agente?')) {
        await window.electronAPI.clearMemory()
        await this.refreshMemoryUI()
      }
    })

    // Module-specific interactive handlers
    btnBrowseGitRepo?.addEventListener('click', async () => {
      try {
        const dir = await window.electronAPI.selectDirectory()
        if (dir && inputGitRepoPath) {
          inputGitRepoPath.value = dir
        }
      } catch (err) {
        console.warn('Error selecting directory:', err)
      }
    })

    btnToggleEmailPw?.addEventListener('click', () => {
      if (!inputEmailPassword) return
      if (inputEmailPassword.type === 'password') {
        inputEmailPassword.type = 'text'
        btnToggleEmailPw.textContent = 'Ocultar'
      } else {
        inputEmailPassword.type = 'password'
        btnToggleEmailPw.textContent = 'Mostrar'
      }
    })

    btnToggleHassToken?.addEventListener('click', () => {
      if (!inputHassToken) return
      if (inputHassToken.type === 'password') {
        inputHassToken.type = 'text'
        btnToggleHassToken.textContent = 'Ocultar'
      } else {
        inputHassToken.type = 'password'
        btnToggleHassToken.textContent = 'Mostrar'
      }
    })

    btnTestHass?.addEventListener('click', async () => {
      if (!hassTestFeedback) return
      const url = inputHassUrl?.value.trim()
      const token = inputHassToken?.value.trim() || undefined
      hassTestFeedback.textContent = 'Testando...'
      hassTestFeedback.className = 'config-test-feedback loading'

      try {
        const res = await window.electronAPI.testSmartHomeConnection(url, token)
        if (res.success) {
          setIconMessage(hassTestFeedback, SVG_ICONS.check, res.message)
          hassTestFeedback.className = 'config-test-feedback success'
        } else {
          setIconMessage(hassTestFeedback, SVG_ICONS.error, res.message)
          hassTestFeedback.className = 'config-test-feedback error'
        }
      } catch (err: any) {
        setIconMessage(hassTestFeedback, SVG_ICONS.error, `Erro: ${err?.message || 'Falha'}`)
        hassTestFeedback.className = 'config-test-feedback error'
      }
    })

    btnTestWebhook?.addEventListener('click', async () => {
      if (!webhookTestFeedback) return
      const url = inputWebhookUrl?.value.trim()
      if (!url) {
        setIconMessage(webhookTestFeedback, SVG_ICONS.error, 'Informe uma URL primeiro')
        webhookTestFeedback.className = 'config-test-feedback error'
        return
      }

      webhookTestFeedback.textContent = 'Disparando teste...'
      webhookTestFeedback.className = 'config-test-feedback loading'

      try {
        const res = await window.electronAPI.testWebhook(url)
        if (res.success) {
          setIconMessage(webhookTestFeedback, SVG_ICONS.check, `Sucesso! (HTTP ${res.status} em ${res.executionTimeMs}ms)`)
          webhookTestFeedback.className = 'config-test-feedback success'
        } else {
          setIconMessage(webhookTestFeedback, SVG_ICONS.error, `Falha: ${res.error || `HTTP ${res.status}`}`)
          webhookTestFeedback.className = 'config-test-feedback error'
        }
      } catch (err: any) {
        setIconMessage(webhookTestFeedback, SVG_ICONS.error, `Erro: ${err?.message || 'Falha'}`)
        webhookTestFeedback.className = 'config-test-feedback error'
      }
    })

    btnSaveSettings.addEventListener('click', async () => {
      const previousConfig = await window.electronAPI.getConfig()
      const newName = inputAgentName?.value.trim() || this.options.getAgentName() || 'Jasper'
      const apiKey = inputApiKey.value.trim()
      const voiceName = selectVoice.value
      const model = selectModel.value
      const enableWakeWord = checkWakeWord ? checkWakeWord.checked : true
      const enableBloom = checkBloom ? checkBloom.checked : true
      const enableNeuralBg = checkNeuralBg ? checkNeuralBg.checked : true
      const enableEyeTracking = checkEyeTracking ? checkEyeTracking.checked : true
      const enableSystemTools = checkSystemTools ? checkSystemTools.checked : true
      const enableMediaTools = checkMediaTools ? checkMediaTools.checked : true

      // Immediately apply new name, bloom and neural background
      this.options.setAgentName(newName)
      this.options.setIsWakeWordEnabled(enableWakeWord)
      this.options.setBloomEnabled(enableBloom)
      this.options.setNeuralBgEnabled(enableNeuralBg)
      this.options.setEyeTrackingEnabled(enableEyeTracking)

      settingsStatus.textContent = 'Salvando e conectando...'
      settingsStatus.className = 'modal-status'
      btnSaveSettings.disabled = true

      const update: UpdateConfigPayload = {
        agentName: newName,
        voiceName,
        model,
        checkUpdatesDaily: checkUpdatesDaily ? checkUpdatesDaily.checked : true,
        enableWakeWord,
        enableBloom,
        enableNeuralBg,
        enableEyeTracking,
        enableSystemTools,
        enableMediaTools,
        enableScreenAwareness: checkScreenAwareness ? checkScreenAwareness.checked : true,
        enableWindowTracker: checkWindowTracker ? checkWindowTracker.checked : true,
        enableClipboardWatcher: checkClipboardWatcher ? checkClipboardWatcher.checked : true,
        enableCronEngine: checkCronEngine ? checkCronEngine.checked : true,
        enableDailyBriefing: checkDailyBriefing ? checkDailyBriefing.checked : true,
        enableSystemHealth: checkSystemHealth ? checkSystemHealth.checked : true,
        enableSemanticMemory: checkSemanticMemory ? checkSemanticMemory.checked : true,
        enableKnowledgeGraph: checkKnowledgeGraph ? checkKnowledgeGraph.checked : true,
        enableHeadlessBrowser: checkHeadlessBrowser ? checkHeadlessBrowser.checked : true,
        enableGitWatcher: checkGitWatcher ? checkGitWatcher.checked : true,
        enableFolderOrganizer: checkFolderOrganizer ? checkFolderOrganizer.checked : true,
        enableSubagents: checkSubagents ? checkSubagents.checked : true,
        enableReflexionLoop: checkReflexionLoop ? checkReflexionLoop.checked : true,
        enableCalendarEmail: checkCalendarEmail ? checkCalendarEmail.checked : true,
        enableWebhooks: checkWebhooks ? checkWebhooks.checked : true,
        enableSmartHome: checkSmartHome ? checkSmartHome.checked : true,
        enableProcessManager: checkProcessManager ? checkProcessManager.checked : true,
        enableUiAutomation: checkUiAutomation ? checkUiAutomation.checked : true,
        enableMediaController: checkMediaController ? checkMediaController.checked : true,
        enableReportGenerator: checkReportGenerator ? checkReportGenerator.checked : true,
        enableFileSummarizer: checkFileSummarizer ? checkFileSummarizer.checked : true,
        enableQrService: checkQrService ? checkQrService.checked : true,
        enableOcrService: checkOcrService ? checkOcrService.checked : true,
        enablePresentationMode: checkPresentationMode ? checkPresentationMode.checked : true,
        enableFocusMode: checkFocusMode ? checkFocusMode.checked : true,
        // Module specific configurations
        gitRepoPath: inputGitRepoPath?.value.trim() || undefined,
        folderDefaultTarget: selectFolderTarget?.value || 'downloads',
        emailImapHost: inputEmailHost?.value.trim() || undefined,
        emailImapPort: inputEmailPort?.value ? Number(inputEmailPort.value) : undefined,
        emailUser: inputEmailUser?.value.trim() || undefined,
        emailPassword: inputEmailPassword?.value.trim() || undefined,
        webhookDefaultUrl: inputWebhookUrl?.value.trim() || undefined,
        hassUrl: inputHassUrl?.value.trim() || undefined,
        hassToken: inputHassToken?.value.trim() || undefined
      }
      if (apiKey !== '') update.apiKey = apiKey
      else if (!previousConfig.hasFullKey) update.apiKey = ''

      try {
        await window.electronAPI.saveConfig(update)


        if (previousConfig.enableWakeWord !== enableWakeWord) {
          await this.options.reinitWakeWord()
        }

        const connectionChanged =
          Boolean(apiKey) ||
          previousConfig.agentName !== newName ||
          previousConfig.voiceName !== voiceName ||
          previousConfig.model !== model ||
          previousConfig.enableSystemTools !== enableSystemTools ||
          previousConfig.enableMediaTools !== enableMediaTools

        if (!connectionChanged && previousConfig.isConnected) {
          settingsStatus.textContent = 'Configurações salvas!'
          settingsStatus.className = 'modal-status success'
          setTimeout(() => settingsModal.classList.add('hidden'), 800)
          return
        }

        const result = await window.electronAPI.connectGemini({
          agentName: newName,
          apiKey: apiKey || undefined,
          voiceName,
          model,
          enableSystemTools,
          enableMediaTools
        })

        if (result.success) {
          settingsStatus.textContent = 'Conectado com sucesso!'
          settingsStatus.className = 'modal-status success'
          setTimeout(() => {
            settingsModal.classList.add('hidden')
          }, 800)
        } else {
          settingsStatus.textContent = 'Configurações salvas. (Offline: ' + (result.error || 'sem conexão') + ')'
          settingsStatus.className = 'modal-status'
          setTimeout(() => {
            settingsModal.classList.add('hidden')
          }, 1400)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Falha ao salvar as configurações.'
        settingsStatus.textContent = message.replace(/^Error invoking remote method '[^']+': Error:\s*/, '')
        settingsStatus.className = 'modal-status error'
      } finally {
        btnSaveSettings.disabled = false
      }
    })
  }
}
