import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { startWebResearchApplication } from '../src/main/modules/web-research/application'
import { webDatabase } from './fixtures/web/database'
import { ModuleRegistry } from '../src/main/modules/registry'
import type { ExecutionContext } from '../src/shared/types/modules'
const context: ExecutionContext = { taskId: 'task', stepId: 'step', invocationId: 'web1', sessionId: 2, moduleRevision: 0 }
const signal = () => new AbortController().signal
function setup() {
  const database = webDatabase()
  let allowed = true, available = true, session = 2, revision = 0, now = Date.now(), calls = 0
  const mask = (bytes: Uint8Array) => Uint8Array.from(bytes, byte => byte ^ 0xa5)
  const app = startWebResearchApplication({ database,
    crypto: { available: () => available, encrypt: text => mask(Buffer.from(text)), decrypt: bytes => Buffer.from(mask(bytes)).toString() },
    transport: { async fetch(url) { calls++; return { url, status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from(url.includes('duckduckgo') ? '<div class="result"><a class="result__a" href="https://example.org/article">Title</a></div>' : '<article>Actual content.</article>') } } },
    authorizeAgent: () => { if (!allowed) throw Error('revoked') }, authorizeManagement: () => { if (!allowed) throw Error('revoked') },
    moduleRevision: () => revision, sessionId: () => session, changed() {}, sources() {}, now: () => now })
  return { app, database, calls: () => calls, revoke: () => { allowed = false }, crypto: (v: boolean) => { available = v },
    session: () => { session++ }, revision: () => { revision++ }, clock: () => { now += 300001 } }
}

test('web service uses strict capability schemas and exact observed proof', async () => {
  const registry = new ModuleRegistry(JSON.parse(fs.readFileSync('resources/modules/native-capabilities.json', 'utf8')))
  for (const id of ['web_search', 'web_read', 'web_history_list', 'web_history_get']) assert.ok(registry.get(id))
  assert.throws(() => registry.validateInput('web_search', { query: 'Question', extra: true }))
  assert.throws(() => registry.validateInput('web_search', { query: 'x'.repeat(501) }))
  const s = setup()
  try {
    const data = await s.app.service.execute('web_search', { query: 'Question' }, context, signal())
    assert.equal(data.kind, 'search')
    if (data.kind !== 'search') return
    assert.equal(data.outcome.state, 'ok'); assert.ok(data._historyReceipt)
    const result = { status: 'unknown' as const, data, evidence: [] }
    assert.equal(s.app.service.verify(context, 'web_search', result).status, 'succeeded')
    assert.equal(s.app.service.verify(context, 'web_search', { ...result, data: { ...data, researchId: 'forged' } }).status, 'unknown')
    await s.app.service.execute('web_read', { url: 'https://example.org/article', researchId: data.researchId }, { ...context, invocationId: 'web2' }, signal())
    assert.equal(s.app.history.get(data.researchId)?.pages.length, 1)
    const calls = s.calls()
    await s.app.service.execute('web_history_list', {}, { ...context, invocationId: 'web3' }, signal())
    assert.equal(s.calls(), calls)
    await s.app.stop()
    assert.equal(s.app.service.verify(context, 'web_search', result).status, 'unknown')
  } finally { await s.app.stop(); s.database.close() }
})

test('web service rejects late content after clear or revocation and stop cancels pending work', async () => {
  for (const action of ['clear', 'revoke', 'stop'] as const) {
    const database = webDatabase()
    let allowed = true, release!: () => void, started!: () => void
    const ready = new Promise<void>(resolve => { started = resolve })
    const pending = new Promise<void>(resolve => { release = resolve })
    const app = startWebResearchApplication({ database,
      crypto: { available: () => true, encrypt: text => Buffer.from(text).reverse(), decrypt: bytes => Buffer.from(bytes).reverse().toString() },
      transport: { async fetch(url) { started(); await pending; return { url, status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<article>Late</article>') } } },
      authorizeAgent: () => { if (!allowed) throw Error('revoked') }, authorizeManagement() {}, moduleRevision: () => 0, sessionId: () => 2, changed() {}, sources() { throw Error('late_source_delivered') } })
    try {
      const result = app.service.execute('web_read', { url: 'https://example.org/article' }, context, signal())
      const rejection = assert.rejects(result)
      await ready
      if (action === 'clear') app.clear(0)
      else if (action === 'stop') await app.stop()
      else allowed = false
      release(); await rejection
      assert.equal(app.history.list().items.some(item => item.pageCount > 0), false)
    } finally { release(); await app.stop(); database.close() }
  }
})

test('web service closes association after summary, expiry, clear or changed session/revision', async () => {
  for (const change of ['summary', 'expire', 'clear', 'session', 'revision'] as const) {
    const s = setup()
    try {
      const data = await s.app.service.execute('web_search', { query: 'Question' }, context, signal())
      if (data.kind !== 'search') throw Error('wrong kind')
      if (change === 'summary') {
        const r = data._historyReceipt!
        assert.equal(s.app.acceptNote({ researchId: r.researchId, ticket: r.ticket, sessionId: r.sessionId, summary: 'Summary' }, 2), true)
      } else if (change === 'expire') s.clock()
      else if (change === 'clear') s.app.clear(s.app.history.list().generation)
      else if (change === 'session') s.session()
      else s.revision()
      const calls = s.calls()
      await assert.rejects(s.app.service.execute('web_read', { url: 'https://example.org/article', researchId: data.researchId }, context, signal()))
      assert.equal(s.calls(), calls)
    } finally { await s.app.stop(); s.database.close() }
  }
})

test('web service keeps volatile records without plaintext persistence or later silent promotion', async () => {
  const s = setup()
  try {
    s.crypto(false)
    const data = await s.app.service.execute('web_search', { query: 'Question' }, context, signal())
    if (data.kind !== 'search') throw Error('wrong kind')
    assert.equal(data.historyStorage, 'volatile'); assert.equal(s.app.history.list().storage, 'unavailable')
    s.crypto(true)
    await s.app.service.execute('web_read', { url: 'https://example.org/article', researchId: data.researchId }, { ...context, invocationId: 'read' }, signal())
    assert.equal(s.app.history.list().items.length, 0)
    assert.equal(s.database.transaction(tx => tx.prepare('SELECT count(*) AS n FROM web_research_history').get()!.n), 0)
    s.revoke()
    await assert.rejects(s.app.service.execute('web_history_list', {}, context, signal()))
  } finally { await s.app.stop(); s.database.close() }
})

test('storage loss during a successful fetch is reported as volatile without losing the network result', async () => {
  const database = webDatabase()
  let available = true
  const app = startWebResearchApplication({ database,
    crypto: { available: () => available, encrypt: text => Buffer.from(text).reverse(), decrypt: bytes => Buffer.from(bytes).reverse().toString() },
    transport: { async fetch(url) { available = false; return { url, status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<article>Actual result.</article>') } } },
    authorizeAgent() {}, authorizeManagement() {}, moduleRevision: () => 0, sessionId: () => 2, changed() {}, sources() {} })
  try {
    const data = await app.service.execute('web_read', { url: 'https://example.org/article' }, context, signal())
    if (data.kind !== 'read') throw Error('wrong kind')
    assert.equal(data.outcome.state, 'ok'); assert.equal(data.historyStorage, 'volatile')
    assert.equal(app.get(data.researchId)?.pages[0].text, 'Actual result.')
    available = true
    assert.equal(app.history.get(data.researchId)?.pages.length, 0, 'original ciphertext must stay unchanged')
  } finally { await app.stop(); database.close() }
})

test('authorized cancellation closes the saved research instead of leaving it running forever', async () => {
  const database = webDatabase(), controller = new AbortController()
  let started!: () => void, release!: () => void
  const ready = new Promise<void>(resolve => { started = resolve }), wait = new Promise<void>(resolve => { release = resolve })
  const app = startWebResearchApplication({ database,
    crypto: { available: () => true, encrypt: text => Buffer.from(text).reverse(), decrypt: bytes => Buffer.from(bytes).reverse().toString() },
    transport: { async fetch(url) { started(); await wait; return { url, status: 200, headers: {}, body: new Uint8Array() } } },
    authorizeAgent() {}, authorizeManagement() {}, moduleRevision: () => 0, sessionId: () => 2, changed() {}, sources() {} })
  try {
    const request = app.service.execute('web_read', { url: 'https://example.org/article' }, context, controller.signal)
    const rejection = assert.rejects(request)
    await ready; controller.abort(); release(); await rejection
    assert.equal(app.history.list().items[0].state, 'cancelled')
    assert.equal(app.history.list().items[0].summaryState, 'unavailable')
  } finally { release(); await app.stop(); database.close() }
})
