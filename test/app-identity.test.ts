import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { initializeAppIdentity } from '../src/main/services/app-identity'

test('Windows notification identity matches the installer AppUserModelID', () => {
  const appId = /^appId:\s*(\S+)/m.exec(fs.readFileSync('electron-builder.yml', 'utf8'))![1]
  const calls: string[] = []
  initializeAppIdentity({ setAppUserModelId: id => { calls.push(id) } }, 'win32')
  assert.deepEqual(calls, [appId])
  initializeAppIdentity({ setAppUserModelId: () => { throw new Error('Windows-only API called on another platform') } }, 'linux')
})
