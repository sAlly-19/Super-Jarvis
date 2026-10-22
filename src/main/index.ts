import { app, BrowserWindow, net, protocol } from 'electron'
import { isAbsolute, relative, resolve } from 'path'
import { pathToFileURL } from 'url'
import { IPC_CHANNELS } from '@shared'
import { configStore } from './config/config-store'
import { createMainWindow, safeSend } from './windows/main-window'
import { registerIpcHandlers } from './ipc/register-ipc'
import { licenseManager } from './services/license-manager'
import { updateManager } from './services/update-manager'
import { pythonBackend } from './services/python-backend'

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

  // Listener para bloqueio imediato se a licença for revogada ou suspensa
  licenseManager.onRevoked((result) => {
    console.warn('[Main] Licença revogada ou suspensa. Bloqueando acesso do usuário:', result.message)
    safeSend(IPC_CHANNELS.LICENSE_REVOKED, {
      status: result.error || 'disabled',
      message: result.message || 'Sua licença foi desativada ou revogada pelo administrador.'
    })
  })

  registerIpcHandlers()
  createMainWindow()
  updateManager.initialize()

  // Auto-Start do microsserviço Python FastAPI (127.0.0.1:8765) de forma oculta
  pythonBackend.start().then((ready) => {
    if (ready) {
      safeSend(IPC_CHANNELS.GEMINI_STATUS, 'connected', `${configStore.getConfig().agentName || 'Jasper'} Online`)
    }
  }).catch((err) => {
    console.warn('[Main] Falha ao iniciar back-end Python automaticamente:', err)
  })

  // Verificação inicial do lease no boot da aplicação.
  setTimeout(() => {
    licenseManager.checkAccess24h().catch((err) => {
      console.warn('[Main] Erro na verificação inicial de licença:', err.message)
    })
  }, 3000)

  // Verificação periódica online; o lease assinado limita o modo offline a 72 horas.
  licenseCheckTimer = setInterval(() => {
    licenseManager.checkAccess24h().catch((err) => {
      console.warn('[Main] Erro no check periódico de licença:', err.message)
    })
  }, 60 * 60 * 1000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('before-quit', () => {
  pythonBackend.stop()
})

app.on('window-all-closed', () => {
  if (licenseCheckTimer) {
    clearInterval(licenseCheckTimer)
    licenseCheckTimer = null
  }
  pythonBackend.stop()
  updateManager.dispose()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
