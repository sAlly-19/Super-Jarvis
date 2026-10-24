import { ClapDetector } from './clap-detector'

/** Owns only idle clap capture. stop() also invalidates pending microphone requests. */
export class ClapWakeEngine {
  private generation = 0
  private context: AudioContext | null = null
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private worklet: AudioWorkletNode | null = null
  private gain: GainNode | null = null
  private listening = false

  constructor(private readonly onDetect: () => void) {}

  public getIsListening(): boolean { return this.listening }

  public async resumeIfSuspended(): Promise<void> {
    if (this.context?.state === 'suspended') await this.context.resume()
  }

  public async start(): Promise<void> {
    const generation = ++this.generation
    await this.release()
    if (generation !== this.generation) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: {
        channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false
      } })
      if (generation !== this.generation) {
        stream.getTracks().forEach(track => track.stop())
        return
      }
      this.stream = stream
      const context = new AudioContext()
      this.context = context
      const code = `class ClapCapture extends AudioWorkletProcessor {
        constructor() { super(); this.buffer = new Float32Array(1024); this.offset = 0; }
        process(inputs) {
          const input = inputs[0] && inputs[0][0];
          if (input) for (const sample of input) {
            this.buffer[this.offset++] = sample;
            if (this.offset === 1024) {
              this.port.postMessage({ samples: this.buffer, time: currentTime * 1000 });
              this.offset = 0;
            }
          }
          return true;
        }
      } registerProcessor('clap-capture', ClapCapture);`
      const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }))
      try { await context.audioWorklet.addModule(url) } finally { URL.revokeObjectURL(url) }
      if (generation !== this.generation) return
      this.source = context.createMediaStreamSource(stream)
      this.worklet = new AudioWorkletNode(context, 'clap-capture')
      this.gain = context.createGain()
      this.gain.gain.value = 0
      const detector = new ClapDetector()
      const armedAt = context.currentTime * 1000 + 500
      this.worklet.port.onmessage = (event: MessageEvent<{samples: Float32Array; time: number}>) => {
        if (generation !== this.generation || !this.listening || event.data.time < armedAt) return
        if (detector.process(event.data.samples, event.data.time)) this.onDetect()
      }
      this.source.connect(this.worklet)
      this.worklet.connect(this.gain)
      this.gain.connect(context.destination)
      await context.resume()
      if (generation === this.generation) this.listening = true
    } catch (error) {
      if (generation !== this.generation) return
      await this.stop()
      throw error
    }
  }

  public async stop(): Promise<void> {
    ++this.generation
    await this.release()
  }

  private async release(): Promise<void> {
    this.listening = false
    const context = this.context
    this.context = null
    if (this.worklet) this.worklet.port.onmessage = null
    this.source?.disconnect()
    this.worklet?.disconnect()
    this.gain?.disconnect()
    this.source = null
    this.worklet = null
    this.gain = null
    this.stream?.getTracks().forEach(track => track.stop())
    this.stream = null
    if (context && context.state !== 'closed') await context.close()
  }
}
