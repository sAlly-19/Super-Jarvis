import { SpeechCommandsWakeWord } from '../src/renderer/audio/speech-commands'
import * as tf from '@tensorflow/tfjs'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function samples(engine: SpeechCommandsWakeWord): Promise<void> {
  for (const [label, count] of [['jasper', 3], ['_background_noise_', 2], ['_other_', 2]] as const) {
    for (let i = 0; i < count; i++) await engine.collectCustomSample(label)
  }
}

async function run(): Promise<void> {
  await tf.ready()
  const initialTensors = tf.memory().numTensors
  // A failed asset load must not leave a partially initialized base recognizer.
  const originalFetch = window.fetch
  let fail = true
  window.fetch = async (...args) => {
    if (fail && String(args[0]).includes('speech-model')) {
      fail = false
      throw new Error('Simulated asset failure')
    }
    return originalFetch(...args)
  }
  const engine = new SpeechCommandsWakeWord({ agentName: 'Jasper' })
  let failed = false
  try { await engine.load() } catch { failed = true }
  assert(failed, 'Expected the first load to fail')
  window.fetch = originalFetch
  await engine.collectCustomSample('jasper')
  assert(engine.getExampleCounts().jasper === 1, 'Failed load was not recoverable')
  await engine.clearCustomModel()
  assert(Object.keys(engine.getExampleCounts()).length === 0, 'Reset retained samples')
  await samples(engine)
  await engine.trainCustomModel()
  assert(engine.isCustomModelActive(), 'Training did not activate the model')
  await engine.start()
  await engine.stop()

  // Reload persisted weights, then train again using newly recorded examples.
  const restored = new SpeechCommandsWakeWord({ agentName: 'Jasper' })
  await restored.load()
  assert(restored.isCustomModelActive(), 'Saved model did not reload')
  await samples(restored)
  await restored.trainCustomModel()
  await restored.start()
  await restored.clearCustomModel()
  assert(!restored.isCustomModelActive(), 'Reset left detection active')
  await samples(restored)
  await restored.trainCustomModel()
  await restored.clearCustomModel()
  const result = await restored.collectCustomSample('jasper')
  assert(result.count === 1, 'Recording after trained model reset failed')
  await restored.clearCustomModel()
  await engine.clearCustomModel()
  await engine.dispose()
  await restored.dispose()
  assert(tf.memory().numTensors === initialTensors, `Leaked tensors: ${tf.memory().numTensors - initialTensors}`)
  console.log('WAKE_LIFECYCLE_PASS')
}

run().catch((error) => console.error('WAKE_LIFECYCLE_FAIL', error.stack || String(error)))
