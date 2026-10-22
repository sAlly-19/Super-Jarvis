export class AudioPlayer {
  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private workletNode: AudioWorkletNode | null = null
  private workletReady = false
  private nextPlayTime: number = 0
  private activeSources: AudioBufferSourceNode[] = []
  private isSpeaking: boolean = false
  private drainTimeout: any = null
  public onSpeakingChange: ((speaking: boolean) => void) | null = null
  public onPlaybackEnded: (() => void) | null = null

  constructor() {
    // AudioContext will be initialized on user interaction or first playback
  }

  private ensureContext(): AudioContext {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      this.analyser = this.audioContext.createAnalyser()
      this.analyser.fftSize = 512
      this.analyser.smoothingTimeConstant = 0.15
      this.analyser.connect(this.audioContext.destination)
      this.nextPlayTime = this.audioContext.currentTime
      void this.initAudioWorklet(this.audioContext)
    }

    if (this.audioContext.state === 'suspended') {
      void this.audioContext.resume()
    }

    return this.audioContext
  }

  private async initAudioWorklet(ctx: AudioContext): Promise<void> {
    if (this.workletReady || !ctx.audioWorklet) return
    try {
      await ctx.audioWorklet.addModule('./audio-processor.js')
      this.workletNode = new AudioWorkletNode(ctx, 'audio-processor')
      const silentGain = ctx.createGain()
      silentGain.gain.value = 0
      this.workletNode.connect(silentGain)
      silentGain.connect(ctx.destination)
      this.workletReady = true
    } catch {
      // Fallback if worklet module path is unavailable in test environment
    }
  }

  public getAnalyser(): AnalyserNode | null {
    this.ensureContext()
    return this.analyser
  }

  public getAudioContext(): AudioContext | null {
    return this.audioContext
  }

  public getIsSpeaking(): boolean {
    return this.isSpeaking
  }

  private base64ToBytes(base64Data: string): Uint8Array {
    const clean = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data
    const binaryString = atob(clean)
    const len = binaryString.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    return bytes
  }

  private isEncodedAudioFormat(bytes: Uint8Array, format?: string): boolean {
    if (format === 'mp3' || format === 'wav' || format === 'ogg') return true
    if (bytes.length < 4) return false
    // ID3 tag ('ID3')
    if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true
    // MP3 frame sync (0xFF 0xE0..0xFF)
    if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return true
    // RIFF WAV header ('RIFF')
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return true
    return false
  }

  /**
   * Enqueues a base64 audio payload (MP3/WAV from Python Edge-TTS or 24kHz PCM)
   * and connects it through AudioContext, AnalyserNode (facecap.glb Lip-Sync) and AudioWorklet.
   */
  public enqueueAudioChunk(base64Data: string, format?: string): void {
    const ctx = this.ensureContext()
    const bytes = this.base64ToBytes(base64Data)
    if (bytes.byteLength === 0) return

    if (this.isEncodedAudioFormat(bytes, format)) {
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      ctx
        .decodeAudioData(arrayBuffer)
        .then((decodedBuffer) => {
          this.scheduleAudioBuffer(ctx, decodedBuffer)
        })
        .catch((err) => {
          console.warn('[AudioPlayer] Falha ao decodificar áudio MP3/WAV:', err)
        })
      return
    }

    // Fallback: Convert raw Int16 little-endian PCM samples to Float32 [-1.0, 1.0]
    const sampleCount = Math.floor(bytes.byteLength / 2)
    if (sampleCount === 0) return

    const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, sampleCount)
    const float32 = new Float32Array(sampleCount)

    for (let i = 0; i < sampleCount; i++) {
      const val = int16[i]
      float32[i] = val < 0 ? val / 0x8000 : val / 0x7fff
    }

    const audioBuffer = ctx.createBuffer(1, float32.length, 24000)
    audioBuffer.copyToChannel(float32, 0)
    this.scheduleAudioBuffer(ctx, audioBuffer)
  }

  private scheduleAudioBuffer(ctx: AudioContext, audioBuffer: AudioBuffer): void {
    const source = ctx.createBufferSource()
    source.buffer = audioBuffer

    if (this.analyser) {
      source.connect(this.analyser)
    } else {
      source.connect(ctx.destination)
    }

    if (this.workletNode) {
      try {
        source.connect(this.workletNode)
      } catch {}
    }

    if (this.drainTimeout) {
      clearTimeout(this.drainTimeout)
      this.drainTimeout = null
    }

    const now = ctx.currentTime
    if (now > this.nextPlayTime + 0.08) {
      this.nextPlayTime = now
    }
    const startTime = Math.max(now, this.nextPlayTime)
    source.start(startTime)
    this.nextPlayTime = startTime + audioBuffer.duration

    this.activeSources.push(source)
    this.setSpeaking(true)

    source.onended = (): void => {
      try {
        source.disconnect()
      } catch {}
      source.onended = null

      const index = this.activeSources.indexOf(source)
      if (index !== -1) {
        this.activeSources.splice(index, 1)
      }
      if (this.activeSources.length === 0) {
        if (this.drainTimeout) clearTimeout(this.drainTimeout)
        this.drainTimeout = setTimeout(() => {
          if (this.activeSources.length === 0) {
            this.setSpeaking(false)
            this.onPlaybackEnded?.()
          }
        }, 80)
      }
    }
  }

  private setSpeaking(val: boolean): void {
    if (this.isSpeaking !== val) {
      this.isSpeaking = val
      this.onSpeakingChange?.(val)
    }
  }

  /**
   * Immediately stops all currently playing and queued audio (called on user interrupt)
   */
  public stopAll(): void {
    if (this.drainTimeout) {
      clearTimeout(this.drainTimeout)
      this.drainTimeout = null
    }
    for (const source of this.activeSources) {
      try {
        source.stop()
        source.disconnect()
        source.onended = null
      } catch {
        // Source might already have stopped
      }
    }
    this.activeSources = []
    if (this.audioContext) {
      this.nextPlayTime = this.audioContext.currentTime
    }
    this.setSpeaking(false)
  }
}
