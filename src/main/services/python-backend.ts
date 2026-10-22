import { spawn, execFileSync, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import { app } from 'electron'
import type { JasperConfig } from '@shared'
import { configStore } from '../config/config-store'

export class PythonBackendManager {
  private process: ChildProcess | null = null
  private isShuttingDown = false
  public readonly host = '127.0.0.1'
  public readonly port = 8765

  public getBackendDir(): string {
    const dirName = typeof __dirname !== 'undefined' ? __dirname : process.cwd()
    const candidates = [
      resolve(process.cwd(), 'jasper-backend'),
      resolve(dirName, '../../jasper-backend'),
      resolve(dirName, '../../../jasper-backend'),
      app?.isPackaged ? join(process.resourcesPath, 'jasper-backend') : ''
    ].filter(Boolean)

    for (const dir of candidates) {
      if (existsSync(join(dir, 'main.py'))) {
        return dir
      }
    }
    return resolve(process.cwd(), 'jasper-backend')
  }

  public resolvePythonExecutable(backendDir: string): string {
    const venvPythonWin = join(backendDir, 'venv', 'Scripts', 'python.exe')
    if (existsSync(venvPythonWin)) {
      return venvPythonWin
    }
    const venvDotWin = join(backendDir, '.venv', 'Scripts', 'python.exe')
    if (existsSync(venvDotWin)) {
      return venvDotWin
    }
    const venvPosix = join(backendDir, 'venv', 'bin', 'python')
    if (existsSync(venvPosix)) {
      return venvPosix
    }
    return 'python'
  }

  public async isHealthy(): Promise<boolean> {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 1200)
      const res = await fetch(`http://${this.host}:${this.port}/health`, {
        signal: controller.signal
      })
      clearTimeout(timer)
      return res.ok
    } catch {
      return false
    }
  }

  public async start(): Promise<boolean> {
    this.isShuttingDown = false

    // If already running and healthy on port 8765, just sync config
    if (await this.isHealthy()) {
      console.log('[PythonBackend] Servidor já ativo em 127.0.0.1:8765. Sincronizando configuração...')
      await this.syncConfig(configStore.getConfig())
      return true
    }

    const backendDir = this.getBackendDir()
    const mainScript = join(backendDir, 'main.py')
    if (!existsSync(mainScript)) {
      console.error(`[PythonBackend] Arquivo main.py não encontrado em: ${mainScript}`)
      return false
    }

    const pythonExe = this.resolvePythonExecutable(backendDir)
    const cfg = configStore.getConfig()

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUNBUFFERED: '1',
      JASPER_AGENT_NAME: cfg.agentName || 'Jasper',
      JASPER_MODEL: cfg.model || 'gemini/gemini-2.5-flash',
      JASPER_VOICE: cfg.voiceName || 'pt-BR-AntonioNeural'
    }

    if (cfg.apiKey) {
      if (cfg.apiKey.startsWith('gsk_')) {
        env.GROQ_API_KEY = cfg.apiKey
      } else {
        env.GEMINI_API_KEY = cfg.apiKey
        env.GOOGLE_API_KEY = cfg.apiKey
      }
    }

    console.log(`[PythonBackend] Iniciando servidor Python (${pythonExe}) em ${backendDir}...`)

    try {
      this.process = spawn(pythonExe, [mainScript], {
        cwd: backendDir,
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })

      this.process.stdout?.on('data', (chunk: Buffer) => {
        const msg = chunk.toString('utf-8').trim()
        if (msg) console.log(`[PythonBackend] ${msg}`)
      })

      this.process.stderr?.on('data', (chunk: Buffer) => {
        const msg = chunk.toString('utf-8').trim()
        if (msg) console.log(`[PythonBackend] ${msg}`)
      })

      this.process.on('exit', (code, signal) => {
        console.log(`[PythonBackend] Processo encerrado (code=${code}, signal=${signal}).`)
        this.process = null
      })

      this.process.on('error', (err) => {
        console.error('[PythonBackend] Erro ao iniciar processo Python:', err)
      })

      const ready = await this.waitForReady(25000)
      if (ready) {
        await this.syncConfig(cfg)
      }
      return ready
    } catch (err) {
      console.error('[PythonBackend] Exceção ao criar subprocesso Python:', err)
      return false
    }
  }

  public async waitForReady(timeoutMs = 25000): Promise<boolean> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (this.isShuttingDown) return false
      if (await this.isHealthy()) {
        console.log('[PythonBackend] Microsserviço FastAPI pronto em ws://127.0.0.1:8765/ws/jasper')
        return true
      }
      await new Promise((r) => setTimeout(r, 250))
    }
    console.warn('[PythonBackend] Timeout aguardando inicialização na porta 8765.')
    return false
  }

  public async syncConfig(cfg: Partial<JasperConfig>): Promise<void> {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 1500)
      await fetch(`http://${this.host}:${this.port}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_name: cfg.agentName,
          model: cfg.model,
          api_key: cfg.apiKey,
          voice: cfg.voiceName,
          vision: cfg.enableScreenAwareness
        }),
        signal: controller.signal
      })
      clearTimeout(timer)
    } catch {
      // WebSocket config sync will also update session once connected
    }
  }

  public stop(): void {
    this.isShuttingDown = true
    if (!this.process) return

    const pid = this.process.pid
    console.log(`[PythonBackend] Encerrando processo Python (PID: ${pid})...`)

    try {
      if (process.platform === 'win32' && pid) {
        execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore'
        })
      } else {
        this.process.kill('SIGTERM')
      }
    } catch {
      try {
        this.process.kill()
      } catch {}
    } finally {
      this.process = null
    }
  }
}

export const pythonBackend = new PythonBackendManager()

