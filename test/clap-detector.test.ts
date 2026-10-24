import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ClapDetector } from '../src/renderer/audio/clap-detector'

const quiet = new Float32Array(1024)
// Short, broadband impulse with a decaying envelope, not a sustained tone.
const clap = Float32Array.from({ length: 1024 }, (_, i) =>
  i < 256 ? (i % 2 ? -1 : 1) * 0.8 * Math.exp(-i / 65) : 0)

function pulse(detector: ClapDetector, time: number): boolean {
  detector.process(clap, time)
  return detector.process(quiet, time + 30)
}

test('two separated short claps activate once, after the second decays', () => {
  const detector = new ClapDetector()
  assert.equal(pulse(detector, 1000), false)
  assert.equal(pulse(detector, 1400), true)
  assert.equal(pulse(detector, 1800), false)
})

test('one clap, nearby echoes, and widely separated claps do not activate', () => {
  const detector = new ClapDetector()
  assert.equal(pulse(detector, 1000), false)
  assert.equal(pulse(detector, 1080), false)
  assert.equal(pulse(detector, 2100), false)
  assert.equal(detector.process(quiet, 3000), false)
})

test('continuous loud noise cannot count as a short clap', () => {
  const detector = new ClapDetector()
  for (let time = 1000; time < 1700; time += 20) {
    assert.equal(detector.process(clap, time), false)
  }
  assert.equal(detector.process(quiet, 1720), false)
  assert.equal(pulse(detector, 2100), false)
})

test('voiced tones and quiet background noise do not activate', () => {
  const detector = new ClapDetector()
  const tone = Float32Array.from({ length: 1024 }, (_, i) => 0.4 * Math.sin(i * 0.04))
  const noise = Float32Array.from({ length: 1024 }, (_, i) => (i % 2 ? -0.01 : 0.01))
  for (let time = 0; time < 3000; time += 20) {
    assert.equal(detector.process(time % 400 < 200 ? tone : noise, time), false)
  }
})

test('cooldown expires and a new pair can activate', () => {
  const detector = new ClapDetector()
  pulse(detector, 1000)
  assert.equal(pulse(detector, 1400), true)
  pulse(detector, 4500)
  assert.equal(pulse(detector, 4900), true)
})
