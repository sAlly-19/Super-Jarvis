import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Writable } from 'node:stream'
import { createHash } from 'node:crypto'
import { ArtifactHttpTransport } from '../src/main/memory/semantic/artifact-transport'
import { WebNetworkPolicy } from '../src/main/modules/web-research/network-policy'
import { fakeHttp } from './fixtures/web/http'
import { SEMANTIC_MODEL_MANIFEST } from '../src/main/memory/semantic/model-manifest'
const scope = (ms = 2000, controller = new AbortController()) => ({ signal: controller.signal, deadline: Date.now() + ms, check() {} })
const asset = { path: 'config.json', bytes: 2, sha256: createHash('sha256').update('{}').digest('hex') }
const revision = SEMANTIC_MODEL_MANIFEST.revision
const policy = () => new WebNetworkPolicy({ resolve: async () => [{ address: '93.184.215.14', family: 4 }] })
const sink = () => { const chunks: Buffer[] = []; return { chunks, writable: new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done() } }) } }
test('semantic artifact streams exact bytes and hash with TLS hostname and pinned connection', async () => {
  const fixture = fakeHttp([{ chunks: [Buffer.from('{}')] }]), target = sink()
  await new ArtifactHttpTransport({ policy: policy(), request: fixture.request }).download(asset, revision, target.writable, scope(), () => {})
  assert.equal(Buffer.concat(target.chunks).toString(), '{}')
  assert.equal(fixture.calls[0].options.servername, 'huggingface.co')
  assert.equal(fixture.calls[0].options.agent, false)
  assert.equal(fixture.calls[0].options.headers!['Accept-Encoding'], 'identity')
})
test('semantic artifact rejects private DNS, unexpected hosts, bad peers, encoding, incomplete and oversized bodies', async () => {
  for (const reply of [
    { status: 302, headers: { location: 'https://127.0.0.1/private' } },
    { status: 302, headers: { location: 'http://huggingface.co/file' } },
    { status: 302, headers: { location: 'https://other.example/file' } },
    { peer: '127.0.0.1' }, { headers: { 'content-encoding': 'gzip' } },
    { headers: { 'content-length': '3' } }, { chunks: [Buffer.from('{')] },
    { chunks: [Buffer.from('{}x')] }, { chunks: [Buffer.from('[]')] }, { broken: true }
  ]) {
    const fixture = fakeHttp([reply])
    await assert.rejects(new ArtifactHttpTransport({ policy: policy(), request: fixture.request }).download(asset, revision, sink().writable, scope(), () => {}), /model_download_/)
    assert.equal(fixture.calls.length, 1)
  }
  const fixture = fakeHttp([])
  const privatePolicy = new WebNetworkPolicy({ resolve: async () => [{ address: '127.0.0.1', family: 4 }] })
  await assert.rejects(new ArtifactHttpTransport({ policy: privatePolicy, request: fixture.request }).download(asset, revision, sink().writable, scope(), () => {}))
  assert.equal(fixture.calls.length, 0)
})
test('semantic artifact bounds redirects and cancels stalled connections without retry', async () => {
  const redirects = fakeHttp(Array.from({ length: 6 }, (_, i) => ({ status: 302, headers: { location: `https://huggingface.co/redirect-${i}` } })))
  await assert.rejects(new ArtifactHttpTransport({ policy: policy(), request: redirects.request }).download(asset, revision, sink().writable, scope(), () => {}), /model_download_redirect/)
  assert.equal(redirects.calls.length, 6)
  const fixture = fakeHttp([{ stall: true }]), controller = new AbortController()
  const work = new ArtifactHttpTransport({ policy: policy(), request: fixture.request }).download(asset, revision, sink().writable, scope(2000, controller), () => {})
  const rejected = assert.rejects(work, /model_download_cancelled/)
  await new Promise(resolve => setImmediate(resolve)); controller.abort(); await rejected
  assert.equal(fixture.calls[0].request.destroyed, true)
  const timeout = fakeHttp([{ stall: true }])
  await assert.rejects(new ArtifactHttpTransport({ policy: policy(), request: timeout.request }).download(asset, revision, sink().writable, scope(15), () => {}), /model_download_timeout/)
})
