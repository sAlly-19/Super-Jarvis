const assert = require('node:assert/strict')
const path = require('node:path')
const { app, utilityProcess } = require('electron')
const [profile, root, fingerprint, mode] = process.argv.slice(2)
assert.ok(path.basename(profile).startsWith('jasper-semantic-gate-'))
app.setPath('userData', path.join(profile, 'profile'))
app.commandLine.appendSwitch('disable-gpu')
let worker, timer, sampler, started, warmStarted, coldMs, peakRssBytes = 0
let finished = false
const texts = ['Gosto de café sem açúcar.', 'Prefiro tomar café puro sem adoçar.', 'O motor do avião está em manutenção.',
  'Trabalho melhor no período da manhã.', 'Prefiro fazer tarefas importantes antes do almoço.', 'A praia tem ondas e areia.']
const finish = (code, report) => {
  if (finished) return; finished = true
  clearTimeout(timer); clearInterval(sampler); worker?.kill()
  console.log(JSON.stringify(report)); app.exit(code)
}
app.whenReady().then(() => {
  const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP'].filter(key => process.env[key]).map(key => [key, process.env[key]]))
  worker = utilityProcess.fork(path.resolve(__dirname, '../../../out/main/semantic-model-worker.js'), [root, fingerprint], { env, stdio: 'ignore', serviceName: 'Semantic model gate' })
  sampler = setInterval(() => { const metric = app.getAppMetrics().find(item => item.pid === worker.pid); if (metric) peakRssBytes = Math.max(peakRssBytes, metric.memory.workingSetSize * 1024) }, 20)
  timer = setTimeout(() => finish(1, { ok: false, code: 'gate_timeout' }), 45000)
  worker.on('spawn', () => { started = performance.now(); worker.postMessage({ id: 'cold', type: 'embed', texts, modelFingerprint: fingerprint }) })
  worker.on('exit', () => { if (!finished) finish(1, { ok: false, code: 'worker_exited' }) })
  worker.on('message', message => {
    try {
      assert.equal(message.modelFingerprint, fingerprint)
      if (mode === 'absent') {
        assert.equal(message.type, 'error'); assert.equal(message.code, 'model_not_prepared')
        finish(0, { ok: true, mode, missingModelRejected: true }); return
      }
      assert.equal(message.type, 'result'); assert.equal(message.vectors.length, texts.length)
      for (const vector of message.vectors) {
        assert.equal(vector.length, 384); assert.ok(vector.every(Number.isFinite))
        assert.ok(Math.abs(vector.reduce((sum, value) => sum + value * value, 0) - 1) < 0.002)
      }
      if (message.id === 'cold') {
        coldMs = performance.now() - started; warmStarted = performance.now()
        worker.postMessage({ id: 'warm', type: 'embed', texts, modelFingerprint: fingerprint }); return
      }
      const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0)
      const positive = dot(message.vectors[0], message.vectors[1]), negative = dot(message.vectors[0], message.vectors[2])
      const secondPositive = dot(message.vectors[3], message.vectors[4]), secondNegative = dot(message.vectors[3], message.vectors[5])
      assert.ok(positive > negative); assert.ok(secondPositive > secondNegative)
      finish(0, { ok: true, mode, dimensions: 384, coldMs, warmMs: performance.now() - warmStarted, peakRssBytes,
        memorySamplingMs: 20, positive, negative, secondPositive, secondNegative })
    } catch { finish(1, { ok: false, code: 'gate_validation_failed', workerCode: message?.code }) }
  })
}).catch(() => finish(1, { ok: false, code: 'host_failed' }))
