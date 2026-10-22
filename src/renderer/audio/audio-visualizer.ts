import { DOM } from '../ui/dom'

export class AudioVisualizer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D

  constructor() {
    this.canvas = DOM.visualizerCanvas
    this.ctx = this.canvas.getContext('2d')!
  }

  public draw(
    analyser: AnalyserNode | null,
    isSpeaking: boolean,
    isRecording: boolean,
    micLevel: number
  ): void {
    const width = this.canvas.width
    const height = this.canvas.height
    this.ctx.clearRect(0, 0, width, height)

    if (isSpeaking && analyser) {
      // Render frequency spectrum from Jasper's voice (Monochromatic White/Silver)
      const bufferLength = analyser.frequencyBinCount
      const dataArray = new Uint8Array(bufferLength)
      analyser.getByteFrequencyData(dataArray)

      const barCount = Math.max(12, Math.floor(width / 6))
      const barWidth = width / barCount - 2
      const step = Math.max(1, Math.floor(bufferLength / barCount))

      for (let i = 0; i < barCount; i++) {
        const value = dataArray[i * step] / 255
        const barHeight = Math.max(2, value * (height - 2))
        const x = i * (barWidth + 2)
        const y = height / 2 - barHeight / 2

        const grad = this.ctx.createLinearGradient(x, y, x, y + barHeight)
        grad.addColorStop(0, '#ffffff')
        grad.addColorStop(1, '#a1a1aa')

        this.ctx.fillStyle = grad
        this.ctx.fillRect(x, y, barWidth, barHeight)
      }
    } else if (isRecording) {
      // Render wave representation for user microphone
      const bars = Math.max(12, Math.floor(width / 6))
      const barWidth = width / bars - 2

      for (let i = 0; i < bars; i++) {
        const dist = Math.abs(i - bars / 2) / (bars / 2)
        const factor = Math.max(0.1, 1 - dist)
        const wave = Math.sin(performance.now() * 0.008 + i * 0.4) * 0.3 + 0.7
        const barHeight = Math.max(2, micLevel * factor * wave * (height - 4))
        const x = i * (barWidth + 2)
        const y = height / 2 - barHeight / 2

        this.ctx.fillStyle = '#ffffff'
        this.ctx.fillRect(x, y, barWidth, barHeight)
      }
    } else {
      // Idle calm baseline
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)'
      this.ctx.lineWidth = 1.5
      this.ctx.beginPath()
      this.ctx.moveTo(0, height / 2)
      for (let x = 0; x < width; x += 4) {
        const y = height / 2 + Math.sin(x * 0.05 + performance.now() * 0.002) * 2
        this.ctx.lineTo(x, y)
      }
      this.ctx.stroke()
    }
  }
}
