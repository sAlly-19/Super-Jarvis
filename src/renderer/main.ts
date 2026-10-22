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
import { WakeTrainerUI } from './ui/wake-trainer-ui'
import { SettingsModal } from './ui/settings-modal'
import { NeuralBackground } from './scene/neural-background'
import { showHudToast } from './ui/toast'
import { initModuleInfoModal } from './ui/module-info-modal'
import { licenseModal } from './ui/license-modal'
import { jasperSocket } from './src/services/jasperSocket'

// Audio & 3D Core instances
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
let shouldEndCallAfterPlayback = false

// Forward declarations for circular references
let wakeTrainerUI: WakeTrainerUI
let wakeWordManager: WakeWordManager

function syncDashboardConnectionIndicators(connected: boolean, subtitle?: string): void {
  const widgetTitle = document.querySelector('.widget-status-title')
  const widgetSub = document.querySelector('.widget-status-sub')
  const sidebarHeadline = document.querySelector('.sidebar-status-headline')
  const sidebarCaption = document.querySelector('.sidebar-status-caption')

  if (widgetTitle) {
    widgetTitle.textContent = connected ? 'Sistema Online' : 'Sistema Offline'
  }
  if (widgetSub) {
    widgetSub.textContent = subtitle || (connected ? 'Tudo operacional' : 'Back-end reconectando')
  }
  if (sidebarHeadline) {
    sidebarHeadline.innerHTML = connected
      ? 'Conectado ao <strong>Jasper Core</strong>'
      : 'Aguardando <strong>Jasper Core</strong>'
  }
  if (sidebarCaption) {
    sidebarCaption.textContent = connected ? 'IA pronta para interagir' : 'Reconectando em 127.0.0.1:8765'
  }
}

async function enterCallMode(withGreeting = true): Promise<void> {
  if (isCallMode) return

  const lic = await window.electronAPI.getLicenseStatus()
  if (!lic.isLicensed) {
    showHudToast('Licença Obrigatória', 'Ative sua licença vitalícia para desbloquear os recursos de voz do Jasper.', 'error', 5000)
    licenseModal.show(true)
    return
  }

  // Ensure Python Backend & WebSocket are active before opening audio stream
  if (!jasperSocket.isConnected()) {
    console.log('[Jasper] Conectando ao Jasper Backend antes de iniciar chamada...')
    updateStatusBadge('connecting', 'Conectando ao Jasper...')
    try {
      const conn = await window.electronAPI.connectGemini()
      if (!conn.success) {
        updateStatusBadge('error', 'Falha ao conectar Back-End')
        showHudToast('Erro de Conexão', conn.error || 'Não foi possível iniciar o Back-End Python.', 'error', 5000)
        return
      }
      jasperSocket.connect()
      isConnected = true
    } catch (err: any) {
      updateStatusBadge('error', 'Erro ao conectar Back-End')
      showHudToast('Erro de Conexão', err?.message || 'Falha na conexão com o Back-End Python.', 'error', 5000)
      return
    }
  }

  isCallMode = true
  shouldEndCallAfterPlayback = false
  console.log('[Jasper] Ativando Modo Chamada Full-Duplex...')

  // 1. Pause wake word detector so it does not run during call
  await wakeWordManager.pause()

  // 2. Visual and state update
  DOM.btnMic?.classList.add('active')
  if (DOM.micStatusLabel) {
    DOM.micStatusLabel.textContent = 'Modo Chamada (Full-Duplex)'
  }

  if (withGreeting) {
    // Proactive greeting: agent greets user and asks what they desire
    updateStatusBadge('speaking', `${getCurrentAgentName()} Chamando...`)
    const greetingPrompt = `O usuário acabou de chamar você. Cumprimente-o com elegância e brevidade em português e pergunte o que deseja.`
    if (jasperSocket.isConnected()) {
      jasperSocket.sendText(greetingPrompt)
    } else {
      window.electronAPI.sendTextMessage(greetingPrompt)
    }
    // Wait briefly so residual wake-word audio does not trigger server-side barge-in on the greeting
    await new Promise((r) => setTimeout(r, 300))
  } else {
    updateStatusBadge('call', `${getCurrentAgentName()} Ouvindo... (Chamada)`)
  }

  // 3. Start continuous full-duplex mic streaming
  if (!isCallMode) return
  try {
    await micRecorder.start(true)
  } catch (err) {
    console.error('[Jasper] Erro ao iniciar gravação no Modo Chamada:', err)
    await exitCallMode()
    return
  }
}

async function exitCallMode(): Promise<void> {
  if (!isCallMode) return
  isCallMode = false
  shouldEndCallAfterPlayback = false

  console.log('[Jasper] Encerrando Modo Chamada...')
  micRecorder.stop()
  DOM.btnMic?.classList.remove('active')
  if (DOM.micStatusLabel) {
    DOM.micStatusLabel.textContent = 'Pressione para falar'
  }
  updateStatusBadge('connected', `${getCurrentAgentName()} Online`)

  if (isWakeWordEnabled) {
    setTimeout(async () => {
      if (!isCallMode && isWakeWordEnabled) {
        await wakeWordManager.resume(false)
      }
    }, 200)
  }
}

wakeWordManager = new WakeWordManager({
  getAgentName: () => getCurrentAgentName(),
  getIsWakeWordEnabled: () => isWakeWordEnabled,
  onWakeTriggered: () => {
    enterCallMode(true)
  },
  onTrainerUIUpdate: () => wakeTrainerUI?.updateUI()
})

wakeTrainerUI = new WakeTrainerUI({
  getAgentName: () => getCurrentAgentName(),
  wakeWordManager,
  micRecorder
})

async function init(): Promise<void> {
  console.log('[Jasper] Initializing 3D HUD Assistant...')

  // 1. Scene, Camera, Bloom & Lighting
  const sceneCtx = createScene(DOM.canvasContainer)
  const { scene, renderer, controls, render, setBloomEnabled } = sceneCtx

  // 1b. Dynamic 3D Neural Background
  const neuralBackground = new NeuralBackground(scene)

  // 2. Avatar Controller
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

  // 3. Connect LipSync to AudioPlayer and configure mic VAD speaker awareness
  const analyser = audioPlayer.getAnalyser()
  if (analyser) {
    lipSync.setAnalyser(analyser)
  }
  micRecorder.isAssistantSpeaking = () => audioPlayer.getIsSpeaking()

  // 4. Render Loop at 60 FPS
  const clock = new THREE.Clock()
  function animate(): void {
    requestAnimationFrame(animate)

    if (document.hidden) {
      return
    }

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

  // 5. Initialize UI Subsystems
  initChatDrawer({
    getIsConnected: () => isConnected || jasperSocket.isConnected(),
    getAgentName: () => getCurrentAgentName(),
    offlineHandler
  })

  new SettingsModal({
    getAgentName: () => getCurrentAgentName(),
    setAgentName: (name) => applyAgentName(name, () => wakeTrainerUI.updateUI()),
    getAvatar: () => avatar,
    setBloomEnabled,
    setNeuralBgEnabled: (enabled) => neuralBackground.setVisible(enabled),
    setEyeTrackingEnabled: (enabled) => avatar?.setEyeTrackingEnabled(enabled),
    setIsWakeWordEnabled: (val) => { isWakeWordEnabled = val },
    reinitWakeWord: async () => { await wakeWordManager.init() },
    wakeTrainerUI
  })

  initModuleInfoModal()
  licenseModal.init()
  const licenseInfo = await licenseModal.checkOnStartup()

  // Window Controls & Fullscreen
  const updateFullscreenUI = (isFs: boolean): void => {
    const titlebar = document.getElementById('titlebar')
    if (titlebar) {
      titlebar.classList.toggle('hidden', isFs)
    }
    DOM.app?.classList.toggle('is-fullscreen', isFs)

    const iconEnter = document.getElementById('icon-fs-enter')
    const iconExit = document.getElementById('icon-fs-exit')
    if (iconEnter && iconExit) {
      iconEnter.classList.toggle('hidden', isFs)
      iconExit.classList.toggle('hidden', !isFs)
    }
    if (DOM.btnFullscreen) {
      DOM.btnFullscreen.title = isFs ? 'Sair da Tela Cheia (F12)' : 'Tela Cheia (F12)'
      DOM.btnFullscreen.classList.toggle('active', isFs)
    }
    if (DOM.btnSettingsFullscreen) {
      DOM.btnSettingsFullscreen.textContent = isFs ? 'Sair da Tela Cheia' : 'Ativar Tela Cheia'
    }

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

  // 6. Load Initial Persisted Config & Connect Python WebSocket
  const initialConfig = await window.electronAPI.getConfig()
  if (initialConfig.agentName) {
    applyAgentName(initialConfig.agentName, () => wakeTrainerUI.updateUI())
  }
  isWakeWordEnabled = initialConfig.enableWakeWord !== false
  isBloomEnabled = initialConfig.enableBloom !== false
  setBloomEnabled(isBloomEnabled)
  neuralBackground.setVisible(initialConfig.enableNeuralBg !== false)
  avatar?.setEyeTrackingEnabled(initialConfig.enableEyeTracking !== false)
  isConnected = initialConfig.isConnected

  // Connect persistent WebSocket to Python FastAPI Backend (ws://127.0.0.1:8765/ws/jasper)
  jasperSocket.connect({
    agentName: initialConfig.agentName || 'Jasper',
    model: initialConfig.model || 'gemini/gemini-2.5-flash',
    voiceName: initialConfig.voiceName || 'pt-BR-AntonioNeural',
    vision: initialConfig.enableScreenAwareness !== false
  })

  if (!licenseInfo.isLicensed) {
    updateStatusBadge('error', 'Licença Pendente')
  }

  // 7. Setup JasperSocket (Python FastAPI WebSocket) & Electron IPC Listeners
  let responseTimeout: any = null

  const handleIncomingAudio = (base64Audio: string, format?: string): void => {
    if (responseTimeout) {
      clearTimeout(responseTimeout)
      responseTimeout = null
    }
    micRecorder.notifyAssistantActivity()
    updateStatusBadge('speaking', `${getCurrentAgentName()} Falando...`)
    audioPlayer.enqueueAudioChunk(base64Audio, format)
  }

  const handleIncomingText = (text: string): void => {
    let cleanText = text.replace(/^\*\*.*?\*\*\s*/s, '').trim()
    if (!cleanText) {
      cleanText = text.trim()
    }

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
    if (responseTimeout) {
      clearTimeout(responseTimeout)
      responseTimeout = null
    }
    console.log('[Jasper] Barge-in: Interrupção detectada. Interrompendo áudio imediatamente.')
    audioPlayer.stopAll()
    lipSync.reset()
    DOM.transcriptBox.classList.add('hidden')
    if (isCallMode) {
      updateStatusBadge('call', `${getCurrentAgentName()} Ouvindo... (Chamada)`)
    }
  }

  const handleTurnComplete = (): void => {
    if (responseTimeout) {
      clearTimeout(responseTimeout)
      responseTimeout = null
    }
    micRecorder.notifyAssistantActivity()

    if (!audioPlayer.getIsSpeaking()) {
      if (isCallMode) {
        updateStatusBadge('call', `${getCurrentAgentName()} Ouvindo... (Chamada)`)
      } else {
        updateStatusBadge('connected', `${getCurrentAgentName()} Pronto`)
        if (DOM.micStatusLabel) DOM.micStatusLabel.textContent = 'Pressione para falar'
        DOM.btnMic?.classList.remove('active')
        if (isWakeWordEnabled) {
          wakeWordManager.resume(micRecorder.isRecording())
        }
      }
    }
  }

  const handleStatusChange = (status: string, message?: string): void => {
    if (status === 'connected') {
      isConnected = true
      syncDashboardConnectionIndicators(true, 'Tudo operacional')
      updateStatusBadge('connected', message || `${getCurrentAgentName()} Online`)
    } else if (status === 'connecting') {
      isConnected = false
      syncDashboardConnectionIndicators(false, 'Conectando...')
      updateStatusBadge('connecting', message || 'Conectando ao Jasper...')
    } else if (status === 'thinking') {
      updateStatusBadge('connecting', message || `${getCurrentAgentName()} Processando...`)
    } else if (status === 'speaking') {
      updateStatusBadge('speaking', `${getCurrentAgentName()} Falando...`)
    } else if (status === 'listening') {
      updateStatusBadge('listening', message || `${getCurrentAgentName()} Ouvindo...`)
    } else if (status === 'disconnected') {
      isConnected = false
      syncDashboardConnectionIndicators(false, 'Reconectando...')
      updateStatusBadge('disconnected', message || 'Desconectado')
    } else if (status === 'error') {
      isConnected = false
      updateStatusBadge('error', message || 'Verifique Configuração')
    }
  }

  // Bind JasperSocket WebSocket events
  jasperSocket.onAudioBase64 = handleIncomingAudio
  jasperSocket.onResponseText = handleIncomingText
  jasperSocket.onUserTranscript = (userText) => {
    DOM.transcriptText.textContent = `Você: "${userText}"`
    DOM.transcriptBox.classList.remove('hidden')
  }
  jasperSocket.onInterrupted = handleInterrupted
  jasperSocket.onTurnComplete = handleTurnComplete
  jasperSocket.onStatusChange = handleStatusChange
  jasperSocket.onToolExecution = ({ tool, args }) => {
    const argPreview = Object.keys(args || {}).length > 0 ? JSON.stringify(args).slice(0, 90) : 'executando'
    updateStatusBadge('connecting', `${getCurrentAgentName()}: ${tool}`)
    showHudToast(`Ferramenta: ${tool}`, argPreview, 'info', 3500)
  }
  jasperSocket.onError = (errMsg) => {
    showHudToast('Aviso do Agente', errMsg, 'error', 5000)
  }

  // Keep Electron IPC listeners for compatibility
  window.electronAPI.onAudioChunk((base64Audio) => handleIncomingAudio(base64Audio))
  window.electronAPI.onInterrupted(handleInterrupted)
  window.electronAPI.onTurnComplete(handleTurnComplete)
  window.electronAPI.onTextChunk(handleIncomingText)
  window.electronAPI.onStatusChange(handleStatusChange)

  // Setup AudioPlayer Lifecycle
  audioPlayer.onPlaybackEnded = async () => {
    if (shouldEndCallAfterPlayback) {
      shouldEndCallAfterPlayback = false
      await exitCallMode()
      return
    }

    if (isCallMode) {
      updateStatusBadge('call', `${getCurrentAgentName()} Ouvindo... (Chamada)`)
      if (DOM.micStatusLabel) {
        DOM.micStatusLabel.textContent = 'Modo Chamada (Ouvindo...)'
      }
    } else {
      updateStatusBadge('connected', `${getCurrentAgentName()} Pronto`)
      if (DOM.micStatusLabel) {
        DOM.micStatusLabel.textContent = 'Pressione para falar'
      }
      DOM.btnMic?.classList.remove('active')
      if (isWakeWordEnabled) {
        await wakeWordManager.resume(micRecorder.isRecording())
      }
    }
  }

  window.electronAPI.onAgentNameUpdated((name) => {
    applyAgentName(name, () => wakeTrainerUI.updateUI())
  })

  window.electronAPI.onPipChange((isPip) => {
    if (isPip) {
      DOM.app?.classList.add('mini-hud')
      DOM.btnPip?.classList.add('active')
    } else {
      DOM.app?.classList.remove('mini-hud')
      DOM.btnPip?.classList.remove('active')
    }
  })

  window.electronAPI.onFullscreenChange((isFs) => {
    updateFullscreenUI(isFs)
  })

  window.electronAPI.onAutonomyNotification((notif) => {
    showHudToast(notif.title, notif.message, notif.type, 6000)
  })

  // Listener para suspender áudio, microfone e estado quando a licença for revogada
  window.electronAPI.onLicenseRevoked(() => {
    console.warn('[HUD] Licença revogada ou suspensa. Interrompendo áudio e microfone.')
    micRecorder.stop()
    audioPlayer.stopAll()
    jasperSocket.interrupt()
    avatar?.setMood('neutral')
    isConnected = false
    updateStatusBadge('error', 'Licença Bloqueada')
  })

  // 8. Mic Recording Feedback & VAD Handlers -> Python STT via JasperSocket
  micRecorder.onAudioLevel = (level) => {
    currentMicLevel = level
  }

  micRecorder.onUtteranceWavBase64 = (wavBase64) => {
    if (jasperSocket.isConnected()) {
      updateStatusBadge('listening', `${getCurrentAgentName()} Transcrevendo...`)
      jasperSocket.sendAudioBase64(wavBase64)
    }
  }

  micRecorder.onBargeIn = () => {
    handleInterrupted()
    jasperSocket.interrupt()
  }

  micRecorder.onCallInactivityTimeout = () => {
    console.log('[Jasper] Modo Chamada finalizado por inatividade de 30 segundos.')
    showHudToast(
      'Chamada Encerrada',
      'Modo Chamada finalizado após 30 segundos de inatividade.',
      'info',
      4000
    )
    exitCallMode()
  }

  DOM.btnMic?.addEventListener('click', async () => {
    if (isCallMode) {
      await exitCallMode()
    } else {
      await enterCallMode(false)
    }
  })

  // 9. Initialize Wake Word Engine
  await wakeWordManager.init()
}

window.addEventListener('DOMContentLoaded', () => {
  init().catch(console.error)
})
