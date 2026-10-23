export type AudioLevelCallback = (level: number) => void

export class MicRecorder {
  private audioContext: AudioContext | null = null
  private mediaStream: MediaStream | null = null
  private workletNode: AudioWorkletNode | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private silentGain: GainNode | null = null

  private recording: boolean = false
  private isCallMode: boolean = false

  // 100ms buffering at 16kHz (1600 samples = 3200 bytes)
  private static readonly BUFFER_SAMPLES = 1600
  private pcmBuffer = new Int16Array(MicRecorder.BUFFER_SAMPLES)
  private bufferOffset = 0

  // Utterance accumulation for WAV encoding -> Python STT
  private utteranceChunks: Int16Array[] = []

  // Voice Activity & 30s Inactivity Tracking
  private hasSpoken = false
  private speechFramesCount = 0
  private silenceFramesCount = 0
  private lastActivityTimestamp = 0

  // VAD Tuning Parameters
  private static readonly SPEECH_RMS_THRESHOLD = 0.025
  private static readonly MIN_SPEECH_CHUNKS = 18
  // Silence frames (~750ms) after speech to finalize utterance for Python STT
  private static readonly END_OF_SPEECH_SILENCE_CHUNKS = 90
  // 30s inactivity in Call Mode (ignoring ambient noise)
  private static readonly CALL_INACTIVITY_TIMEOUT_MS = 30000

  public onAudioLevel: AudioLevelCallback | null = null
  public onCallInactivityTimeout: (() => void) | null = null
  public onUtteranceWavBase64: ((wavBase64: string) => void) | null = null
  public onBargeIn: (() => void) | null = null
  public isAssistantSpeaking?: () => boolean

  public isRecording(): boolean {
    return this.recording
  }

  public getIsCallMode(): boolean {
    return this.isCallMode
  }

  public setCallMode(val: boolean): void {
    this.isCallMode = val
  }

  public notifyAssistantActivity(): void {
    this.lastActivityTimestamp = Date.now()
  }

  public getRemainingInactivitySeconds(): number {
    if (!this.isCallMode || !this.recording) {
      return 30
    }
    const elapsed = Date.now() - this.lastActivityTimestamp
    return Math.max(0, Math.ceil((MicRecorder.CALL_INACTIVITY_TIMEOUT_MS - elapsed) / 1000))
  }

  private async ensurePipeline(): Promise<void> {
    if (
      this.audioContext &&
      this.audioContext.state !== 'closed' &&
      this.mediaStream &&
      this.mediaStream.active &&
      this.sourceNode &&
      this.workletNode
    ) {
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume()
      }
      return
    }

    this.cleanupNodes()

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    })

    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
      sampleRate: 16000
    })

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume()
    }

    const workletCode = `
      class PCMWorkletProcessor extends AudioWorkletProcessor {
        process(inputs) {
          const input = inputs[0];
          if (input && input[0] && input[0].length > 0) {
            this.port.postMessage(input[0]);
          }
          return true;
        }
      }
      registerProcessor('pcm-worklet-processor', PCMWorkletProcessor);
    `
    const blob = new Blob([workletCode], { type: 'application/javascript' })
    const workletUrl = URL.createObjectURL(blob)

    try {
      await this.audioContext.audioWorklet.addModule(workletUrl)
    } finally {
      URL.revokeObjectURL(workletUrl)
    }

    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream)
    this.workletNode = new AudioWorkletNode(this.audioContext, 'pcm-worklet-processor')

    this.workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
      this.handleWorkletAudio(event.data)
    }

    this.sourceNode.connect(this.workletNode)
    this.silentGain = this.audioContext.createGain()
    this.silentGain.gain.value = 0
    this.workletNode.connect(this.silentGain)
    this.silentGain.connect(this.audioContext.destination)
  }

  private encodeWavBase64(chunks: Int16Array[], sampleRate = 16000): string {
    let totalSamples = 0
    for (const c of chunks) totalSamples += c.length
    if (totalSamples === 0) return ''

    const byteLength = totalSamples * 2
    const buffer = new ArrayBuffer(44 + byteLength)
    const view = new DataView(buffer)

    const writeStr = (offset: number, str: string): void => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i))
      }
    }

    writeStr(0, 'RIFF')
    view.setUint32(4, 36 + byteLength, true)
    writeStr(8, 'WAVE')
    writeStr(12, 'fmt ')
    view.setUint32(16, 16, true) // PCM chunk size
    view.setUint16(20, 1, true) // PCM format = 1
    view.setUint16(22, 1, true) // Mono = 1 channel
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * 2, true) // Byte rate
    view.setUint16(32, 2, true) // Block align
    view.setUint16(34, 16, true) // Bits per sample
    writeStr(36, 'data')
    view.setUint32(40, byteLength, true)

    const int16Out = new Int16Array(buffer, 44, totalSamples)
    let offset = 0
    for (const c of chunks) {
      int16Out.set(c, offset)
      offset += c.length
    }

    const bytes = new Uint8Array(buffer)
    let binary = ''
    const chunkSize = 0x8000
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)))
    }
    return btoa(binary)
  }

  private dispatchUtteranceIfReady(): void {
    if (this.utteranceChunks.length === 0) return
    const wavB64 = this.encodeWavBase64(this.utteranceChunks, 16000)
    this.utteranceChunks = []
    this.hasSpoken = false
    this.speechFramesCount = 0
    this.silenceFramesCount = 0
    if (wavB64) {
      this.onUtteranceWavBase64?.(wavB64)
    }
  }

  private handleWorkletAudio(inputData: Float32Array): void {
    if (!this.recording) {
      return
    }
    if (!inputData || inputData.length === 0) return

    let sum = 0
    const frameInt16 = new Int16Array(inputData.length)
    for (let i = 0; i < inputData.length; i++) {
      const s = Math.max(-1, Math.min(1, inputData[i]))
      sum += s * s
      const pcmVal = s < 0 ? s * 0x8000 : s * 0x7fff
      frameInt16[i] = pcmVal
      this.pcmBuffer[this.bufferOffset++] = pcmVal

      if (this.bufferOffset >= MicRecorder.BUFFER_SAMPLES) {
        window.electronAPI?.sendAudio(this.pcmBuffer.buffer.slice(0))
        this.bufferOffset = 0
      }
    }

    const rms = Math.sqrt(sum / inputData.length)
    this.onAudioLevel?.(Math.min(1, rms * 4))

    const now = Date.now()
    const assistantIsSpeaking = this.isAssistantSpeaking ? this.isAssistantSpeaking() : false

    if (rms >= MicRecorder.SPEECH_RMS_THRESHOLD && !assistantIsSpeaking) {
      this.speechFramesCount++
      this.silenceFramesCount = 0
      this.utteranceChunks.push(frameInt16)
      // Cap pre-roll if speech hasn't been confirmed yet
      if (!this.hasSpoken && this.utteranceChunks.length > 35) {
        this.utteranceChunks.shift()
      }
      if (this.speechFramesCount >= MicRecorder.MIN_SPEECH_CHUNKS) {
        this.hasSpoken = true
        this.lastActivityTimestamp = now
      }
    } else if (rms >= MicRecorder.SPEECH_RMS_THRESHOLD * 2.2 && assistantIsSpeaking) {
      // Barge-in when user speaks strongly while assistant is talking
      this.speechFramesCount++
      if (this.speechFramesCount >= MicRecorder.MIN_SPEECH_CHUNKS) {
        this.onBargeIn?.()
      }
    } else {
      this.silenceFramesCount++
      if (this.hasSpoken) {
        this.utteranceChunks.push(frameInt16)
        if (this.silenceFramesCount >= MicRecorder.END_OF_SPEECH_SILENCE_CHUNKS) {
          this.dispatchUtteranceIfReady()
        }
      } else {
        if (this.silenceFramesCount > 6) {
          this.speechFramesCount = 0
          this.utteranceChunks = []
        } else if (this.speechFramesCount > 0) {
          this.speechFramesCount--
        }
      }
    }

    // 30-second Inactivity Timeout in Call Mode
    if (this.isCallMode && !assistantIsSpeaking) {
      const elapsed = now - this.lastActivityTimestamp
      if (elapsed >= MicRecorder.CALL_INACTIVITY_TIMEOUT_MS) {
        console.log(`[MicRecorder] Inatividade de ${MicRecorder.CALL_INACTIVITY_TIMEOUT_MS / 1000}s em Modo Chamada. Encerrando chamada...`)
        this.flushRemainingBuffer()
        this.onCallInactivityTimeout?.()
        this.stop()
      }
    }
  }

  public async start(callMode = true): Promise<void> {
    this.isCallMode = callMode
    this.bufferOffset = 0
    this.utteranceChunks = []
    this.hasSpoken = false
    this.speechFramesCount = 0
    this.silenceFramesCount = 0
    this.lastActivityTimestamp = Date.now()

    try {
      await this.ensurePipeline()
      this.recording = true
      console.log(`[MicRecorder] Microfone Full-Duplex ativado (Streaming contínuo, VAD ativo).`)
    } catch (err) {
      console.error('[MicRecorder] Falha ao iniciar gravação:', err)
      this.stop()
      throw err
    }
  }

  public pauseForTurn(): void {
    this.flushRemainingBuffer()
    this.hasSpoken = false
    this.speechFramesCount = 0
    this.silenceFramesCount = 0
  }

  public async resumeOrStart(callMode = true): Promise<void> {
    this.isCallMode = callMode
    this.bufferOffset = 0
    this.utteranceChunks = []
    this.hasSpoken = false
    this.speechFramesCount = 0
    this.lastActivityTimestamp = Date.now()

    if (
      this.mediaStream &&
      this.mediaStream.active &&
      this.audioContext &&
      this.audioContext.state !== 'closed'
    ) {
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume()
      }
      this.recording = true
      console.log('[MicRecorder] Microfone Full-Duplex mantido ativo.')
    } else {
      await this.start(callMode)
    }
  }

  private flushRemainingBuffer(): void {
    if (this.bufferOffset > 0) {
      const slice = this.pcmBuffer.slice(0, this.bufferOffset)
      window.electronAPI?.sendAudio(slice.buffer)
      this.bufferOffset = 0
    }
    if (this.hasSpoken) {
      this.dispatchUtteranceIfReady()
    }
  }

  public stop(): void {
    if (this.recording) {
      this.flushRemainingBuffer()
    }
    this.recording = false
    this.isCallMode = false
    this.utteranceChunks = []
    this.hasSpoken = false
    this.speechFramesCount = 0

    this.cleanupNodes()
    this.onAudioLevel?.(0)
    console.log('[MicRecorder] Microfone finalizado e recursos liberados.')
  }

  private cleanupNodes(): void {
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect()
      } catch {}
      this.sourceNode = null
    }

    if (this.workletNode) {
      try {
        this.workletNode.disconnect()
      } catch {}
      this.workletNode = null
    }

    if (this.silentGain) {
      try {
        this.silentGain.disconnect()
      } catch {}
      this.silentGain = null
    }

    if (this.mediaStream) {
      try {
        this.mediaStream.getTracks().forEach((track) => track.stop())
      } catch {}
      this.mediaStream = null
    }

    if (this.audioContext) {
      try {
        this.audioContext.close()
      } catch {}
      this.audioContext = null
    }
  }
}
