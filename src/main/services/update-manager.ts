import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { IPC_CHANNELS, type UpdateState } from '@shared'
import { configStore } from '../config/config-store'
import { safeSend } from '../windows/main-window'

const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000

export const OFFICIAL_RELEASE_FEED_URL = 'https://github.com/sAlly-19/jasper-avatar-releases/releases/latest/download'

export function assertValidUpdateFeedUrl(url: string): void {
  if (!url || typeof url !== 'string') {
    throw new Error('Update feed URL must be a non-empty string')
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Invalid update feed URL: ${url}`)
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`Insecure update feed protocol: expected HTTPS, got ${parsed.protocol}`)
  }

  const allowedHosts = ['github.com', 'objects.githubusercontent.com']
  if (!allowedHosts.includes(parsed.hostname.toLowerCase())) {
    throw new Error(`Untrusted release origin: ${parsed.hostname}. Updates only allowed from official release origin.`)
  }
}

class UpdateManager {
  private timer: NodeJS.Timeout | null = null
  private initialized = false
  private state: UpdateState = {
    phase: 'idle',
    currentVersion: typeof app !== 'undefined' && app?.getVersion ? app.getVersion() : '1.0.2',
    message: 'Nenhuma verificação realizada.',
    portable: Boolean(process.env.PORTABLE_EXECUTABLE_FILE)
  }

  public initialize(): void {
    if (this.initialized) return
    this.initialized = true

    assertValidUpdateFeedUrl(OFFICIAL_RELEASE_FEED_URL)
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
    if (typeof app !== 'undefined' && !app.isPackaged) {
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
      this.updateState('error', 'A versão portátil não suporta atualizações automáticas.')
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
