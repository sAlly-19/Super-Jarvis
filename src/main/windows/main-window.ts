import { app, BrowserWindow, shell, screen, session } from 'electron'
import { join } from 'path'
import fs from 'fs'
import { IPC_CHANNELS } from '@shared'
import { isTrustedRendererUrl } from '../utils/trusted-renderer'

let mainWindow: BrowserWindow | null = null
let isPipMode = false
let normalBounds = { x: 100, y: 100, width: 1100, height: 860 }
const LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

function redactLogMessage(message: string): string {
  return message
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_JWT]')
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED_GOOGLE_KEY]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, '[REDACTED_AWS_ACCESS_KEY]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(sk-|ACCESS_TOKEN[=: ]+)[A-Za-z0-9._-]{12,}/gi, '$1[REDACTED]')
    .replace(/\b(password|secret|token|api[_-]?key)\s*[:=]\s*(["'])[^"'\r\n]+\2/gi, '$1: "[REDACTED]"')
}

function removeExpiredRuntimeLogs(logDirectory: string): void {
  const cutoff = Date.now() - LOG_RETENTION_MS
  try {
    for (const entry of fs.readdirSync(logDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !/^jasper-runtime-\d{4}-\d{2}-\d{2}\.log$/.test(entry.name)) continue
      const filePath = join(logDirectory, entry.name)
      if (fs.statSync(filePath).mtimeMs < cutoff) fs.unlinkSync(filePath)
    }
  } catch (error) {
    console.warn('[RuntimeLog] Não foi possível aplicar a retenção de 30 dias:', error)
  }
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function safeSend(channel: string, ...args: any[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

export function createMainWindow(): BrowserWindow {
  const isDevelopment = Boolean(process.env['ELECTRON_RENDERER_URL'])
  const developmentUrl = process.env['ELECTRON_RENDERER_URL']
  const windowIconPath = isDevelopment
    ? join(app.getAppPath(), 'assets', 'icon.ico')
    : join(process.resourcesPath, 'icon.ico')
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 860,
    minWidth: 800,
    minHeight: 650,
    show: false,
    frame: false, // Frameless HUD / Jarvis design
    titleBarStyle: 'hidden',
    backgroundColor: '#030303',
    icon: windowIconPath,
    webPreferences: {
      preload: fs.existsSync(join(__dirname, '../preload/index.mjs'))
        ? join(__dirname, '../preload/index.mjs')
        : join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: isDevelopment
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Block unauthorized external or scheme navigation
  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const parsed = new URL(details.url)
      if (parsed.protocol === 'https:' && parsed.hostname === 'aistudio.google.com') {
        shell.openExternal(details.url)
      }
    } catch {}
    return { action: 'deny' }
  })

  // Prevent renderer from navigating away from the app
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!isTrustedRendererUrl(navigationUrl, developmentUrl)) event.preventDefault()
  })

  // Auto-grant media (microphone/audio) permissions to the renderer window
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const isMainRenderer = mainWindow !== null && !mainWindow.isDestroyed() &&
      webContents === mainWindow.webContents && isTrustedRendererUrl(webContents.getURL(), developmentUrl)
    if (isMainRenderer && (permission === 'media' || (permission as string) === 'microphone' || (permission as string) === 'speech')) {
      return callback(true)
    }
    callback(false)
  })
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    const isMainRenderer = mainWindow !== null && !mainWindow.isDestroyed() &&
      webContents === mainWindow.webContents && isTrustedRendererUrl(webContents.getURL(), developmentUrl)
    return isMainRenderer && (permission === 'media' || (permission as string) === 'microphone' || (permission as string) === 'speech')
  })

  // Forward renderer console logs to terminal and disk log file
  const runtimeLogDirectory = app.getPath('userData')
  fs.mkdirSync(runtimeLogDirectory, { recursive: true })
  removeExpiredRuntimeLogs(runtimeLogDirectory)
  const runtimeLogPath = join(runtimeLogDirectory, `jasper-runtime-${new Date().toISOString().slice(0, 10)}.log`)
  fs.appendFileSync(runtimeLogPath, `[${new Date().toISOString()}] [Main] Runtime iniciado.\n`)
  mainWindow.webContents.on('console-message', (event, legacyLevel, legacyMessage, legacyLine, legacySourceId) => {
    const details = event as unknown as {
      level?: string
      message?: string
      lineNumber?: number
      sourceId?: string
    }
    const level = details.level ?? String(legacyLevel ?? 'info')
    const message = details.message ?? legacyMessage ?? ''
    const line = details.lineNumber ?? legacyLine ?? 0
    const sourceId = details.sourceId ?? legacySourceId ?? ''
    const source = sourceId ? sourceId.split(/[\\/]/).pop() : 'renderer'
    const formatted = redactLogMessage(`[Renderer] [${level}] ${message} (${source}:${line})`)
    console.log(formatted)
    try {
      fs.appendFileSync(runtimeLogPath, `[${new Date().toISOString()}] ${formatted}\n`)
    } catch {}
  })

  if (!isDevelopment) {
    mainWindow.webContents.on('devtools-opened', () => mainWindow?.webContents.closeDevTools())
  }

  // Press F12 to toggle Fullscreen; DevTools are available only during development.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown') {
      if (input.key === 'F12') {
        event.preventDefault()
        toggleFullScreenMode()
      } else if (isDevelopment && input.control && input.shift && input.key.toLowerCase() === 'i') {
        mainWindow?.webContents.toggleDevTools()
      } else if (!isDevelopment && input.control && input.shift && input.key.toLowerCase() === 'i') {
        event.preventDefault()
      }
    }
  })

  // Synchronize fullscreen events to renderer
  mainWindow.on('enter-full-screen', () => {
    safeSend(IPC_CHANNELS.WINDOW_FULLSCREEN_CHANGE, true)
  })
  mainWindow.on('leave-full-screen', () => {
    safeSend(IPC_CHANNELS.WINDOW_FULLSCREEN_CHANGE, false)
  })

  // Load renderer via Vite HMR or the privileged production protocol.
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadURL('app://jasper/index.html')
  }

  // Automatic screenshot capture for visual verification when requested via CLI (development only)
  if (!app.isPackaged && (process.argv.includes('--capture-screenshot') || process.argv.includes('--capture-showcase'))) {
    setTimeout(async () => {
      try {
        if (!mainWindow || mainWindow.isDestroyed()) return

        const outDir = process.env.SCREENSHOT_OUT_DIR || join(app.getAppPath(), 'assets', 'screenshots')
        if (!fs.existsSync(outDir)) {
          fs.mkdirSync(outDir, { recursive: true })
        }

        if (process.argv.includes('--capture-showcase')) {
          mainWindow.setSize(1440, 900)
          await new Promise((r) => setTimeout(r, 400))
          console.log('[Capture] Iniciando captura da suíte de showcase...')

          // 1. Avatar HUD Principal
          const img1 = await mainWindow.webContents.capturePage()
          fs.writeFileSync(join(outDir, '01_avatar_hud.png'), img1.toPNG())
          console.log('[Capture] 01_avatar_hud.png salvo')

          // Abrir configurações
          await mainWindow.webContents.executeJavaScript(`{
            const licenseModal = document.getElementById('modal-license-activation');
            if (licenseModal) {
              licenseModal.classList.add('hidden');
              licenseModal.style.display = 'none';
            }
            document.getElementById('btn-settings')?.click();
          }`)
          await new Promise((r) => setTimeout(r, 600))

          // 2. Aba Identidade & Visual (Dashboard Principal)
          const imgIdentity = await mainWindow.webContents.capturePage()
          fs.writeFileSync(join(outDir, '00_identity_dashboard.png'), imgIdentity.toPNG())
          console.log('[Capture] 00_identity_dashboard.png salvo')

          // 2b. Aba Autonomia (17 módulos de autonomia)
          await mainWindow.webContents.executeJavaScript(`{
            const btnAutonomy = document.querySelector('button[data-tab="tab-autonomy"]');
            if (btnAutonomy) btnAutonomy.click();
          }`)
          await new Promise((r) => setTimeout(r, 600))
          const img2 = await mainWindow.webContents.capturePage()
          fs.writeFileSync(join(outDir, '02_autonomy_modules.png'), img2.toPNG())
          console.log('[Capture] 02_autonomy_modules.png salvo')

          // 3. Aba IA & Voz (Gemini Live & VAD)
          await mainWindow.webContents.executeJavaScript(`{
            const btnAI = document.querySelector('button[data-tab="tab-ai"]');
            if (btnAI) btnAI.click();
          }`)
          await new Promise((r) => setTimeout(r, 600))
          const img3 = await mainWindow.webContents.capturePage()
          fs.writeFileSync(join(outDir, '03_ai_config.png'), img3.toPNG())
          console.log('[Capture] 03_ai_config.png salvo')

          // 4. Aba Ferramentas & Políticas Zero-Trust
          await mainWindow.webContents.executeJavaScript(`{
            const btnTools = document.querySelector('button[data-tab="tab-tools"]');
            if (btnTools) btnTools.click();
          }`)
          await new Promise((r) => setTimeout(r, 600))
          const img4 = await mainWindow.webContents.capturePage()
          fs.writeFileSync(join(outDir, '04_tools_system.png'), img4.toPNG())
          console.log('[Capture] 04_tools_system.png salvo')

          console.log('[Capture] Todas as capturas de showcase foram salvas com sucesso em', outDir)
          app.quit()
          return
        }

        const image = await mainWindow.webContents.capturePage()
        const outPath = join(outDir, 'app_screenshot.png')
        fs.writeFileSync(outPath, image.toPNG())
        console.log('[Capture] Screenshot saved successfully to', outPath)
        app.quit()
      } catch (err) {
        console.error('[Capture] Error capturing page screenshot:', err)
        app.quit()
      }
    }, 6500)
  }

  return mainWindow
}

export function togglePipMode(): boolean {
  if (!mainWindow) return false

  isPipMode = !isPipMode
  if (isPipMode) {
    normalBounds = mainWindow.getBounds()
    mainWindow.setAlwaysOnTop(true, 'floating')
    mainWindow.setMinimumSize(280, 360)
    const primaryDisplay = screen.getPrimaryDisplay()
    const { workArea } = primaryDisplay
    const pipWidth = 320
    const pipHeight = 440
    const pipX = workArea.x + workArea.width - pipWidth - 24
    const pipY = workArea.y + workArea.height - pipHeight - 24
    mainWindow.setBounds({ x: pipX, y: pipY, width: pipWidth, height: pipHeight }, true)
  } else {
    mainWindow.setAlwaysOnTop(false)
    mainWindow.setMinimumSize(800, 650)
    mainWindow.setBounds(normalBounds, true)
  }

  safeSend(IPC_CHANNELS.WINDOW_PIP_CHANGE, isPipMode)
  return isPipMode
}

export function minimizeWindow(): void {
  mainWindow?.minimize()
}

export function maximizeWindow(): void {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
}

export function toggleFullScreenMode(): boolean {
  if (!mainWindow) return false

  const nextState = !mainWindow.isFullScreen()
  mainWindow.setFullScreen(nextState)
  safeSend(IPC_CHANNELS.WINDOW_FULLSCREEN_CHANGE, nextState)
  return nextState
}

export function closeWindow(): void {
  mainWindow?.close()
}

