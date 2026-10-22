import { SpeechCommandsWakeWord } from './speech-commands'
import { updateStatusBadge } from '../ui/status-badge'

export interface WakeWordManagerOptions {
  getAgentName: () => string
  getIsWakeWordEnabled: () => boolean
  onWakeTriggered: () => void
  onTrainerUIUpdate?: () => void
}

export class WakeWordManager {
  private engine: SpeechCommandsWakeWord | null = null
  private isRunning = false
  private isTriggering = false
  private options: WakeWordManagerOptions

  constructor(options: WakeWordManagerOptions) {
    this.options = options
    this.setupAutoplayFix()
  }

  private setupAutoplayFix(): void {
    window.addEventListener('click', () => this.engine?.resumeIfSuspended())
    window.addEventListener('keydown', () => this.engine?.resumeIfSuspended())
  }

  public getEngine(): SpeechCommandsWakeWord | null {
    return this.engine
  }

  public getIsRunning(): boolean {
    return this.isRunning
  }

  public syncRunningState(): void {
    if (this.engine) {
      this.isRunning = this.engine.getIsListening()
    }
  }

  public getCalibrationStatus(): { isCalibrated: boolean; isLegacy: boolean; mode: 'tensorflow' | 'disabled' } {
    if (!this.options.getIsWakeWordEnabled()) {
      return { isCalibrated: false, isLegacy: false, mode: 'disabled' }
    }
    const isCalibrated = this.engine?.isCustomModelActive() || false
    const isLegacy = this.engine?.isLegacyModel() || false
    return {
      isCalibrated,
      isLegacy,
      mode: isCalibrated ? 'tensorflow' : 'disabled'
    }
  }

  public async init(forTraining = false): Promise<void> {
    await this.stopAll()

    if (!forTraining && !this.options.getIsWakeWordEnabled()) {
      console.log('[WakeWord] Detecção de ativação por voz desativada pelo usuário.')
      this.options.onTrainerUIUpdate?.()
      return
    }

    const agentName = this.options.getAgentName()
    try {
      console.log('[WakeWord] Inicializando TensorFlow.js.')

      this.engine = new SpeechCommandsWakeWord({
        probabilityThreshold: 0.90,
        suppressionTimeMillis: 2500,
        agentName
      })

      await this.engine.load(agentName)

      // Bind detection exclusively via TensorFlow
      this.engine.onDetect = (_word: string, score: number) => {
        if (this.isTriggering) return
        this.isTriggering = true
        console.log(`[WakeWord] Ativação detectada com confiança de ${(score * 100).toFixed(1)}%.`)
        try {
          this.engine?.stop()
        } catch {}
        this.isRunning = false
        updateStatusBadge('listening', `${agentName} Ouvindo...`)
        setTimeout(() => {
          this.isTriggering = false
          this.options.onWakeTriggered()
        }, 120)
      }

      this.engine.onError = (err: any) => {
        console.warn('[WakeWord] Erro no Speech Commands TensorFlow:', err)
      }

      if (!forTraining && this.engine.isCustomModelActive()) {
        await this.engine.start()
        this.isRunning = true
        console.log('[WakeWord] TensorFlow.js Speech Commands ativo com 3 classes.')
      } else {
        if (this.engine.isLegacyModel()) {
          console.warn('[WakeWord] Modelo legado de 2 classes detectado. Escuta pausada até nova calibração.')
        } else {
          console.log('[WakeWord] TensorFlow pronto; modelo de voz pendente de calibração.')
        }
        this.isRunning = false
      }
    } catch (err: any) {
      console.warn('[WakeWord] Falha ao inicializar TensorFlow:', err?.message || err)
      this.isRunning = false
    }

    this.options.onTrainerUIUpdate?.()
  }

  private async stopAll(): Promise<void> {
    if (this.engine) {
      try {
        await this.engine.dispose()
      } catch {}
      this.engine = null
    }
    this.isRunning = false
  }

  public async pause(): Promise<void> {
    if (this.engine && this.isRunning) {
      try {
        await this.engine.stop()
      } catch (e) {
        console.warn('[WakeWord] Erro ao pausar motor TensorFlow:', e)
      }
      this.isRunning = false
    }
  }

  public async resume(isMicRecording: boolean): Promise<void> {
    if (!this.options.getIsWakeWordEnabled() || isMicRecording) return
    this.isTriggering = false

    if (this.engine && this.engine.isCustomModelActive() && !this.isRunning) {
      try {
        await this.engine.start()
        this.isRunning = true
      } catch (e) {
        console.warn('[WakeWord] Erro ao retomar motor TensorFlow:', e)
      }
    } else if (!this.engine) {
      await this.init()
    }
  }
}
