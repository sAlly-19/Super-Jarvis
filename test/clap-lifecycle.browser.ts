import { ClapWakeEngine } from '../src/renderer/audio/clap-wake-engine'
import { WakeWordManager } from '../src/renderer/audio/wake-word-manager'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function run(): Promise<void> {
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  const streams: MediaStream[] = []
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    const stream = await original(constraints)
    streams.push(stream)
    return stream
  }
  const engine = new ClapWakeEngine(() => { throw new Error('Fake input must not trigger') })
  await engine.start()
  assert(engine.getIsListening(), 'Capture did not start')
  await engine.stop()
  assert(!engine.getIsListening(), 'Capture remained active')
  assert(streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')), 'Microphone leaked')
  await engine.start()
  await engine.stop()
  assert(streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')), 'Restart leaked microphone')

  const immediateStart = engine.start()
  await engine.stop()
  await immediateStart
  assert(!engine.getIsListening(), 'An immediate stop was undone by start')
  assert(streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')), 'Immediate stop leaked microphone')

  let release!: () => void
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    const stream = await original(constraints)
    streams.push(stream)
    await new Promise<void>(resolve => { release = resolve })
    return stream
  }
  const starting = engine.start()
  while (!release) await new Promise(resolve => setTimeout(resolve, 10))
  await engine.stop()
  release()
  await starting
  assert(!engine.getIsListening(), 'Late microphone request reactivated capture')
  assert(streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')), 'Late stream leaked')
  navigator.mediaDevices.getUserMedia = original

  // Feed actual PCM through a real WebAudio graph and the capture worklet.
  const inputContext = new AudioContext({ sampleRate: 48000 })
  const destination = inputContext.createMediaStreamDestination()
  const audio = inputContext.createBuffer(1, 96000, 48000)
  const data = audio.getChannelData(0)
  let seed = 17
  for (const start of [33600, 52800]) {
    for (let i = 0; i < 720; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0
      data[start + i] = (seed / 2147483648 - 1) * Math.exp(-i / 160)
    }
  }
  navigator.mediaDevices.getUserMedia = async () => destination.stream.clone()
  let detections = 0
  const pcmEngine = new ClapWakeEngine(() => { detections++ })
  await pcmEngine.start()
  const source = inputContext.createBufferSource()
  source.buffer = audio
  source.connect(destination)
  await inputContext.resume()
  source.start()
  await new Promise<void>(resolve => { source.onended = () => resolve() })
  await new Promise(resolve => setTimeout(resolve, 100))
  await pcmEngine.stop()
  destination.stream.getTracks().forEach(track => track.stop())
  await inputContext.close()
  assert(detections === 1, `Expected one activation through real PCM capture, got ${detections}`)

  // Disabled/locked runtime must not request a microphone, including delayed resume.
  let allowed = false
  let requests = 0
  navigator.mediaDevices.getUserMedia = async (constraints) => { requests++; return original(constraints) }
  const manager = new WakeWordManager({
    getIsWakeWordEnabled: () => allowed,
    onWakeTriggered: () => { throw new Error('Unexpected manager trigger') }
  })
  await manager.init()
  await manager.resume(false)
  assert(requests === 0, 'Locked runtime requested microphone')
  allowed = true
  await manager.init()
  assert(manager.getIsRunning(), 'Enabled clap manager did not listen without training')
  allowed = false
  await manager.pause()
  await manager.resume(false)
  assert(!manager.getIsRunning() && requests === 1, 'Delayed resume bypassed runtime gate')

  // A cancelled initialization must not own or stop the replacement listener.
  let releaseOld!: () => void
  let firstRequest = true
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    const stream = await original(constraints)
    streams.push(stream)
    if (firstRequest) {
      firstRequest = false
      await new Promise<void>(resolve => { releaseOld = resolve })
    }
    return stream
  }
  allowed = true
  const oldMount = manager.init()
  while (!releaseOld) await new Promise(resolve => setTimeout(resolve, 10))
  allowed = false
  await manager.pause()
  allowed = true
  await manager.init()
  releaseOld()
  await oldMount
  assert(manager.getIsRunning(), 'Stale initialization stopped the replacement listener')
  await manager.pause()
  assert(streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')), 'Overlapping starts leaked microphone')
  navigator.mediaDevices.getUserMedia = original
  console.log('WAKE_LIFECYCLE_PASS')
}

run().catch(error => console.error('WAKE_LIFECYCLE_FAIL', error.stack || String(error)))
