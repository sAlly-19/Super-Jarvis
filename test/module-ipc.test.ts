import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertModuleUpdate } from '../src/main/modules/ipc-validation'
import { assertModuleRuntimeReady, refreshModuleRuntime } from '../src/main/modules/application'

test('uninitialized module application fails closed rather than accepting native tool traffic', async () => {
  assert.throws(() => assertModuleRuntimeReady())
  await assert.rejects(refreshModuleRuntime())
})

test('module update accepts only a known ID, boolean toggle and expected revision', () => {
  assert.doesNotThrow(() => assertModuleUpdate({ id: 'computer', enabled: false, expectedRevision: 0 }))
  for (const payload of [null, [], { id: 'unknown', enabled: true, expectedRevision: 0 },
    { id: 'computer', enabled: 'true', expectedRevision: 0 }, { id: 'computer', enabled: true, expectedRevision: -1 },
    { id: 'computer', enabled: true, expectedRevision: 1.5 }, { id: 'computer', enabled: true, expectedRevision: 0, authorized: true }]) {
    assert.throws(() => assertModuleUpdate(payload))
  }
})
