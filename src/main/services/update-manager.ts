import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { IPC_CHANNELS, type UpdateState } from '@shared'
import { configStore } from '../config/config-store'
import { safeSend } from '../windows/main-window'

const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000
const execFileAsync = promisify(execFile)

export const OFFICIAL_RELEASE_OWNER = 'sAlly-19'
export const OFFICIAL_RELEASE_REPO = 'jasper-avatar-releases'
export const OFFICIAL_RELEASE_CHANNEL = 'latest'
export const OFFICIAL_RELEASE_FEED_URL = `https://github.com/${OFFICIAL_RELEASE_OWNER}/${OFFICIAL_RELEASE_REPO}/releases/${OFFICIAL_RELEASE_CHANNEL}/download`
export const APPROVED_WINDOWS_PUBLISHER = 'CN=Jasper Team, O=Jasper Team, L=Sao Paulo, C=BR'

type SignatureVerifier = (paths: string[]) => Promise<void>

interface AuthenticodeResult {
  Status?: string
  Subject?: string
  HasTimestamp?: boolean
}

function normalizePublisherSubject(subject: string): string {
  return subject
    .split(',')
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .join(',')
}

export async function verifyAuthenticodePublisher(
  paths: string[],
  expectedPublisher = APPROVED_WINDOWS_PUBLISHER
): Promise<void> {
  const normalizedExpected = normalizePublisherSubject(expectedPublisher)
  if (!normalizedExpected) throw new Error('O publicador Authenticode esperado não foi configurado.')
  if (process.platform !== 'win32') throw new Error('A verificação Authenticode requer Windows.')

  for (const targetPath of paths) {
    if (!targetPath || !fs.existsSync(targetPath)) {
      throw new Error(`Binário obrigatório não encontrado para verificação Authenticode: ${targetPath || '(vazio)'}`)
    }

    const encodedPath = Buffer.from(targetPath, 'utf8').toString('base64')
    const command = [
      "$ErrorActionPreference = 'Stop'",
      `$targetPath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}'))`,
      '$signature = Get-AuthenticodeSignature -FilePath $targetPath',
      '[pscustomobject]@{',
      '  Status = [string]$signature.Status',
      "  Subject = if ($signature.SignerCertificate) { [string]$signature.SignerCertificate.Subject } else { '' }",
      '  HasTimestamp = [bool]$signature.TimeStamperCertificate',
      '} | ConvertTo-Json -Compress'
    ].join('; ')
    const encodedCommand = Buffer.from(command, 'utf16le').toString('base64')
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCommand],
      { windowsHide: true, timeout: 15_000, maxBuffer: 1024 * 1024 }
    )
    const output = String(stdout).trim().split(/\r?\n/).filter(Boolean).at(-1) || '{}'
    const signature = JSON.parse(output) as AuthenticodeResult
    const normalizedSubject = normalizePublisherSubject(signature.Subject || '')

    if (signature.Status !== 'Valid') {
      throw new Error(`Assinatura Authenticode inválida para ${targetPath}: ${signature.Status || 'UnknownError'}`)
    }
    if (normalizedSubject !== normalizedExpected) {
      throw new Error(`Publicador Authenticode divergente para ${targetPath}.`)
    }
    if (!signature.HasTimestamp) {
      throw new Error(`Assinatura Authenticode sem timestamp para ${targetPath}.`)
    }
  }
}

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
  if (url.replace(/\/+$/, '') !== OFFICIAL_RELEASE_FEED_URL) {
    throw new Error('Updates are restricted to the official release feed, owner, repository and channel.')
  }
}

export function assertPackagedAppUpdateConfig(content: string): void {
  if (!content || typeof content !== 'string') {
    throw new Error('app-update.yml is empty or missing.')
  }
  const normalizedExpected = normalizePublisherSubject(APPROVED_WINDOWS_PUBLISHER)
  const publisherMatch = content.match(/publisherName:\s*(?:\r?\n\s*-\s*)?["']?([^"'\r\n]+)["']?/)
  const actualPublisher = publisherMatch ? normalizePublisherSubject(publisherMatch[1]) : ''
  if (actualPublisher !== normalizedExpected) {
    throw new Error(`app-update.yml publisherName mismatch: expected "${APPROVED_WINDOWS_PUBLISHER}".`)
  }
  const urlMatch = content.match(/url:\s*["']?([^"'\r\n]+)["']?/)
  if (!urlMatch) {
    throw new Error('app-update.yml is missing feed url.')
  }
  assertValidUpdateFeedUrl(urlMatch[1].trim())
}

class UpdateManager {
  private timer: NodeJS.Timeout | null = null
  private initialized = false
  private downloadedUpdatePath: string | null = null
  private signatureVerifier: SignatureVerifier = verifyAuthenticodePublisher
  private state: UpdateState = {
    phase: 'idle',
    currentVersion: typeof app !== 'undefined' && app?.getVersion ? app.getVersion() : '1.0.2',
    message: 'Nenhuma verificação realizada.',
    portable: Boolean(process.env.PORTABLE_EXECUTABLE_FILE)
  }

  public initialize(runtimeOverrides?: Record<string, unknown>): void {
    if (runtimeOverrides && Object.keys(runtimeOverrides).length > 0) {
      throw new Error('Runtime update feed overrides are forbidden in commercial builds.')
    }
    const envOverride =
      process.env.JASPER_UPDATE_FEED_URL ||
      process.env.ELECTRON_UPDATER_FEED_URL ||
      process.env.JASPER_UPDATE_CHANNEL
    if (envOverride && typeof app !== 'undefined' && app?.isPackaged) {
      throw new Error('Environment update feed overrides are forbidden in commercial builds.')
    }
    if (this.initialized) return
    this.initialized = true

    assertValidUpdateFeedUrl(OFFICIAL_RELEASE_FEED_URL)
    ;(autoUpdater as { channel?: string }).channel = OFFICIAL_RELEASE_CHANNEL
    if (typeof autoUpdater.setFeedURL === 'function') {
      autoUpdater.setFeedURL({
        provider: 'generic',
        url: OFFICIAL_RELEASE_FEED_URL,
        channel: OFFICIAL_RELEASE_CHANNEL
      })
    }
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false

    autoUpdater.on('checking-for-update', () => this.updateState('checking', 'Verificando atualizações...'))
    autoUpdater.on('update-available', (info: { version: string }) => {
      this.downloadedUpdatePath = null
      this.updateState('available', `Versão ${info.version} disponível.`, { availableVersion: info.version })
    })
    autoUpdater.on('update-not-available', () => this.updateState('not-available', 'O Jasper está atualizado.'))
    autoUpdater.on('download-progress', (progress: { percent: number }) => {
      this.updateState('downloading', `Baixando atualização: ${Math.round(progress.percent)}%.`, {
        progressPercent: progress.percent
      })
    })
    autoUpdater.on('update-downloaded', (info: { version: string; downloadedFile?: string }) => {
      this.downloadedUpdatePath = info.downloadedFile || null
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
    if (!this.downloadedUpdatePath) {
      this.updateState('error', 'O pacote de atualização baixado não pôde ser localizado para validação.')
      return { success: false, message: 'O pacote de atualização não pôde ser validado.' }
    }
    try {
      const targets = [process.execPath]
      const sidecarPath = typeof process.resourcesPath === 'string'
        ? path.join(process.resourcesPath, 'jasper-backend', 'jasper-backend.exe')
        : ''
      if (sidecarPath && fs.existsSync(sidecarPath)) targets.push(sidecarPath)
      targets.push(this.downloadedUpdatePath)
      await this.signatureVerifier([...new Set(targets)])
    } catch (error) {
      console.warn('[UpdateManager] Atualização rejeitada por assinatura inválida:', error)
      this.updateState('error', 'A assinatura ou o publicador da atualização não corresponde ao produto oficial.')
      return { success: false, message: 'A assinatura ou o publicador da atualização é inválido.' }
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
