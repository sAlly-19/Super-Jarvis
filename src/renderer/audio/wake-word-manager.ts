import { ClapWakeEngine } from './clap-wake-engine'

export interface WakeWordManagerOptions {
  getIsWakeWordEnabled: () => boolean
  onWakeTriggered: () => void
}

/** The persisted enableWakeWord flag now controls local double-clap activation. */
export class WakeWordManager {
  private readonly engine: ClapWakeEngine
  private generation = 0
  private triggering = false
  private error = false

  constructor(private readonly options: WakeWordManagerOptions) {
    this.engine = new ClapWakeEngine(() => { void this.trigger() })
    const resume = (): void => { void this.engine.resumeIfSuspended().catch(() => {}) }
    window.addEventListener('click', resume)
    window.addEventListener('keydown', resume)
  }

  public getIsRunning(): boolean { return this.engine.getIsListening() }

  public updateUI(): void {
    const title = document.getElementById('wake-status-title')
    const description = document.getElementById('wake-status-desc')
    if (title) title.textContent = this.error ? 'Microfone indisponível' : this.getIsRunning()
      ? 'Aguardando duas palmas' : 'Detecção de palmas pausada'
    if (description) description.textContent = this.error
      ? 'Verifique a permissão e o dispositivo de áudio. O botão de microfone continua disponível.'
      : 'Bata duas palmas com intervalo de 0,2 a 0,8 segundo. Sem treinamento ou gravação persistida. Sons semelhantes também podem ativar; o botão de microfone continua disponível.'
  }

  private async trigger(): Promise<void> {
    if (this.triggering || !this.getIsRunning() || !this.options.getIsWakeWordEnabled()) return
    this.triggering = true
    const generation = this.generation
    await this.engine.stop()
    this.updateUI()
    if (generation === this.generation && this.options.getIsWakeWordEnabled()) this.options.onWakeTriggered()
    this.triggering = false
  }

  public async init(): Promise<void> {
    const generation = ++this.generation
    await this.engine.stop()
    this.error = false
    if (generation !== this.generation) return
    if (this.options.getIsWakeWordEnabled()) {
      try { await this.engine.start() } catch {
        this.error = true
        console.warn('[ClapActivation] Não foi possível abrir o microfone local.')
      }
    }
    this.updateUI()
  }

  public async pause(): Promise<void> {
    ++this.generation
    await this.engine.stop()
    this.updateUI()
  }

  public async resume(isMicRecording: boolean): Promise<void> {
    if (!this.options.getIsWakeWordEnabled() || isMicRecording || this.getIsRunning()) return
    await this.init()
  }
}
