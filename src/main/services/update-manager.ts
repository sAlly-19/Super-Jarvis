import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { IPC_CHANNELS, type UpdateState } from '@shared'
import { configStore } from '../config/config-store'
import { safeSend } from '../windows/main-window'
import { securityBroker } from './security-broker'

const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000

class UpdateManager {
  private timer: NodeJS.Timeout | null = null
  private initialized = false
  private state: UpdateState = {
    phase: 'idle',
    currentVersion: app.getVersion(),
    message: 'Nenhuma verificação realizada.',
    portable: Boolean(process.env.PORTABLE_EXECUTABLE_FILE)
  }

  public initialize(): void {
    if (this.initialized) return
    this.initialized = true
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false

    autoUpdater.on('checking-for-update', () => this.updateState('checking', 'Verificando atualizações...'))
    autoUpdater.on('update-available', (info: { version: string }) => {
      this.updateState('available', `Versão ${info.version} disponível.`, { availableVersion: info.version })
    })
    autoUpdater.on('update-not-available', () => this.updateState('not-available', 'O Jasper está atualizado.'))
    autoUpdater.on('download-progress', (progress: { percent: number }) => {
      this.updateState('downloading', `Baixando atualização: ${Math.round(progress.percent)}%.`, {
        progressPercent: progress.percent
      })
    })
    autoUpdater.on('update-downloaded', (info: { version: string }) => {
      this.updateState('downloaded', `Versão ${info.version} pronta para instalar.`, { availableVersion: info.version })
    })
    autoUpdater.on('error', (error: unknown) => this.updateState('error', this.describeError(error)))

    this.refreshSchedule()
    if (configStore.getConfig().checkUpdatesDaily) {
      setTimeout(() => void this.check(false), 15_000)
    }
  }

  public refreshSchedule(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (configStore.getConfig().checkUpdatesDaily) {
      this.timer = setInterval(() => void this.check(false), DAILY_INTERVAL_MS)
    }
  }

  public getState(): UpdateState {
    return { ...this.state }
  }

  public async check(manual = true): Promise<UpdateState> {
    if (!app.isPackaged) {
      this.updateState('not-available', 'A verificação de atualizações funciona na versão instalada.')
      return this.getState()
    }
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      this.updateState('error', this.describeError(error))
    }
    if (manual) safeSend(IPC_CHANNELS.UPDATE_STATUS, this.getState())
    return this.getState()
  }

  public async download(): Promise<UpdateState> {
    if (this.state.portable) {
      this.updateState('error', 'A versão portátil deve ser atualizada baixando o novo pacote no site oficial.')
      return this.getState()
    }
    if (this.state.phase !== 'available') return this.getState()
    try {
      await autoUpdater.downloadUpdate()
    } catch (error) {
      this.updateState('error', this.describeError(error))
    }
    return this.getState()
  }

  public async install(): Promise<{ success: boolean; message: string }> {
    if (this.state.phase !== 'downloaded') {
      return { success: false, message: 'Nenhuma atualização está pronta para instalar.' }
    }
    const approved = await securityBroker.confirmOperation({
      title: 'Instalar atualização',
      message: 'Confirma a instalação da atualização?',
      detail: `O Jasper será fechado para instalar a versão ${this.state.availableVersion || 'mais recente'}.`,
      confirmLabel: 'Instalar e reiniciar',
      risk: 'mandatory'
    })
    if (!approved) return { success: false, message: 'Instalação cancelada pelo usuário.' }
    setImmediate(() => autoUpdater.quitAndInstall(false, true))
    return { success: true, message: 'A instalação será iniciada.' }
  }

  public dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private updateState(phase: UpdateState['phase'], message: string, extra: Partial<UpdateState> = {}): void {
    this.state = { ...this.state, ...extra, phase, message }
    safeSend(IPC_CHANNELS.UPDATE_STATUS, this.getState())
  }

  private describeError(error: unknown): string {
    const detail = error instanceof Error ? error.message : String(error)
    console.warn('[UpdateManager] Falha na atualização:', detail)
    return 'Não foi possível verificar ou baixar a atualização.'
  }
}

export const updateManager = new UpdateManager()
