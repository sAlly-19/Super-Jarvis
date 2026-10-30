// Dependency gate only: no personal profile, model weights, credentials or installer.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const cleanEnv = () => Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP'].filter(k => process.env[k]).map(k => [k, process.env[k]]))

if (!process.versions.electron) {
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
    env: cleanEnv(), encoding: 'utf8', timeout: 45000
  })
  process.stdout.write(result.stdout || '')
  process.stderr.write(result.stderr || '')
  if (result.error) console.error(result.error.message)
  process.exit(result.status ?? 1)
} else if (process.parentPort) {
  void (async () => {
    let networkAttempts = 0
    const deny = () => { networkAttempts++; throw new Error('network_forbidden_in_gate') }
    globalThis.fetch = deny
    for (const name of ['node:http', 'node:https']) {
      require(name).request = deny
      require(name).get = deny
    }
    require('node:net').Socket.prototype.connect = deny
    const ort = require('onnxruntime-node')
    assert.ok(ort.listSupportedBackends().some(item => item.name === 'cpu'))
    // Small synthetic ONNX Identity graph, built from protobuf fields. No downloaded model.
    const varint = n => { const bytes = []; do { bytes.push((n & 127) | (n > 127 ? 128 : 0)); n >>>= 7 } while (n); return Buffer.from(bytes) }
    const number = (field, n) => Buffer.concat([varint(field * 8), varint(n)])
    const data = (field, value) => { const b = Buffer.isBuffer(value) ? value : Buffer.from(value); return Buffer.concat([varint(field * 8 + 2), varint(b.length), b]) }
    const valueInfo = name => Buffer.concat([data(1, name), data(2, data(1, Buffer.concat([number(1, 1), data(2, data(1, number(1, 1)))])))])
    const node = Buffer.concat([data(1, 'x'), data(2, 'y'), data(4, 'Identity')])
    const graph = Buffer.concat([data(1, node), data(2, 'compatibility'), data(11, valueInfo('x')), data(12, valueInfo('y'))])
    const model = Buffer.concat([number(1, 8), data(7, graph), data(8, number(2, 13))])
    const session = await ort.InferenceSession.create(model, { executionProviders: ['cpu'] })
    const result = await session.run({ x: new ort.Tensor('float32', Float32Array.of(42), [1]) })
    assert.equal(result.y.data[0], 42)
    await session.release()
    const transformers = require('@huggingface/transformers')
    transformers.env.allowRemoteModels = false
    transformers.env.allowLocalModels = true
    transformers.env.useBrowserCache = false
    transformers.env.useFSCache = false
    transformers.env.useWasmCache = false
    const root = process.argv[2]
    assert.ok(root && path.basename(root).startsWith('jasper-semantic-runtime-'))
    transformers.env.localModelPath = root + path.sep
    await assert.rejects(() => transformers.pipeline('feature-extraction', 'missing-candidate', { device: 'cpu', dtype: 'int8', local_files_only: true }))
    assert.equal(networkAttempts, 0)
    process.parentPort.postMessage({ ok: true, electron: process.versions.electron, node: process.versions.node,
      onnx: ort.env.versions.node, cpuIdentity: 42, missingModelRejected: true, networkAttempts })
  })().catch(() => { process.parentPort.postMessage({ ok: false, code: 'runtime_gate_failed' }); process.exitCode = 1 })
} else {
  const { app, utilityProcess } = require('electron')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-semantic-runtime-'))
  app.setPath('userData', path.join(root, 'profile'))
  app.commandLine.appendSwitch('disable-gpu')
  let worker
  const finish = code => {
    clearTimeout(timer)
    worker?.kill()
    // Delete only the directory this harness created under the resolved OS temp root.
    if (path.dirname(root) === fs.realpathSync(os.tmpdir()) && path.basename(root).startsWith('jasper-semantic-runtime-')) {
      try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* Windows may still hold Chromium cache handles. */ }
    }
    app.exit(code)
  }
  const timer = setTimeout(() => finish(1), 30000)
  app.whenReady().then(() => {
    worker = utilityProcess.fork(__filename, [root], { env: cleanEnv(), stdio: 'pipe', serviceName: 'Semantic dependency evaluation' })
    worker.on('message', report => { console.log(JSON.stringify(report)); finish(report.ok ? 0 : 1) })
    worker.on('exit', code => { if (code) finish(1) })
  }).catch(() => finish(1))
}
