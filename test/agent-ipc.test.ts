import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ipcMain } from 'electron'
import { IPC_CHANNELS, LOCKED_ALLOWED_CHANNELS } from '../src/shared/constants/ipc-channels'
import {
  registerIpcHandlers,
  assertConfigPayload,
  assertTrustedSender,
  assertTextPayload,
  assertAudioPayload,
  isBackendEnvelopeForwardingAllowed
} from '../src/main/ipc/register-ipc'
import { licenseGate } from '../src/main/services/license-gate'
import { pythonBackend } from '../src/main/services/python-backend'
import { configStore } from '../src/main/config/config-store'
import { operationalAccess } from '../src/main/services/operational-access'
import type { BackendEnvelope } from '../src/shared/types/backend-protocol'

function createMockIpcEvent(options: {
  url?: string
  isIframe?: boolean
  isDestroyed?: boolean
} = {}): any {
  const url = options.url ?? 'app://jasper/index.html'
  const isIframe = options.isIframe ?? false
  const isDestroyed = options.isDestroyed ?? false

  const mainFrame = {
    url,
    parent: null
  }

  const senderFrame = isIframe
    ? { url: 'https://evil.com/iframe.html', parent: mainFrame }
    : mainFrame

  const webContents = {
    isDestroyed: () => isDestroyed,
    mainFrame,
    send: (_channel: string, ..._args: any[]) => {}
  }

  return {
    sender: webContents,
    senderFrame
  }
}

describe('Agent IPC Security and Boundary Enforcement', () => {
  test('assertTrustedSender accepts main frame from app origin or dev url', () => {
    const validEvent = createMockIpcEvent({ url: 'app://jasper/index.html' })
    assert.doesNotThrow(() => assertTrustedSender(validEvent))

    process.env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173'
    try {
      const devEvent = createMockIpcEvent({ url: 'http://localhost:5173' })
      assert.doesNotThrow(() => assertTrustedSender(devEvent))
    } finally {
      delete process.env['ELECTRON_RENDERER_URL']
    }
  })

  test('assertTrustedSender rejects iframe senders', () => {
    const iframeEvent = createMockIpcEvent({ isIframe: true })
    assert.throws(
      () => assertTrustedSender(iframeEvent),
      /Untrusted IPC sender frame/i
    )
  })

  test('assertTrustedSender rejects untrusted external URLs', () => {
    const evilEvent = createMockIpcEvent({ url: 'https://malicious-site.com' })
    assert.throws(
      () => assertTrustedSender(evilEvent),
      /Untrusted IPC sender origin/i
    )
  })

  test('assertTextPayload enforces 20,000 character limit', () => {
    assert.doesNotThrow(() => assertTextPayload('Hello Jasper'))
    assert.doesNotThrow(() => assertTextPayload('A'.repeat(20000)))

    assert.throws(() => assertTextPayload('A'.repeat(20001)), /excede limite de 20/i)
    assert.throws(() => assertTextPayload(123 as any), /Payload de texto inválido/i)
  })

  test('assertAudioPayload enforces 16 MiB boundary', () => {
    const validChunk = Buffer.alloc(1024)
    assert.doesNotThrow(() => assertAudioPayload(validChunk))

    const validArrayBuffer = new ArrayBuffer(512)
    assert.doesNotThrow(() => assertAudioPayload(validArrayBuffer))

    const oversized = Buffer.alloc(16 * 1024 * 1024 + 1)
    assert.throws(() => assertAudioPayload(oversized), /excede o limite de 16 MiB/i)
    assert.throws(() => assertAudioPayload('not-a-buffer' as any), /Payload de áudio inválido/i)
  })

  test('assertConfigPayload enforces provider allow-list, credential limits and unknown fields', () => {
    assert.doesNotThrow(() => assertConfigPayload({
      aiProvider: 'gemini',
      geminiApiKey: 'g'.repeat(512),
      groqApiKey: 'q'.repeat(512)
    }))
    assert.throws(() => assertConfigPayload({ geminiApiKey: 'g'.repeat(513) }), /geminiApiKey.*inv.*lido/i)
    assert.throws(() => assertConfigPayload({ groqApiKey: 'q'.repeat(513) }), /groqApiKey.*inv.*lido/i)
    assert.throws(() => assertConfigPayload({ aiProvider: 'openai' }), /provedor.*inv.*lido/i)
    assert.throws(() => assertConfigPayload({ aiProvider: 'gemini\0' }), /provedor.*inv.*lido/i)
    assert.throws(() => assertConfigPayload({ unknownSetting: true }), /n.*o permitido/i)
  })
})

describe('Agent High-Level IPC Channels Definition', () => {
  test('Live uses Gemini credential independently of Groq and enforces consent', async () => {
    const ipc = ipcMain as any
    ipc._handlers.clear()
    ipc._listeners.clear()
    const originalGate = licenseGate.requireUnlocked
    const originalAccess = operationalAccess.requireAgentAccess
    const originalConfig = configStore.getConfig
    const originalRemove = configStore.removeProviderCredential
    const originalHealthy = pythonBackend.isHealthy
    const originalRequest = pythonBackend.request
    const originalState = pythonBackend.getState
    const requests: Array<{type: string; payload: any}> = []
    licenseGate.requireUnlocked = () => {}
    operationalAccess.requireAgentAccess = () => {}
    configStore.getConfig = () => ({ aiProvider: 'groq', geminiApiKey: 'gemini-live-secret', groqApiKey: 'groq-chat-secret', voiceName: 'Kore' } as any)
    configStore.removeProviderCredential = () => configStore.getConfig()
    pythonBackend.isHealthy = async () => true
    pythonBackend.getState = () => 'ready'
    pythonBackend.request = async (type: any, payload: unknown) => { requests.push({type, payload}); return {} as any }
    try {
      registerIpcHandlers()
      const event = createMockIpcEvent()
      const start = ipc._handlers.get(IPC_CHANNELS.AGENT_LIVE_START)
      const result = await start(event, true)
      assert.equal(result.success, true)
      assert.deepEqual(requests[0], {type: 'live_start', payload: {apiKey: 'gemini-live-secret', voice: 'Kore', greeting: true}})
      assert.doesNotMatch(JSON.stringify(result), /secret/)
      await ipc._handlers.get(IPC_CHANNELS.CONFIG_REMOVE_CREDENTIAL)(event, 'gemini')
      assert.equal(requests[1]?.type, 'live_stop', 'removing Gemini key must close independent live call')
      await ipc._handlers.get(IPC_CHANNELS.AGENT_LIVE_STOP)(event)
      assert.equal(requests[2].type, 'live_stop')
      let releaseStart: ((value: unknown) => void) | undefined
      pythonBackend.request = async (type: any, payload: unknown) => {
        requests.push({type, payload})
        if (type === 'live_start') return await new Promise(resolve => { releaseStart = resolve }) as any
        return {} as any
      }
      const pendingStart = start(event, false)
      for (let i = 0; i < 10 && !releaseStart; i++) await Promise.resolve()
      assert.ok(releaseStart, 'connection must be pending')
      assert.equal((await start(event, false)).success, false, 'overlapping start must be refused')
      await ipc._handlers.get(IPC_CHANNELS.CONFIG_REMOVE_CREDENTIAL)(event, 'gemini')
      releaseStart!({})
      assert.equal((await pendingStart).success, false, 'removing a key invalidates a pending connection')
      operationalAccess.requireAgentAccess = () => { throw new Error('consent required') }
      await assert.rejects(start(event, false), /consent required/)
    } finally {
      licenseGate.requireUnlocked = originalGate
      operationalAccess.requireAgentAccess = originalAccess
      configStore.getConfig = originalConfig
      configStore.removeProviderCredential = originalRemove
      pythonBackend.isHealthy = originalHealthy
      pythonBackend.request = originalRequest
      pythonBackend.getState = originalState
      ipc._handlers.clear()
      ipc._listeners.clear()
    }
  })
  test('IPC_CHANNELS defines all typed AGENT_* channels', () => {
    assert.ok(IPC_CHANNELS.AGENT_CONNECT, 'AGENT_CONNECT must be defined')
    assert.ok(IPC_CHANNELS.AGENT_DISCONNECT, 'AGENT_DISCONNECT must be defined')
    assert.ok(IPC_CHANNELS.AGENT_SEND_TEXT, 'AGENT_SEND_TEXT must be defined')
    assert.ok(IPC_CHANNELS.AGENT_SEND_AUDIO, 'AGENT_SEND_AUDIO must be defined')
    assert.ok(IPC_CHANNELS.AGENT_INTERRUPT, 'AGENT_INTERRUPT must be defined')
    assert.ok(IPC_CHANNELS.AGENT_GET_STATUS, 'AGENT_GET_STATUS must be defined')

    assert.ok(IPC_CHANNELS.AGENT_STATUS, 'AGENT_STATUS must be defined')
    assert.ok(IPC_CHANNELS.AGENT_TEXT, 'AGENT_TEXT must be defined')
    assert.ok(IPC_CHANNELS.AGENT_AUDIO, 'AGENT_AUDIO must be defined')
    assert.ok(IPC_CHANNELS.AGENT_USER_TRANSCRIPT, 'AGENT_USER_TRANSCRIPT must be defined')
    assert.ok(IPC_CHANNELS.AGENT_TOOL_EXECUTION, 'AGENT_TOOL_EXECUTION must be defined')
    assert.ok(IPC_CHANNELS.AGENT_TOOL_RESULT, 'AGENT_TOOL_RESULT must be defined')
    assert.ok(IPC_CHANNELS.AGENT_TURN_COMPLETE, 'AGENT_TURN_COMPLETE must be defined')
    assert.ok(IPC_CHANNELS.AGENT_INTERRUPTED, 'AGENT_INTERRUPTED must be defined')
    assert.ok(IPC_CHANNELS.AGENT_ERROR, 'AGENT_ERROR must be defined')
  })

  test('license state has one canonical renderer event channel', () => {
    assert.equal(IPC_CHANNELS.LICENSE_STATUS_CHANGED, 'license:status-changed')
    assert.equal('LICENSE_REVOKED' in IPC_CHANNELS, false)
  })

  test('locked IPC allowlist contains only licensing and basic window controls', () => {
    assert.deepEqual([...LOCKED_ALLOWED_CHANNELS].sort(), [
      IPC_CHANNELS.LICENSE_ACTIVATE,
      IPC_CHANNELS.LICENSE_GET_HWID,
      IPC_CHANNELS.LICENSE_GET_STATUS,
      IPC_CHANNELS.WINDOW_CLOSE,
      IPC_CHANNELS.WINDOW_MAXIMIZE,
      IPC_CHANNELS.WINDOW_MINIMIZE,
      IPC_CHANNELS.WINDOW_TOGGLE_FULLSCREEN,
      IPC_CHANNELS.WINDOW_TOGGLE_PIP
    ].sort())
  })

  test('every registered operational IPC handler is denied while locked', async () => {
    const ipc = ipcMain as any
    ipc._handlers.clear()
    ipc._listeners.clear()
    const originalRequireUnlocked = licenseGate.requireUnlocked
    licenseGate.requireUnlocked = () => {
      throw new Error('license gate locked')
    }

    try {
      registerIpcHandlers()
      const event = createMockIpcEvent()
      const invokedChannels = [
        IPC_CHANNELS.AGENT_CONNECT,
        IPC_CHANNELS.AGENT_DISCONNECT,
        IPC_CHANNELS.AGENT_GET_STATUS,
        IPC_CHANNELS.AGENT_LIVE_START,
        IPC_CHANNELS.AGENT_LIVE_STOP,
        IPC_CHANNELS.CONSENT_GET_STATUS,
        IPC_CHANNELS.CONSENT_ACCEPT,
        IPC_CHANNELS.CONFIG_GET,
        IPC_CHANNELS.CONFIG_SAVE,
        IPC_CHANNELS.CONFIG_REMOVE_CREDENTIAL,
        IPC_CHANNELS.MEMORY_GET,
        IPC_CHANNELS.MEMORY_CLEAR,
        IPC_CHANNELS.DIALOG_SELECT_DIRECTORY,
        IPC_CHANNELS.UPDATE_GET_STATE,
        IPC_CHANNELS.UPDATE_CHECK,
        IPC_CHANNELS.UPDATE_DOWNLOAD,
        IPC_CHANNELS.UPDATE_INSTALL
      ]
      for (const channel of invokedChannels) {
        const handler = ipc._handlers.get(channel)
        assert.equal(typeof handler, 'function', `missing handler for ${channel}`)
        await assert.rejects(Promise.resolve().then(() => handler(event, {})), /license gate locked/i, channel)
      }

      for (const channel of [IPC_CHANNELS.AGENT_SEND_TEXT, IPC_CHANNELS.AGENT_SEND_AUDIO, IPC_CHANNELS.AGENT_INTERRUPT, IPC_CHANNELS.AGENT_LIVE_AUDIO]) {
        const listener = ipc._listeners.get(channel)
        assert.equal(typeof listener, 'function', `missing listener for ${channel}`)
        assert.throws(() => listener(event, ''), /license gate locked/i, channel)
      }
    } finally {
      licenseGate.requireUnlocked = originalRequireUnlocked
      ipc._handlers.clear()
      ipc._listeners.clear()
    }
  })

  test('backend output requires both unlocked state and the current backend session', () => {
    assert.equal(isBackendEnvelopeForwardingAllowed('locked', 7, 7), false)
    assert.equal(isBackendEnvelopeForwardingAllowed('expired', 7, 7), false)
    assert.equal(isBackendEnvelopeForwardingAllowed('unlocked', 8, 7), false)
    assert.equal(isBackendEnvelopeForwardingAllowed('unlocked', 8, 8), true)
  })

  test('configuration save reports missing credential, offline and synchronized outcomes', async () => {
    const ipc = ipcMain as any
    ipc._handlers.clear()
    ipc._listeners.clear()
    const originalRequireUnlocked = licenseGate.requireUnlocked
    const originalGetConfig = configStore.getConfig
    const originalUpdateConfig = configStore.updateConfig
    const originalSyncConfig = pythonBackend.syncConfig
    const originalGetState = pythonBackend.getState
    let currentConfig = {
      aiProvider: 'gemini',
      geminiApiKey: '',
      groqApiKey: 'gsk_inactive',
      model: 'gemini/gemini-3.8-flash',
      voiceName: 'Charon',
      agentName: 'Jasper',
      checkUpdatesDaily: true,
      enableWakeWord: true,
      enableBloom: true,
      enableNeuralBg: true,
      enableEyeTracking: true,
      enableScreenAwareness: true,
      licenseStatus: 'active'
    } as any
    let syncCalls = 0
    let syncResult = false

    licenseGate.requireUnlocked = () => {}
    configStore.getConfig = () => ({ ...currentConfig })
    configStore.updateConfig = (payload: any) => {
      currentConfig = { ...currentConfig, ...payload }
      return { ...currentConfig }
    }
    pythonBackend.syncConfig = async () => {
      syncCalls++
      return syncResult
    }
    pythonBackend.getState = () => 'stopped'

    try {
      registerIpcHandlers()
      const handler = ipc._handlers.get(IPC_CHANNELS.CONFIG_SAVE)
      const event = createMockIpcEvent()

      const missing = await handler(event, {
        aiProvider: 'gemini',
        model: 'gemini/gemini-3.8-flash'
      })
      assert.equal(missing.runtimeStatus, 'missing-credential')
      assert.equal(syncCalls, 0)

      currentConfig.geminiApiKey = 'configured-secret'
      const offline = await handler(event, { voiceName: 'Jenny' })
      assert.equal(offline.runtimeStatus, 'offline')
      assert.equal(syncCalls, 1)

      syncResult = true
      const synced = await handler(event, { agentName: 'Jasper Pro' })
      assert.equal(synced.runtimeStatus, 'synced')
      assert.equal(syncCalls, 2)

      const visual = await handler(event, { enableBloom: false })
      assert.equal(visual.runtimeStatus, 'offline')
      assert.equal(syncCalls, 2, 'visual-only changes must not synchronize the backend')
    } finally {
      licenseGate.requireUnlocked = originalRequireUnlocked
      configStore.getConfig = originalGetConfig
      configStore.updateConfig = originalUpdateConfig
      pythonBackend.syncConfig = originalSyncConfig
      pythonBackend.getState = originalGetState
      ipc._handlers.clear()
      ipc._listeners.clear()
    }
  })

  test('agent connection refuses a missing active remote credential before health probing', async () => {
    const ipc = ipcMain as any
    ipc._handlers.clear()
    ipc._listeners.clear()
    const originalRequireUnlocked = licenseGate.requireUnlocked
    const originalGetConfig = configStore.getConfig
    const originalIsHealthy = pythonBackend.isHealthy
    let healthCalls = 0

    licenseGate.requireUnlocked = () => {}
    configStore.getConfig = () => ({
      aiProvider: 'groq',
      geminiApiKey: 'gemini-inactive',
      groqApiKey: '',
      model: 'groq/openai/gpt-oss-120b',
      licenseStatus: 'active'
    } as any)
    pythonBackend.isHealthy = async () => { healthCalls++; return true }

    try {
      registerIpcHandlers()
      const handler = ipc._handlers.get(IPC_CHANNELS.AGENT_CONNECT)
      const result = await handler(createMockIpcEvent())
      assert.equal(result.success, false)
      assert.match(result.error, /credencial.*Groq/i)
      assert.equal(healthCalls, 0)
    } finally {
      licenseGate.requireUnlocked = originalRequireUnlocked
      configStore.getConfig = originalGetConfig
      pythonBackend.isHealthy = originalIsHealthy
      ipc._handlers.clear()
      ipc._listeners.clear()
    }
  })

  test('credential removal disconnects only the active remote provider', async () => {
    const ipc = ipcMain as any
    ipc._handlers.clear()
    ipc._listeners.clear()
    const originalRequireUnlocked = licenseGate.requireUnlocked
    const originalGetConfig = configStore.getConfig
    const originalRemove = configStore.removeProviderCredential
    const originalStop = pythonBackend.stop
    const originalSyncConfig = pythonBackend.syncConfig
    const originalGetState = pythonBackend.getState
    let activeProvider: 'gemini' | 'groq' = 'gemini'
    let stopCalls = 0
    let syncCalls = 0

    licenseGate.requireUnlocked = () => {}
    configStore.getConfig = () => ({ aiProvider: activeProvider } as any)
    configStore.removeProviderCredential = () => ({ aiProvider: activeProvider } as any)
    pythonBackend.stop = async () => { stopCalls++ }
    pythonBackend.syncConfig = async () => { syncCalls++; return true }
    pythonBackend.getState = () => 'ready'

    try {
      registerIpcHandlers()
      const handler = ipc._handlers.get(IPC_CHANNELS.CONFIG_REMOVE_CREDENTIAL)
      const event = createMockIpcEvent()

      const inactive = await handler(event, 'groq')
      assert.equal(inactive.runtimeStatus, 'synced')
      assert.equal(stopCalls, 0)
      assert.equal(syncCalls, 0)

      const active = await handler(event, 'gemini')
      assert.equal(active.runtimeStatus, 'missing-credential')
      assert.equal(stopCalls, 1)
      assert.equal(syncCalls, 0)
      assert.match(active.message, /Gemini/i)
    } finally {
      licenseGate.requireUnlocked = originalRequireUnlocked
      configStore.getConfig = originalGetConfig
      configStore.removeProviderCredential = originalRemove
      pythonBackend.stop = originalStop
      pythonBackend.syncConfig = originalSyncConfig
      pythonBackend.getState = originalGetState
      ipc._handlers.clear()
      ipc._listeners.clear()
    }
  })
})
