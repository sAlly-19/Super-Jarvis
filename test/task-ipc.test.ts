import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ipcMain } from 'electron'
import { registerIpcHandlers } from '../src/main/ipc/register-ipc'
import { licenseGate } from '../src/main/services/license-gate'
import { IPC_CHANNELS, LOCKED_ALLOWED_CHANNELS } from '../src/shared/constants/ipc-channels'

test('task IPC fails closed for untrusted frames, locked licenses and malformed task IDs', async () => {
  const ipc = ipcMain as any
  ipc._handlers.clear(); ipc._listeners.clear()
  const original = licenseGate.requireUnlocked
  const mainFrame = { url: 'app://jasper/index.html', parent: null }
  const event = { sender: { isDestroyed: () => false, mainFrame }, senderFrame: mainFrame }
  try {
    registerIpcHandlers({ refresh: async () => {}, assertReady() {} })
    for (const channel of [IPC_CHANNELS.TASKS_LIST, IPC_CHANNELS.TASKS_GET, IPC_CHANNELS.TASKS_CANCEL]) {
      assert.equal(LOCKED_ALLOWED_CHANNELS.has(channel), false)
      const handler = ipc._handlers.get(channel)
      licenseGate.requireUnlocked = () => { throw new Error('license locked') }
      await assert.rejects(Promise.resolve().then(() => handler(event, {})), /license locked/)
      const badFrame = { url: 'https://untrusted.invalid', parent: null }
      await assert.rejects(Promise.resolve().then(() => handler({ sender: { isDestroyed: () => false, mainFrame: badFrame }, senderFrame: badFrame }, {})), /Untrusted/)
    }
    licenseGate.requireUnlocked = () => {}
    for (const channel of [IPC_CHANNELS.TASKS_GET, IPC_CHANNELS.TASKS_CANCEL]) {
      await assert.rejects(Promise.resolve().then(() => ipc._handlers.get(channel)(event, { taskId: 'id', status: 'succeeded' })), /invalid_task_id/)
    }
  } finally { licenseGate.requireUnlocked = original; ipc._handlers.clear(); ipc._listeners.clear() }
})
