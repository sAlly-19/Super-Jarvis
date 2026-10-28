import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerEmailIpc } from '../src/main/ipc/email-ipc'
import { IPC_CHANNELS } from '../src/shared/constants/ipc-channels'
test('email IPC rejects false windows and extra authority before accessing account application', async () => {
  const handlers = new Map<string, (event: any, payload?: unknown) => any>(), sender = { mainFrame: {} }
  let accessed = 0, guarded = 0
  const application: any = { state: () => ({ accounts: [], preferences: { defaultAccountId: null, revision: 0 } }), connect: async (provider: string) => provider }
  registerEmailIpc(() => { guarded++ }, { handle: (channel, handler) => { handlers.set(channel, handler) }, window: () => ({ webContents: sender, isDestroyed: () => false }), application: () => { accessed++; return application } })
  const invoke = (channel: string, payload?: unknown, event = { sender, senderFrame: sender.mainFrame }) => handlers.get(channel)!(event, payload)
  assert.throws(() => invoke(IPC_CHANNELS.EMAIL_ACCOUNTS, undefined, { sender: {} as any, senderFrame: {} }), /untrusted_email_window/)
  assert.equal(accessed, 0); assert.equal(guarded, 1)
  assert.throws(() => invoke(IPC_CHANNELS.EMAIL_CONNECT, { provider: 'gmail', token: 'untrusted' }), /invalid_email_ipc/)
  assert.equal(accessed, 0)
  assert.equal(await invoke(IPC_CHANNELS.EMAIL_CONNECT, { provider: 'gmail' }), 'gmail')
  assert.throws(() => invoke(IPC_CHANNELS.EMAIL_DISCONNECT, { id: 'a', expectedRevision: -1 }), /invalid_email_ipc/)
  assert.equal(handlers.size, 7)
})
