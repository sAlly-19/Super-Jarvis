import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { IPC_CHANNELS } from '../src/shared/constants/ipc-channels'
import {
  registerIpcHandlers,
  assertTrustedSender,
  assertTextPayload,
  assertAudioPayload
} from '../src/main/ipc/register-ipc'
import { licenseGate } from '../src/main/services/license-gate'
import { pythonBackend } from '../src/main/services/python-backend'
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
})

describe('Agent High-Level IPC Channels Definition', () => {
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
})
