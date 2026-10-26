import * as THREE from 'three'
import { createScene } from './scene/lights-camera'
import { AvatarController } from './scene/avatar'
import { AudioPlayer } from './audio/audio-player'
import { LipSyncAnalyzer } from './audio/lip-sync'
import { MicRecorder } from './audio/mic-recorder'
import { DOM } from './ui/dom'
import { updateStatusBadge, applyAgentName, getCurrentAgentName } from './ui/status-badge'
import { AudioVisualizer } from './audio/audio-visualizer'
import { OfflineHandler } from './offline/offline-handler'
import { initChatDrawer } from './ui/chat-drawer'
import { WakeWordManager } from './audio/wake-word-manager'
import { SettingsModal } from './ui/settings-modal'
import { NeuralBackground } from './scene/neural-background'
import { showHudToast } from './ui/toast'
import { ControlConsentModal } from './ui/control-consent-modal'
import { licenseModal } from './ui/license-modal'
import { initializeTaskProgress } from './ui/task-progress'
import type { LicenseGateSnapshot, AgentStatusPayload } from '@shared'

// Audio & 3D Core instances
initializeTaskProgress()
const audioPlayer = new AudioPlayer()
const lipSync = new LipSyncAnalyzer()
const micRecorder = new MicRecorder()
const audioVisualizer = new AudioVisualizer()
const offlineHandler = new OfflineHandler()

let avatar: AvatarController | null = null
let currentMicLevel = 0
let transcriptFadeTimeout: any = null
let isWakeWordEnabled = true
let isBloomEnabled = true
let isConnected = false
let isCallMode = false
let callStartPending = false
let callGeneration = 0
let shouldEndCallAfterPlayback = false
let activeRuntimeDisposer: (() => void) | null = null
let currentLicenseState: string = 'locked'
let operationalBootstrapGeneration = 0
let voiceRuntimeAuthorized = false
let loadOperationalConfig: () => Promise<void> = async () => {}

// Forward declarations
let wakeWordManager: WakeWordManager
let controlConsentModal: ControlConsentModal

export function syncDashboardConnectionIndicators(connected: boolean, subtitle?: string): void {
  const widgetTitle = DOM.settingsConnectionStatus || document.querySelector('.widget-status-title')
  const widgetSub = DOM.settingsConnectionDetail || document.querySelector('.widget-status-sub')
  const sidebarHeadline = document.querySelector('.sidebar-status-headline')
  const sidebarCaption = document.querySelector('.sidebar-status-caption')

  if (widgetTitle) {
    widgetTitle.textContent = connected ? 'Sistema Online' : 'Sistema Offline'
  }
  if (widgetSub) {
    widgetSub.textContent = subtitle || (connected ? 'Tudo operacional' : 'Conectando ao Jasper Core...')
  }
  if (sidebarHeadline) {
    sidebarHeadline.innerHTML = connected
      ? 'Conectado ao <strong>Jasper Core</strong>'
      : 'Aguardando <strong>Jasper Core</strong>'
  }
  if (sidebarCaption) {
    sidebarCaption.textContent = subtitle || (connected ? 'IA pronta para interagir' : 'Aguardando inicialização do agente')
  }
}

export async function enterCallMode(withGreeting = true): Promise<void> {
  if (isCallMode || callStartPending) return

  if (currentLicenseState !== 'unlocked') {
    showHudToast('Licença Obrigatória', 'Ative sua licença para desbloquear as funções de voz do Jasper.', 'error', 5000)
    licenseModal.show(true)
    return
  }

  isCallMode = true
  callStartPending = true
  const generation = ++callGeneration
  shouldEndCallAfterPlayback = false
  console.log('[Jasper] Ativando Modo Chamada Full-Duplex...')

  try {
  // 1. Pause wake word detector so it does not interfere
  if (wakeWordManager) {
    await wakeWordManager.pause()
  }

  // 2. Visual and state update
  DOM.btnMic?.classList.add('active')
  if (DOM.micStatusLabel) {
    DOM.micStatusLabel.textContent = 'Modo Chamada (Full-Duplex)'
  }

    updateStatusBadge('connecting', 'Conectando ao Gemini Live...')
    const live = await window.electronAPI.startLiveCall(withGreeting)
    if (!live.success) throw new Error(live.error || 'Não foi possível iniciar a chamada.')
    if (generation !== callGeneration || !isCallMode || currentLicenseState !== 'unlocked') {
      await window.electronAPI.stopLiveCall()
      return
    }
    micRecorder.setRealtimeMode(true)
    await micRecorder.start(true)
    if (generation !== callGeneration || !isCallMode || currentLicenseState !== 'unlocked') {
      micRecorder.stop()
      return
    }
    updateStatusBadge('call', 'Gemini Live — ouvindo...')
    if (DOM.micStatusLabel) DOM.micStatusLabel.textContent = 'Gemini Live — toque para encerrar'
  } catch (err) {
    if (generation !== callGeneration) return
    console.error('[Jasper] Erro ao iniciar gravação no Modo Chamada:', err)
    showHudToast('Chamada Gemini Live', err instanceof Error ? err.message : 'Falha ao iniciar chamada.', 'error', 7000)
    await exitCallMode()
  } finally {
    callStartPending = false
  }
}

export async function exitCallMode(): Promise<void> {
  if (!isCallMode) return
  isCallMode = false
  callGeneration++
  shouldEndCallAfterPlayback = false

  console.log('[Jasper] Encerrando Modo Chamada...')
  micRecorder.stop()
  micRecorder.setRealtimeMode(false)
  audioPlayer.stopAll()
  DOM.btnMic?.classList.remove('active')
  if (DOM.micStatusLabel) {
    DOM.micStatusLabel.textContent = 'Pressione para falar'
  }
  updateStatusBadge('connected', `${getCurrentAgentName()} Online`)
  try { await window.electronAPI.stopLiveCall() } catch { /* License shutdown already stops the sidecar. */ }

  if (isWakeWordEnabled && wakeWordManager) {
    setTimeout(async () => {
      if (!isCallMode && isWakeWordEnabled) {
        await wakeWordManager.resume(false)
      }
    }, 200)
  }
}

const handleIncomingAudio = (base64Audio: string, format?: string): void => {
  if (format === 'pcm' && !isCallMode) return
  micRecorder.notifyAssistantActivity()
  updateStatusBadge('speaking', `${getCurrentAgentName()} Falando...`)
  audioPlayer.enqueueAudioChunk(base64Audio, format)
}

const handleIncomingText = (text: string): void => {
  let cleanText = text.replace(/^\*\*.*?\*\*\s*/s, '').trim()
  if (!cleanText) cleanText = text.trim()

  DOM.transcriptText.textContent = cleanText
  DOM.transcriptBox.classList.remove('hidden')

  if (transcriptFadeTimeout) clearTimeout(transcriptFadeTimeout)
  transcriptFadeTimeout = setTimeout(() => {
    DOM.transcriptBox.classList.add('hidden')
  }, 9000)

  if (isCallMode) {
    const farewellRegex = /\b(tchau|até mais|até logo|chamada encerrada|tenha um bom dia|tenha uma boa tarde|tenha uma boa noite|se precisar de algo|até a próxima)\b/i
    if (farewellRegex.test(cleanText)) {
      shouldEndCallAfterPlayback = true
    }
  }
}

const handleInterrupted = (): void => {
  console.log('[Jasper] Barge-in: Interrupção detectada. Interrompendo áudio imediatamente.')
  audioPlayer.stopAll()
  lipSync.reset()
  DOM.transcriptBox.classList.add('hidden')
  if (isCallMode) {
    updateStatusBadge('call', `${getCurrentAgentName()} Ouvindo... (Chamada)`)
  }
}

const handleTurnComplete = (): void => {
  micRecorder.notifyAssistantActivity()

  if (!audioPlayer.getIsSpeaking()) {
    if (isCallMode) {
      updateStatusBadge('call', `${getCurrentAgentName()} Ouvindo... (Chamada)`)
    } else {
      updateStatusBadge('connected', `${getCurrentAgentName()} Pronto`)
      if (DOM.micStatusLabel) DOM.micStatusLabel.textContent = 'Pressione para falar'
      DOM.btnMic?.classList.remove('active')
      if (isWakeWordEnabled && wakeWordManager) {
        wakeWordManager.resume(micRecorder.isRecording())
      }
    }
  }
}

const handleStatusChange = (statusPayload: AgentStatusPayload | string, message?: string): void => {
  const status = typeof statusPayload === 'string' ? statusPayload : statusPayload.status
  const msg = typeof statusPayload === 'string' ? message : statusPayload.message

  if (status === 'live_closed' && isCallMode) {
    void exitCallMode()
    return
  }

  if (status === 'connected') {
    isConnected = true
    syncDashboardConnectionIndicators(true, 'Tudo operacional')
    updateStatusBadge('connected', msg || `${getCurrentAgentName()} Online`)
  } else if (status === 'thinking') {
    updateStatusBadge('connecting', msg || `${getCurrentAgentName()} Processando...`)
  } else if (status === 'speaking') {
    updateStatusBadge('speaking', `${getCurrentAgentName()} Falando...`)
  } else if (status === 'listening') {
    updateStatusBadge('listening', msg || `${getCurrentAgentName()} Ouvindo...`)
  } else if (status === 'shutting_down' || status === 'disconnected') {
    isConnected = false
    syncDashboardConnectionIndicators(false, 'Desconectado')
    updateStatusBadge('disconnected', msg || 'Desconectado')
  } else if (status === 'error') {
    isConnected = false
    syncDashboardConnectionIndicators(false, msg || 'Erro no Agente')
    updateStatusBadge('error', msg || 'Erro no Agente')
  }
}

const handleAgentError = ({ message }: { message: string }): void => {
  if (isCallMode) void exitCallMode()
  syncDashboardConnectionIndicators(false, message)
  if (DOM.settingsStatus) {
    DOM.settingsStatus.textContent = message
  }
  updateStatusBadge('error', message)
}

export async function mountAgentRuntime(): Promise<() => void> {
  const mountGeneration = operationalBootstrapGeneration
  if (currentLicenseState !== 'unlocked') return () => {}

  if (activeRuntimeDisposer) {
    activeRuntimeDisposer()
    activeRuntimeDisposer = null
  }

  console.log('[Renderer] Montando runtime operacional do agente...')
  voiceRuntimeAuthorized = true

  const cleanups: Array<() => void> = []

  cleanups.push(
    window.electronAPI.onAgentAudio((audio) => handleIncomingAudio(audio.audio_base64, audio.format))
  )
  cleanups.push(window.electronAPI.onAgentText(handleIncomingText))
  cleanups.push(
    window.electronAPI.onUserTranscript((text) => {
      DOM.transcriptText.textContent = `Você: "${text}"`
      DOM.transcriptBox.classList.remove('hidden')
    })
  )
  cleanups.push(
    window.electronAPI.onToolExecution(({ tool, args }) => {
      const argPreview = Object.keys(args || {}).length > 0 ? JSON.stringify(args).slice(0, 90) : 'executando'
      updateStatusBadge('connecting', `${getCurrentAgentName()}: ${tool}`)
      showHudToast(`Ferramenta: ${tool}`, argPreview, 'info', 3500)
    })
  )
  cleanups.push(window.electronAPI.onTurnComplete(handleTurnComplete))
  cleanups.push(window.electronAPI.onInterrupted(handleInterrupted))
  cleanups.push(window.electronAPI.onAgentStatus(handleStatusChange))
  cleanups.push(window.electronAPI.onAgentError(handleAgentError))

  // Connect microphone stream to secure IPC
  micRecorder.onPcmChunk = (chunk) => {
    if (isCallMode && currentLicenseState === 'unlocked') window.electronAPI.sendLiveAudio(chunk)
  }
  micRecorder.onAudioLevel = (level) => {
    currentMicLevel = level
  }
  micRecorder.onUtteranceWavBase64 = (wavBase64) => {
    if (isConnected) {
      updateStatusBadge('listening', `${getCurrentAgentName()} Transcrevendo...`)
      const binary = Uint8Array.from(atob(wavBase64), (c) => c.charCodeAt(0)).buffer
      window.electronAPI.sendAudio(binary)
    }
  }
  micRecorder.onBargeIn = () => {
    handleInterrupted()
    window.electronAPI.interruptAgent()
  }
  micRecorder.onCallInactivityTimeout = () => {
    showHudToast('Chamada Encerrada', 'Modo Chamada finalizado por inatividade.', 'info', 4000)
    exitCallMode()
  }

  // AudioPlayer lifecycle
  audioPlayer.onPlaybackEnded = async () => {
    if (shouldEndCallAfterPlayback) {
      shouldEndCallAfterPlayback = false
      await exitCallMode()
      return
    }

    if (isCallMode) {
      updateStatusBadge('call', `${getCurrentAgentName()} Ouvindo... (Chamada)`)
      if (DOM.micStatusLabel) DOM.micStatusLabel.textContent = 'Modo Chamada (Ouvindo...)'
    } else {
      updateStatusBadge('connected', `${getCurrentAgentName()} Pronto`)
      if (DOM.micStatusLabel) DOM.micStatusLabel.textContent = 'Pressione para falar'
      DOM.btnMic?.classList.remove('active')
      if (isWakeWordEnabled && wakeWordManager) {
        await wakeWordManager.resume(micRecorder.isRecording())
      }
    }
  }

  // Initialize wake word engine if enabled
  if (isWakeWordEnabled && wakeWordManager) {
    await wakeWordManager.init()
  }

  if (currentLicenseState !== 'unlocked' || mountGeneration !== operationalBootstrapGeneration) {
    for (const cleanup of cleanups) cleanup()
    micRecorder.stop()
    audioPlayer.stopAll()
    return () => {}
  }

  try {
    const conn = await window.electronAPI.connectAgent()
    if (!conn.success) {
      console.warn('[Renderer] Agente não conectado na inicialização:', conn.error)
      isConnected = false
      syncDashboardConnectionIndicators(false, conn.error || 'Agente Desconectado')
      updateStatusBadge('disconnected', conn.error || 'Agente Desconectado')
    } else {
      isConnected = true
      syncDashboardConnectionIndicators(true, 'Tudo operacional')
      updateStatusBadge('connected', `${getCurrentAgentName()} Online`)
    }
  } catch (err: any) {
    console.error('[Renderer] Falha ao conectar ao agente:', err)
    isConnected = false
    syncDashboardConnectionIndicators(false, err?.message || 'Erro de Conexão')
    updateStatusBadge('error', 'Erro de Conexão')
  }

  const disposer = () => {
    voiceRuntimeAuthorized = false
    console.log('[Renderer] Desmontando runtime operacional do agente...')
    for (const cleanup of cleanups) {
      try {
        cleanup()
      } catch (err) {
        console.error('[Renderer] Erro ao limpar listener:', err)
      }
    }
    micRecorder.stop()
    isCallMode = false
    micRecorder.setRealtimeMode(false)
    void window.electronAPI.stopLiveCall().catch(() => {})
    audioPlayer.stopAll()
    if (wakeWordManager) {
      void wakeWordManager.pause()
    }
    isConnected = false
    syncDashboardConnectionIndicators(false, 'Bloqueado por licença')
  }

  activeRuntimeDisposer = disposer
  return disposer
}

export function applyLicenseSnapshot(
  snapshot: LicenseGateSnapshot,
  options: { configurationLoaded?: boolean } = {}
): void {
  const generation = ++operationalBootstrapGeneration
  currentLicenseState = snapshot.state

  if (snapshot.state === 'unlocked') {
    licenseModal.hide()
    void (async () => {
      if (!options.configurationLoaded) await loadOperationalConfig()
      if (generation !== operationalBootstrapGeneration || currentLicenseState !== 'unlocked') return

      const accepted = await window.electronAPI.isConsentAccepted()
      if (generation !== operationalBootstrapGeneration || currentLicenseState !== 'unlocked') return
      if (!accepted) {
        controlConsentModal?.show()
        return
      }
      await mountAgentRuntime()
    })().catch((error) => {
      console.error('[Renderer] Falha no bootstrap operacional:', error)
    })
  } else {
    voiceRuntimeAuthorized = false
    void wakeWordManager.pause()
    if (activeRuntimeDisposer) {
      activeRuntimeDisposer()
      activeRuntimeDisposer = null
    }
    controlConsentModal?.hide()
    licenseModal.show(true)
    updateStatusBadge('error', snapshot.message || 'Licença Bloqueada')
  }
}

wakeWordManager = new WakeWordManager({
  getIsWakeWordEnabled: () => isWakeWordEnabled && voiceRuntimeAuthorized && currentLicenseState === 'unlocked' && !isCallMode,
  onWakeTriggered: () => {
    enterCallMode(true)
  }
})

async function init(): Promise<void> {
  console.log('[Jasper] Inicializando 3D HUD Assistant...')

  // 1. Scene, Camera, Bloom & Lighting
  const sceneCtx = createScene(DOM.canvasContainer)
  const { scene, renderer, controls, render, setBloomEnabled } = sceneCtx

  const neuralBackground = new NeuralBackground(scene)
  avatar = new AvatarController(scene, renderer)
  offlineHandler.setAvatar(avatar)

  try {
    updateStatusBadge('connecting', 'Carregando Avatar 3D...')
    await avatar.loadModel('/models/facecap.glb')
    updateStatusBadge('connected', 'Avatar Pronto')
  } catch (err) {
    console.error('[Jasper] Model load error:', err)
    updateStatusBadge('error', 'Erro ao carregar modelo')
  }

  const analyser = audioPlayer.getAnalyser()
  if (analyser) {
    lipSync.setAnalyser(analyser)
  }
  micRecorder.isAssistantSpeaking = () => audioPlayer.getIsSpeaking()

  // Render Loop
  const clock = new THREE.Clock()
  function animate(): void {
    requestAnimationFrame(animate)
    if (document.hidden) return

    const delta = clock.getDelta()
    const elapsed = clock.getElapsedTime()

    controls.update()
    const lipSyncTargets = lipSync.update()
    neuralBackground.update(delta, elapsed, audioPlayer.getIsSpeaking())

    if (avatar) {
      avatar.update(delta, elapsed, lipSyncTargets)
    }

    audioVisualizer.draw(
      audioPlayer.getAnalyser(),
      audioPlayer.getIsSpeaking(),
      micRecorder.isRecording(),
      currentMicLevel
    )

    if (isCallMode && micRecorder.isRecording() && !audioPlayer.getIsSpeaking()) {
      const remainingSec = micRecorder.getRemainingInactivitySeconds()
      if (remainingSec < 30) {
        updateStatusBadge('call', `${getCurrentAgentName()} Ouvindo (${remainingSec}s)`)
      }
    }

    render()
  }
  animate()

  // Chat drawer and UI
  controlConsentModal = new ControlConsentModal({
    onConsentAccepted: () => {
      if (currentLicenseState === 'unlocked') {
        void mountAgentRuntime()
      }
    }
  })

  initChatDrawer({
    getIsConnected: () => isConnected,
    getAgentName: () => getCurrentAgentName(),
    offlineHandler,
    controlConsentModal
  })

  new SettingsModal({
    getAgentName: () => getCurrentAgentName(),
    setAgentName: (name) => applyAgentName(name),
    getAvatar: () => avatar,
    setBloomEnabled,
    setNeuralBgEnabled: (enabled) => neuralBackground.setVisible(enabled),
    setEyeTrackingEnabled: (enabled) => avatar?.setEyeTrackingEnabled(enabled),
    setIsWakeWordEnabled: (val) => { isWakeWordEnabled = val },
    reinitWakeWord: async () => { await wakeWordManager.init() },
    refreshActivationStatus: () => wakeWordManager.updateUI()
  })

  licenseModal.init()

  // Window Controls
  const updateFullscreenUI = (isFs: boolean): void => {
    const titlebar = document.getElementById('titlebar')
    if (titlebar) titlebar.classList.toggle('hidden', isFs)
    DOM.app?.classList.toggle('is-fullscreen', isFs)
    window.dispatchEvent(new Event('resize'))
  }

  DOM.btnFullscreen?.addEventListener('click', async () => {
    const isFs = await window.electronAPI.toggleFullscreen()
    updateFullscreenUI(isFs)
  })
  DOM.btnSettingsFullscreen?.addEventListener('click', async () => {
    const isFs = await window.electronAPI.toggleFullscreen()
    updateFullscreenUI(isFs)
  })
  DOM.btnMinimize?.addEventListener('click', () => window.electronAPI.windowMinimize())
  DOM.btnMaximize?.addEventListener('click', () => window.electronAPI.windowMaximize())
  DOM.btnClose?.addEventListener('click', () => window.electronAPI.windowClose())
  DOM.btnPip?.addEventListener('click', async () => { await window.electronAPI.togglePip() })

  loadOperationalConfig = async () => {
    if (currentLicenseState !== 'unlocked') return
    const initialConfig = await window.electronAPI.getConfig()
    if (currentLicenseState !== 'unlocked') return
    if (initialConfig.agentName) {
      applyAgentName(initialConfig.agentName)
    }
    isWakeWordEnabled = initialConfig.enableWakeWord !== false
    isBloomEnabled = initialConfig.enableBloom !== false
    setBloomEnabled(isBloomEnabled)
    neuralBackground.setVisible(initialConfig.enableNeuralBg !== false)
    avatar?.setEyeTrackingEnabled(initialConfig.enableEyeTracking !== false)
  }

  window.electronAPI.onAgentNameUpdated((name) => {
    applyAgentName(name)
  })
  window.electronAPI.onPipChange((isPip) => {
    DOM.app?.classList.toggle('mini-hud', isPip)
    DOM.btnPip?.classList.toggle('active', isPip)
  })
  window.electronAPI.onFullscreenChange((isFs) => {
    updateFullscreenUI(isFs)
  })

  // Hook license state listener
  window.electronAPI.onLicenseState((snapshot) => {
    applyLicenseSnapshot(snapshot)
  })

  DOM.btnMic?.addEventListener('click', async () => {
    if (isCallMode) {
      await exitCallMode()
    } else {
      await enterCallMode(false)
    }
  })

  // Check initial license status and bootstrap shell
  const initialCheckGeneration = operationalBootstrapGeneration
  const lic = await licenseModal.checkOnStartup()
  if (initialCheckGeneration !== operationalBootstrapGeneration) return

  const initialSnapshot: LicenseGateSnapshot = lic.gateSnapshot ?? {
    state: lic.isLicensed ? 'unlocked' : 'locked',
    message: lic.isLicensed ? 'Licença válida' : 'Estação sem licença ativa',
    expiresAt: lic.expiresAt
  }

  if (initialSnapshot.state === 'unlocked') {
    await loadOperationalConfig()
    if (initialCheckGeneration !== operationalBootstrapGeneration) return
  }

  applyLicenseSnapshot(initialSnapshot, { configurationLoaded: true })
}

window.addEventListener('DOMContentLoaded', init)
