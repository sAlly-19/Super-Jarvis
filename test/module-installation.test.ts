import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ModuleStore } from '../src/main/modules/store'
import { openModuleStore } from '../src/main/modules/installation'
import { reportStartupFailure } from '../src/main/services/startup-failure'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { getHardwareInfo } from '../src/main/services/hwid'
import { createHash } from 'node:crypto'

test('a transient hardware fallback is refreshed before module initialization without rewriting preferences', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-identity-'))
  try {
    const file = path.join(root, 'modules.json')
    new ModuleStore(file, 'verified-hardware').setEnabled('reminders', true, 0)
    const original = fs.readFileSync(file, 'utf8'); let retries = 0
    const store = openModuleStore(file, () => 'temporary-fallback', () => { retries++; return 'verified-hardware' })
    assert.equal(retries, 1); assert.equal(store.get('reminders').enabled, true)
    assert.equal(fs.readFileSync(file, 'utf8'), original)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('a genuine installation mismatch remains blocked and cannot rebind stored settings', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-identity-'))
  try {
    const file = path.join(root, 'modules.json')
    new ModuleStore(file, 'machine-a').setEnabled('reminders', true, 0)
    const original = fs.readFileSync(file, 'utf8')
    assert.throws(() => openModuleStore(file, () => 'machine-b', () => 'machine-b'), /module_installation_mismatch/)
    assert.equal(fs.readFileSync(file, 'utf8'), original)
    assert.throws(() => openModuleStore(file, () => 'machine-b', () => { throw new Error('hardware unavailable') }), /hardware unavailable/)
    assert.equal(fs.readFileSync(file, 'utf8'), original)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('normal initialization does not refresh hardware and invalid data is preserved', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-identity-'))
  try {
    const file = path.join(root, 'modules.json')
    openModuleStore(file, () => 'machine-a', () => assert.fail('unexpected retry')).setEnabled('computer', false, 0)
    assert.equal(openModuleStore(file, () => 'machine-a', () => assert.fail('unexpected retry')).get('computer').enabled, false)
    fs.writeFileSync(file, '{invalid')
    assert.throws(() => openModuleStore(file, () => 'machine-a', () => assert.fail('unexpected retry')))
    assert.equal(fs.readFileSync(file, 'utf8'), '{invalid')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('startup failures are reported and exit cleanly even when the dialog fails', () => {
  const messages: string[] = [], exits: number[] = []
  reportStartupFailure(new Error('module_installation_mismatch'), { show: (_title, message) => messages.push(message), exit: code => exits.push(code), log: message => messages.push(message) })
  assert.deepEqual(exits, [1]); assert.match(messages.join(' '), /preservados/)
  assert.match(messages[0], /module_installation_mismatch/)
  reportStartupFailure(new Error('private unexpected data'), { show: () => { throw new Error('desktop unavailable') }, exit: code => exits.push(code), log: message => messages.push(message) })
  assert.deepEqual(exits, [1, 1]); assert.doesNotMatch(messages.join(' '), /private unexpected data/)
})

test('Windows identity refresh replaces a cached probe for every consumer and keeps the fingerprint algorithm', { skip: process.platform !== 'win32' }, () => {
  const original = childProcess.execFileSync
  let calls = 0, raw = 'board|cpu|volume|guid', timeout = 0
  childProcess.execFileSync = ((_file: string, _args: string[], options: { timeout: number }) => { calls++; timeout = options.timeout; return raw }) as typeof childProcess.execFileSync
  syncBuiltinESMExports()
  const expected = (value: string) => { const hash = createHash('sha256').update(value).digest('hex').toUpperCase(); return `HWID-${hash.slice(0,4)}-${hash.slice(4,8)}-${hash.slice(8,12)}` }
  try {
    assert.equal(getHardwareInfo({ refresh: true }).machineId, expected(raw))
    assert.equal(timeout, 12000)
    raw = 'verified-board|cpu|volume|guid'
    assert.notEqual(getHardwareInfo().machineId, expected(raw)); assert.equal(calls, 1)
    assert.equal(getHardwareInfo({ refresh: true, timeoutMs: 20000 }).machineId, expected(raw))
    assert.equal(getHardwareInfo().machineId, expected(raw)); assert.equal(calls, 2); assert.equal(timeout, 20000)
  } finally { childProcess.execFileSync = original; syncBuiltinESMExports() }
})
