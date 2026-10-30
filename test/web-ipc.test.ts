import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerWebResearchIpc } from '../src/main/ipc/web-research-ipc'
import { IPC_CHANNELS as C } from '../src/shared/constants/ipc-channels'
test('web IPC rejects frames, invalid payloads and non-member or unsafe source links', async () => {
  const handlers = new Map<string, Function>(), frame = {}, contents = { mainFrame: frame }, event = { sender: contents, senderFrame: frame }
  let network = 0, cleared = 0, opened = ''
  const record = { results: [{ url: 'https://example.org/article' }], pages: [] }
  registerWebResearchIpc(() => {}, { handle: (channel, fn) => { handlers.set(channel, fn) }, window: () => ({ isDestroyed: () => false, webContents: contents }) as any,
    application: () => ({ list: () => ({ generation: 0, storage: 'saved', items: [] }), get: () => record,
      clear: () => { cleared++; return {} }, testConnection: () => { network++; return {} } }) as any,
    openExternal: async url => { opened = url } })
  assert.throws(() => handlers.get(C.WEB_RESEARCH_HISTORY_LIST)!({ ...event, senderFrame: {} }))
  handlers.get(C.WEB_RESEARCH_HISTORY_LIST)!(event)
  assert.equal(network, 0)
  assert.throws(() => handlers.get(C.WEB_RESEARCH_HISTORY_CLEAR)!(event, { expectedGeneration: -1 }))
  assert.equal(cleared, 0)
  const id = '11111111-1111-4111-8111-111111111111'
  for (const url of ['javascript:alert(1)', 'file:///x', 'https://example.org/other', 'https://u:p@example.org/article']) {
    await assert.rejects(async () => handlers.get(C.WEB_RESEARCH_OPEN_SOURCE)!(event, { id, url }))
  }
  await handlers.get(C.WEB_RESEARCH_OPEN_SOURCE)!(event, { id, url: 'https://example.org/article' })
  assert.equal(opened, 'https://example.org/article')
})
