import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MicRecorder } from '../src/renderer/audio/mic-recorder'

test('Live microphone sends PCM blocks once and never dispatches WAV', () => {
  const mic = new MicRecorder()
  const pcm: ArrayBuffer[] = []
  let wav = 0
  mic.onPcmChunk = chunk => pcm.push(chunk)
  mic.onUtteranceWavBase64 = () => wav++
  mic.setRealtimeMode(true)
  ;(mic as any).recording = true
  ;(mic as any).lastActivityTimestamp = Date.now()
  ;(mic as any).handleWorkletAudio(new Float32Array(1600).fill(0.5))
  assert.equal(pcm.length, 1)
  assert.equal(pcm[0].byteLength, 3200)
  assert.equal(wav, 0)
  assert.equal((mic as any).utteranceChunks.length, 0)
  mic.stop()
})

test('Legacy microphone does not route raw PCM into WAV transcription', () => {
  const mic = new MicRecorder()
  let pcm = 0
  mic.onPcmChunk = () => pcm++
  ;(mic as any).recording = true
  ;(mic as any).handleWorkletAudio(new Float32Array(1600).fill(0.5))
  assert.equal(pcm, 0)
  mic.stop()
})
