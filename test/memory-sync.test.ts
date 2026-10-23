import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { MemoryStore } from '../src/main/memory'
import type { JasperMemory } from '../src/shared/types/memory'
import { isBackendEnvelopeForwardingAllowed } from '../src/main/ipc/register-ipc'

describe('MemoryStore Retention, Installation Binding and Synchronization', () => {
  let tmpDir: string
  let memoryFile: string
  const currentHwid = 'HWID-TEST-1111-2222'

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-memory-test-'))
    memoryFile = path.join(tmpDir, 'memory.json')
  })

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test('initializes default empty store when file does not exist', () => {
    const store = new MemoryStore({ filePath: memoryFile, installationId: currentHwid })
    const mem = store.load()

    assert.equal(mem.userName, '')
    assert.deepEqual(mem.userPreferences, [])
    assert.deepEqual(mem.facts, [])
    assert.equal(mem.installationId, currentHwid)
  })

  test('persists memory atomically with installationId and updatedAt', () => {
    const store = new MemoryStore({ filePath: memoryFile, installationId: currentHwid })
    store.addFact('Usuário prefere código TypeScript tipado')

    assert.ok(fs.existsSync(memoryFile), 'memory.json should exist on disk')
    const raw = JSON.parse(fs.readFileSync(memoryFile, 'utf-8')) as JasperMemory
    assert.equal(raw.installationId, currentHwid)
    assert.ok(raw.updatedAt)
    assert.equal(raw.facts.length, 1)
    assert.equal(raw.facts[0].fact, 'Usuário prefere código TypeScript tipado')
  })

  test('prunes facts older than 30 days on load and save', () => {
    const store = new MemoryStore({ filePath: memoryFile, installationId: currentHwid })
    const now = Date.now()
    const fortyDaysAgo = new Date(now - 40 * 24 * 60 * 60 * 1000).toISOString()
    const fiveDaysAgo = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString()

    const staleMemory: JasperMemory = {
      installationId: currentHwid,
      updatedAt: new Date().toISOString(),
      userName: 'Alice',
      userPreferences: ['Dark Mode'],
      facts: [
        { id: '1', fact: 'Fato expirado', createdAt: fortyDaysAgo },
        { id: '2', fact: 'Fato recente válido', createdAt: fiveDaysAgo },
        { id: '3', fact: 'Fato com data inválida', createdAt: 'invalid-date-string' }
      ]
    }
    fs.writeFileSync(memoryFile, JSON.stringify(staleMemory, null, 2), 'utf-8')

    const loaded = store.load()
    assert.equal(loaded.facts.length, 1)
    assert.equal(loaded.facts[0].fact, 'Fato recente válido')

    // Verify it automatically re-persisted the pruned content
    const reloaded = JSON.parse(fs.readFileSync(memoryFile, 'utf-8')) as JasperMemory
    assert.equal(reloaded.facts.length, 1)
    assert.equal(reloaded.facts[0].id, '2')
  })

  test('rejects memory file from mismatching installationId and resets store', () => {
    const foreignMemory: JasperMemory = {
      installationId: 'HWID-FOREIGN-9999-8888',
      updatedAt: new Date().toISOString(),
      userName: 'ForeignUser',
      userPreferences: ['Secret'],
      facts: [{ id: '1', fact: 'Foreign fact', createdAt: new Date().toISOString() }]
    }
    fs.writeFileSync(memoryFile, JSON.stringify(foreignMemory, null, 2), 'utf-8')

    const store = new MemoryStore({ filePath: memoryFile, installationId: currentHwid })
    const loaded = store.load()

    assert.equal(loaded.installationId, currentHwid)
    assert.equal(loaded.userName, '')
    assert.deepEqual(loaded.facts, [])
  })

  test('sanitizes input and ignores duplicate facts case-insensitively', () => {
    const store = new MemoryStore({ filePath: memoryFile, installationId: currentHwid })
    store.addFact('<script>alert("xss")</script>Gosta de café')
    store.addFact('gosta de café')

    const loaded = store.load()
    assert.equal(loaded.facts.length, 1)
    assert.ok(!loaded.facts[0].fact.includes('<script>'))
    assert.ok(loaded.facts[0].fact.includes('Gosta de café'))
  })

  test('upsertFacts handles bulk updates and sidecar payloads', () => {
    const store = new MemoryStore({ filePath: memoryFile, installationId: currentHwid })
    store.upsertFacts([
      'Prefere terminal Windows PowerShell',
      { fact: 'Utiliza Node.js 24', id: 'node-24', createdAt: new Date().toISOString() }
    ])

    const loaded = store.load()
    assert.equal(loaded.facts.length, 2)
  })

  test('clear resets memory facts while keeping installation binding', () => {
    const store = new MemoryStore({ filePath: memoryFile, installationId: currentHwid })
    store.addFact('Fato temporário')
    assert.equal(store.load().facts.length, 1)

    store.clear()
    const cleared = store.load()
    assert.equal(cleared.facts.length, 0)
    assert.equal(cleared.installationId, currentHwid)
  })
})

describe('Licensed backend memory forwarding', () => {
  test('discards late memory events after lock or from a stale backend session', () => {
    assert.equal(isBackendEnvelopeForwardingAllowed('revoked', 10, 10), false)
    assert.equal(isBackendEnvelopeForwardingAllowed('unlocked', 11, 10), false)
    assert.equal(isBackendEnvelopeForwardingAllowed('unlocked', 11, 11), true)
  })
})
