import { spawn, type ChildProcess } from 'child_process'
import { existsSync, realpathSync, statSync } from 'fs'
import { isAbsolute, join, relative, resolve } from 'path'
import { app } from 'electron'
import type { JasperConfig } from '@shared'
import { encodeFrame, FrameDecoder } from './backend-framing'
import { verifyBackendIntegrity } from './backend-integrity'
import { DEFAULT_BACKEND_MANIFEST, type BackendManifest } from '../generated/backend-manifest'
import type { BackendEnvelope, BackendMessageType } from '@shared'
import { terminateProcessTree } from './process-tree'

export type BackendState =
  | 'stopped'
  | 'starting'
  | 'handshaking'
  | 'ready'
  | 'error'
  | 'restarting'

interface PendingRequest {
  resolve: (value: any) => void
  reject: (reason: any) => void
  timer: NodeJS.Timeout
  type: BackendMessageType
}

export interface PythonBackendOptions {
  isExecutionAllowed?: () => boolean
  manifest?: BackendManifest
  spawnFn?: (command: string, args: string[], options: any) => ChildProcess
  backoffBaseMs?: number
  shutdownGraceMs?: number
  terminateProcessTreeFn?: (pid: number) => Promise<void>
  applicationRoot?: string
}

export class PythonBackendManager {
  private process: ChildProcess | null = null
  private state: BackendState = 'stopped'
  private isShuttingDown = false
  private restartAttempts = 0
  private decoder = new FrameDecoder()
  private pendingRequests = new Map<string, PendingRequest>()
  private messageListeners = new Set<(envelope: BackendEnvelope) => void>()
  private healthyTimer: NodeJS.Timeout | null = null

  private isExecutionAllowed: () => boolean
  private readonly manifest: BackendManifest
  private readonly spawnFn: (command: string, args: string[], options: any) => ChildProcess
  private readonly backoffBaseMs: number
  private readonly shutdownGraceMs: number
  private readonly terminateProcessTreeFn: (pid: number) => Promise<void>
  private readonly applicationRoot?: string

  constructor(options: PythonBackendOptions = {}) {
    this.isExecutionAllowed = options.isExecutionAllowed || (() => true)
    this.manifest = options.manifest || DEFAULT_BACKEND_MANIFEST
    this.spawnFn = options.spawnFn || spawn
    this.backoffBaseMs = options.backoffBaseMs ?? 500
    this.shutdownGraceMs = options.shutdownGraceMs ?? 1500
    this.terminateProcessTreeFn = options.terminateProcessTreeFn || terminateProcessTree
    this.applicationRoot = options.applicationRoot
  }

  public setExecutionAllowed(fn: () => boolean): void {
    this.isExecutionAllowed = fn
  }

  public getState(): BackendState {
    return this.state
  }

  public async isHealthy(): Promise<boolean> {
    return this.state === 'ready'
  }

  public onMessage(listener: (envelope: BackendEnvelope) => void): () => void {
    this.messageListeners.add(listener)
    return () => {
      this.messageListeners.delete(listener)
    }
  }

  public getBackendDir(): string {
    const applicationRoot = this.applicationRoot ?? (app?.isPackaged ? process.resourcesPath : app.getAppPath())
    const backendDir = resolve(applicationRoot, 'jasper-backend')
    const expectedEntryPoint = app?.isPackaged
      ? resolve(backendDir, this.manifest.executable)
      : resolve(backendDir, 'main.py')

    this.assertPathInside(backendDir, expectedEntryPoint)
    if (!existsSync(expectedEntryPoint) || !statSync(expectedEntryPoint).isFile()) {
      throw new Error(`Backend entrypoint does not exist: ${expectedEntryPoint}`)
    }

    const canonicalRoot = realpathSync(backendDir)
    const canonicalEntryPoint = realpathSync(expectedEntryPoint)
    this.assertPathInside(canonicalRoot, canonicalEntryPoint)
    return canonicalRoot
  }

  public resolvePythonExecutable(backendDir: string): string {
    const configured = process.env.JASPER_PYTHON_EXECUTABLE?.trim()
    if (!configured) {
      throw new Error('JASPER_PYTHON_EXECUTABLE must point to an explicit Python executable in development.')
    }
    if (!isAbsolute(configured)) {
      throw new Error('JASPER_PYTHON_EXECUTABLE must be an absolute path.')
    }
    if (!existsSync(configured) || !statSync(configured).isFile()) {
      throw new Error(`JASPER_PYTHON_EXECUTABLE does not exist: ${configured}`)
    }
    return realpathSync(configured)
  }

  public async start(): Promise<void> {
    if (this.state === 'ready' || this.state === 'handshaking') {
      return
    }

    if (!this.isExecutionAllowed()) {
      throw new Error('Sidecar execution not allowed by license gate.')
    }

    this.isShuttingDown = false
    this.state = 'starting'
    this.decoder = new FrameDecoder()

    let command: string
    let args: string[]
    let cwd: string

    if (app?.isPackaged) {
      const root = this.getBackendDir()
      await verifyBackendIntegrity(root, this.manifest)
      command = resolve(root, this.manifest.executable)
      this.assertPathInside(root, command)
      args = []
      cwd = root
    } else {
      cwd = this.getBackendDir()
      command = this.resolvePythonExecutable(cwd)
      const mainScript = join(cwd, 'main.py')
      args = ['-u', mainScript]
    }

    const env: NodeJS.ProcessEnv = {
      SYSTEMROOT: process.env.SYSTEMROOT,
      SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR,
      ComSpec: process.env.ComSpec,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      APPDATA: process.env.APPDATA,
      LOCALAPPDATA: process.env.LOCALAPPDATA,
      USERPROFILE: process.env.USERPROFILE,
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8'
    }

    const child = this.spawnFn(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })

    this.process = child

    child.stdout?.on('data', (chunk: Buffer) => {
      let frames: BackendEnvelope[]
      try {
        frames = this.decoder.push(chunk)
      } catch (err) {
        console.error('[PythonBackend] Frame decoding error:', err)
        if (child.pid) void this.terminateProcessTreeFn(child.pid).catch(() => child.kill())
        return
      }

      for (const frame of frames) {
        this.handleIncomingFrame(frame)
      }
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      const raw = chunk.toString('utf-8')
      const redacted = raw.replace(/(gsk_|AIza)[a-zA-Z0-9_\-]{16,}/g, '$1[REDACTED]')
      console.error(`[PythonBackend] ${redacted.trim()}`)
    })

    child.on('exit', (code, signal) => {
      this.handleProcessExit(code, signal)
    })

    this.state = 'handshaking'

    try {
      const helloAck = await this.request<{ protocolVersion: number }>(
        'hello',
        { client: 'super-jarvis-electron', protocolVersion: 1 },
        10000
      )

      if (helloAck.protocolVersion !== 1) {
        throw new Error(`Incompatible sidecar protocol version: ${helloAck.protocolVersion}`)
      }

      this.state = 'ready'

      // Reset restart attempts after 5 seconds of stable operation
      if (this.healthyTimer) clearTimeout(this.healthyTimer)
      this.healthyTimer = setTimeout(() => {
        if (this.state === 'ready') {
          this.restartAttempts = 0
        }
      }, 5000)
    } catch (err) {
      this.state = 'error'
      if (child.pid) {
        await this.terminateProcessTreeFn(child.pid).catch(() => child.kill())
      } else {
        child.kill()
      }
      throw err
    }
  }

  public async stop(reason?: string): Promise<void> {
    this.isShuttingDown = true
    if (this.healthyTimer) clearTimeout(this.healthyTimer)
    const proc = this.process
    const wasReady = this.state === 'ready'
    this.process = null
    this.state = 'stopped'
    this.rejectAllPending(new Error(`Sidecar stopped: ${reason || 'normal shutdown'}`))

    if (!proc) return

    proc.stdout?.removeAllListeners('data')
    proc.stderr?.removeAllListeners('data')

    if (wasReady && proc.stdin?.writable) {
      const shutdownEnvelope: BackendEnvelope = {
        version: 1,
        id: `shutdown-${Date.now()}`,
        type: 'shutdown',
        payload: { reason: reason || 'app_stop' }
      }
      try {
        proc.stdin.write(encodeFrame(shutdownEnvelope))
      } catch {
        // Tree termination below remains authoritative.
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, this.shutdownGraceMs)
        proc.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
      })
    }

    if (proc.pid) {
      await this.terminateProcessTreeFn(proc.pid).catch((error) => {
        console.error(`[PythonBackend] Failed to terminate process tree ${proc.pid}:`, error)
        proc.kill()
      })
    } else {
      proc.kill()
    }
  }

  public async request<T = unknown>(
    type: BackendMessageType,
    payload: unknown,
    timeoutMs = 30000
  ): Promise<T> {
    if (this.state !== 'ready' && !(this.state === 'handshaking' && type === 'hello')) {
      throw new Error(`Sidecar not ready (current state: ${this.state})`)
    }

    if (!this.process || !this.process.stdin || !this.process.stdin.writable) {
      throw new Error('Sidecar process stdin is not writable')
    }

    const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const envelope: BackendEnvelope = {
      version: 1,
      id,
      type,
      payload
    }

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Sidecar request '${type}' timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      this.pendingRequests.set(id, { resolve, reject, timer, type })

      try {
        const frame = encodeFrame(envelope)
        this.process!.stdin!.write(frame)
      } catch (err) {
        clearTimeout(timer)
        this.pendingRequests.delete(id)
        reject(err)
      }
    })
  }

  public notify(type: BackendMessageType, payload: unknown): void {
    if (this.state !== 'ready' || !this.process || !this.process.stdin || !this.process.stdin.writable) {
      return
    }

    const id = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const envelope: BackendEnvelope = {
      version: 1,
      id,
      type,
      payload
    }

    try {
      const frame = encodeFrame(envelope)
      this.process.stdin.write(frame)
    } catch (err) {
      console.error(`[PythonBackend] Failed to send notification '${type}':`, err)
    }
  }

  public async syncConfig(cfg: JasperConfig): Promise<boolean> {
    if (this.state !== 'ready') return false
    try {
      await this.request('config', {
        agent_name: cfg.agentName,
        model: cfg.model,
        voice: cfg.voiceName,
        apiKey: cfg.apiKey,
        vision: cfg.enableScreenAwareness
      })
      return true
    } catch (err) {
      console.error('[PythonBackend] Config sync failed:', err)
      return false
    }
  }

  private handleIncomingFrame(frame: BackendEnvelope): void {
    // Notify all listeners
    for (const listener of this.messageListeners) {
      try {
        listener(frame)
      } catch (err) {
        console.error('[PythonBackend] Message listener error:', err)
      }
    }

    // Resolve correlation if replyTo is set
    if (frame.replyTo) {
      const pending = this.pendingRequests.get(frame.replyTo)
      if (pending) {
        clearTimeout(pending.timer)
        this.pendingRequests.delete(frame.replyTo)

        if (frame.type === 'error') {
          const errMsg = (frame.payload as any)?.message || 'Sidecar returned error'
          pending.reject(new Error(errMsg))
        } else {
          pending.resolve(frame.payload)
        }
      }
    }
  }

  private handleProcessExit(code: number | null, signal: string | null): void {
    this.process = null
    this.rejectAllPending(new Error(`Sidecar process exited (code=${code}, signal=${signal})`))

    if (this.isShuttingDown) {
      this.state = 'stopped'
      return
    }

    if (!this.isExecutionAllowed()) {
      this.state = 'stopped'
      return
    }

    if (this.restartAttempts < 3) {
      this.restartAttempts++
      this.state = 'restarting'
      const delay = Math.min(this.backoffBaseMs * Math.pow(2, this.restartAttempts - 1), 5000)
      console.warn(
        `[PythonBackend] Process exited unexpectedly. Attempting restart ${this.restartAttempts}/3 in ${delay}ms...`
      )
      setTimeout(() => {
        if (!this.isShuttingDown && this.isExecutionAllowed()) {
          this.start().catch((err) => {
            console.error(`[PythonBackend] Restart attempt ${this.restartAttempts} failed:`, err)
          })
        }
      }, delay)
    } else {
      this.state = 'error'
      console.error('[PythonBackend] Exceeded maximum restart attempts (3). Entering error state.')
    }
  }

  private rejectAllPending(reason: Error): void {
    for (const [id, req] of this.pendingRequests.entries()) {
      clearTimeout(req.timer)
      req.reject(reason)
    }
    this.pendingRequests.clear()
  }

  private assertPathInside(root: string, candidate: string): void {
    const pathFromRoot = relative(resolve(root), resolve(candidate))
    if (pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) {
      throw new Error(`Backend entrypoint must remain inside application resources: ${candidate}`)
    }
  }
}

export const pythonBackend = new PythonBackendManager()
