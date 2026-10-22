import { app, BrowserWindow, net, protocol } from 'electron'
import { isAbsolute, relative, resolve } from 'path'
import { pathToFileURL } from 'url'
import { IPC_CHANNELS } from '@shared'
import { configStore } from './config/config-store'
import { createMainWindow, safeSend } from './windows/main-window'
import { registerIpcHandlers } from './ipc/register-ipc'
import { updateManager } from './services/update-manager'
import { licenseGate } from './services/license-gate'

let licenseCheckTimer: NodeJS.Timeout | null = null

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }
])

function registerAppProtocol(): void {
  const rendererRoot = resolve(__dirname, '../renderer')
  protocol.handle('app', (request) => {
    try {
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
      const requestedPath = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '') || 'index.html'
      const targetPath = resolve(rendererRoot, requestedPath)
      const relativePath = relative(rendererRoot, targetPath)
      if (relativePath.startsWith('..') || relativePath.includes('\0') || isAbsolute(relativePath)) {
        return new Response('Forbidden', { status: 403 })
      }
      return net.fetch(pathToFileURL(targetPath).toString())
    } catch {
      return new Response('Bad request', { status: 400 })
    }
  })
}

app.whenReady().then(() => {
  registerAppProtocol()
  configStore.initialize()

  // Notificar o renderer em qualquer transição de estado da licença
  licenseGate.onStateChanged((snapshot) => {
    safeSend(IPC_CHANNELS.LICENSE_REVOKED, {
      status: snapshot.state,
      message: snapshot.message
    })
  })

  // 1. Registra IPC mínimo inicial
  registerIpcHandlers()

  // 2. Cria janela principal (inicia bloqueada se não houver licença)
  createMainWindow()
  updateManager.initialize()

  // 3. Inicializa máquina de estados LicenseGate (só inicia backend se estiver 'unlocked')
  licenseGate.initialize().then((snapshot) => {
    if (snapshot.state === 'unlocked') {
      safeSend(IPC_CHANNELS.GEMINI_STATUS, 'connected', `${configStore.getConfig().agentName || 'Jasper'} Online`)
    }
  }).catch((err) => {
    console.warn('[Main] Falha na inicialização do LicenseGate:', err)
  })

  // 4. Verificação periódica a cada 60 minutos (heartbeat / renovação antecipada do lease)
  licenseCheckTimer = setInterval(() => {
    licenseGate.refresh().catch((err) => {
      console.warn('[Main] Erro na verificação periódica de licença:', err)
    })
  }, 60 * 60 * 1000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('before-quit', () => {
  void licenseGate.shutdown().catch(() => {})
})

app.on('window-all-closed', () => {
  if (licenseCheckTimer) {
    clearInterval(licenseCheckTimer)
    licenseCheckTimer = null
  }
  void licenseGate.shutdown().catch(() => {})
  updateManager.dispose()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
