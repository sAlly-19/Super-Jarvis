export interface JasperBackendConfig {
  agentName?: string
  model?: string
  apiKey?: string
  voiceName?: string
  vision?: boolean
}

export interface JasperToolExecutionEvent {
  tool: string
  args: Record<string, unknown>
}

export interface JasperMemoryFact {
  fact: string
}

export class JasperSocketService {
  private ws: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private connected = false
  private shouldReconnect = true
  private visionEnabled = false
  private lastConfig: JasperBackendConfig = {}
  public readonly url: string

  // Event callbacks
  public onStatusChange: ((status: string, message?: string) => void) | null = null
  public onResponseText: ((text: string) => void) | null = null
  public onUserTranscript: ((text: string) => void) | null = null
  public onAudioBase64: ((audioBase64: string, format?: string) => void) | null = null
  public onToolExecution: ((event: JasperToolExecutionEvent) => void) | null = null
  public onTurnComplete: (() => void) | null = null
  public onInterrupted: (() => void) | null = null
  public onError: ((message: string) => void) | null = null
  public onMemoryData: ((facts: JasperMemoryFact[]) => void) | null = null

  constructor(url = 'ws://127.0.0.1:8765/ws/jasper') {
    this.url = url
  }

  public isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN
  }

  public getVisionEnabled(): boolean {
    return this.visionEnabled
  }

  public setVisionEnabled(enabled: boolean): void {
    this.visionEnabled = enabled
    this.lastConfig.vision = enabled
    this.sendRaw({
      type: 'config',
      vision: enabled
    })
  }

  public connect(initialConfig?: JasperBackendConfig): void {
    this.shouldReconnect = true
    if (initialConfig) {
      this.lastConfig = { ...this.lastConfig, ...initialConfig }
      if (typeof initialConfig.vision === 'boolean') {
        this.visionEnabled = initialConfig.vision
      }
    }

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      if (this.ws.readyState === WebSocket.OPEN && initialConfig) {
        this.syncConfig(this.lastConfig)
      }
      return
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    try {
      this.onStatusChange?.('connecting', 'Conectando ao Jasper Backend...')
      this.ws = new WebSocket(this.url)

      this.ws.onopen = () => {
        this.connected = true
        this.onStatusChange?.('connected', `${this.lastConfig.agentName || 'Jasper'} Online`)
        if (Object.keys(this.lastConfig).length > 0) {
          this.syncConfig(this.lastConfig)
        }
        this.startPing()
      }

      this.ws.onmessage = (event: MessageEvent) => {
        this.handleMessage(String(event.data || ''))
      }

      this.ws.onerror = () => {
        // Reconnection is handled in onclose
      }

      this.ws.onclose = () => {
        const wasConnected = this.connected
        this.connected = false
        this.stopPing()
        this.ws = null

        if (wasConnected) {
          this.onStatusChange?.('disconnected', 'Reconectando ao Back-End...')
        }

        if (this.shouldReconnect) {
          this.reconnectTimer = setTimeout(() => {
            this.connect()
          }, 1800)
        }
      }
    } catch {
      if (this.shouldReconnect) {
        this.reconnectTimer = setTimeout(() => {
          this.connect()
        }, 2000)
      }
    }
  }

  public disconnect(): void {
    this.shouldReconnect = false
    this.stopPing()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      try {
        this.ws.close()
      } catch {}
      this.ws = null
    }
    this.connected = false
    this.onStatusChange?.('disconnected', 'Desconectado')
  }

  public syncConfig(config: JasperBackendConfig): void {
    this.lastConfig = { ...this.lastConfig, ...config }
    if (typeof config.vision === 'boolean') {
      this.visionEnabled = config.vision
    }
    this.sendRaw({
      type: 'config',
      agent_name: this.lastConfig.agentName,
      model: this.lastConfig.model,
      api_key: this.lastConfig.apiKey,
      voice: this.lastConfig.voiceName,
      vision: this.visionEnabled
    })
  }

  public sendText(text: string, vision?: boolean): boolean {
    const clean = text.trim()
    if (!clean) return false
    return this.sendRaw({
      type: 'chat',
      text: clean,
      vision: vision ?? this.visionEnabled
    })
  }

  public sendAudioBase64(audioBase64: string, vision?: boolean): boolean {
    if (!audioBase64) return false
    return this.sendRaw({
      type: 'audio_input',
      audio_base64: audioBase64,
      vision: vision ?? this.visionEnabled
    })
  }

  public interrupt(): void {
    this.sendRaw({ type: 'interrupt' })
  }

  public clearMemory(): void {
    this.sendRaw({ type: 'clear_memory' })
  }

  public requestMemory(): void {
    this.sendRaw({ type: 'get_memory' })
  }

  private sendRaw(payload: Record<string, unknown>): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false
    }
    try {
      this.ws.send(JSON.stringify(payload))
      return true
    } catch {
      return false
    }
  }

  private handleMessage(raw: string): void {
    if (!raw) return
    let data: Record<string, any>
    try {
      data = JSON.parse(raw)
    } catch {
      return
    }

    const msgType = data.type
    switch (msgType) {
      case 'status':
        this.onStatusChange?.(String(data.status || 'connected'), data.message ? String(data.message) : undefined)
        break
      case 'tool_execution':
        this.onToolExecution?.({
          tool: String(data.tool || ''),
          args: (data.args && typeof data.args === 'object') ? data.args : {}
        })
        break
      case 'user_transcript':
        if (data.text) {
          this.onUserTranscript?.(String(data.text))
        }
        break
      case 'response':
        if (data.text) {
          this.onResponseText?.(String(data.text))
        }
        break
      case 'audio':
        if (data.audio_base64) {
          this.onAudioBase64?.(String(data.audio_base64), data.format ? String(data.format) : 'mp3')
        }
        break
      case 'turn_complete':
        this.onTurnComplete?.()
        break
      case 'interrupted':
        this.onInterrupted?.()
        break
      case 'memory_data':
      case 'memory_cleared':
        if (Array.isArray(data.facts)) {
          this.onMemoryData?.(data.facts)
        }
        break
      case 'error':
        if (data.message) {
          this.onError?.(String(data.message))
        }
        break
      default:
        break
    }
  }

  private startPing(): void {
    this.stopPing()
    this.pingTimer = setInterval(() => {
      this.sendRaw({ type: 'ping' })
    }, 20000)
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }
}

export const jasperSocket = new JasperSocketService()
