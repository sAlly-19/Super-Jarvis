import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { ModuleRegistry } from '../src/main/modules/registry'

const definitions = () => JSON.parse(fs.readFileSync(path.join(process.cwd(), 'resources/modules/native-capabilities.json'), 'utf8'))

test('registry rejects duplicate capabilities and returns isolated definitions', () => {
  const entries = definitions()
  assert.throws(() => new ModuleRegistry([...entries, entries[0]]), /duplicate/)
  const registry = new ModuleRegistry(entries)
  entries[0].moduleId = 'email'
  const first = registry.get('run_powershell')!
  assert.equal(first.moduleId, 'computer')
  assert.throws(() => registry.validateInput('missing', {}), /unknown/)
})

test('native inputs reject unknown fields and invalid types without restricting shell commands', () => {
  const registry = new ModuleRegistry(definitions())
  registry.validateInput('run_powershell', { command: 'Get-Service | Select-Object -First 2' })
  for (const value of [{ command: 7 }, { command: 'test', bypass: true }, {}, []]) {
    assert.throws(() => registry.validateInput('run_powershell', value))
  }
  registry.validateInput('control_system_volume', { action: 'set', level: 50 })
  for (const value of [{ action: 'bad' }, { action: 'set', level: 101 }, { action: 'set', level: NaN }]) {
    assert.throws(() => registry.validateInput('control_system_volume', value))
  }
  assert.throws(() => registry.validateInput('gui_action', { action: 'click', x: 1.5 }))
  assert.throws(() => registry.validateInput('capture_screen_base64', { auto_vision: true }))
  registry.validateInput('capture_screen_base64', {})
})

test('unsupported schema keywords and output types fail closed', () => {
  const entries = definitions()
  entries[0].inputSchema.anyOf = []
  assert.throws(() => new ModuleRegistry(entries), /schema/)
  const registry = new ModuleRegistry(definitions())
  assert.throws(() => registry.validateOutput('run_powershell', undefined))
  registry.validateOutput('run_powershell', 'done')
})
