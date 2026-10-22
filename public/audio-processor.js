// AudioWorkletProcessor for openWakeWord 16kHz audio stream
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.bufferSize = 1280
    this._buffer = new Float32Array(this.bufferSize)
    this._pos = 0
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0]
    if (input) {
      for (let i = 0; i < input.length; i++) {
        this._buffer[this._pos++] = input[i]
        if (this._pos === this.bufferSize) {
          // Clone the buffer slice so subsequent writes don't mutate in-flight data
          this.port.postMessage(new Float32Array(this._buffer))
          this._pos = 0
        }
      }
    }
    return true
  }
}

registerProcessor('audio-processor', AudioProcessor)

