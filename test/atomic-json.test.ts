import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { atomicWriteJsonSync, readJsonFileSync } from '../src/main/utils/atomic-json'
import { ModuleStore } from '../src/main/modules/store'
import { MemoryStore } from '../src/main/memory'

test('post-commit backup cleanup failure does not report a committed write as failed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-atomic-json-'))
  const filename = path.join(root, 'state.json')
  try {
    atomicWriteJsonSync(filename, { revision: 1 })
    const original = fs.unlinkSync
    try {
      fs.unlinkSync = ((target: fs.PathLike) => {
        if (String(target) === `${filename}.bak`) throw new Error('simulated backup cleanup failure')
        original(target)
      }) as typeof fs.unlinkSync
      assert.doesNotThrow(() => atomicWriteJsonSync(filename, { revision: 2 }))
      assert.deepEqual(readJsonFileSync(filename), { revision: 2 })
      assert.deepEqual(JSON.parse(fs.readFileSync(`${filename}.bak`, 'utf8')), { revision: 1 })
    } finally { fs.unlinkSync = original }
    atomicWriteJsonSync(filename, { revision: 3 })
    assert.deepEqual(readJsonFileSync(filename), { revision: 3 })
    assert.equal(fs.existsSync(`${filename}.bak`), false)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('failure before commit restores the old file and propagates the write error', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-atomic-json-'))
  const filename = path.join(root, 'state.json')
  try {
    atomicWriteJsonSync(filename, { revision: 1 })
    const original = fs.renameSync
    try {
      fs.renameSync = ((from: fs.PathLike, to: fs.PathLike) => {
        if (String(from).startsWith(`${filename}.tmp.`)) throw new Error('simulated commit failure')
        original(from, to)
      }) as typeof fs.renameSync
      assert.throws(() => atomicWriteJsonSync(filename, { revision: 2 }), /commit failure/)
      assert.deepEqual(readJsonFileSync(filename), { revision: 1 })
      assert.deepEqual(fs.readdirSync(root), ['state.json'])
    } finally { fs.renameSync = original }
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('module and memory consumers retain successful state when only backup cleanup fails', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-atomic-consumers-'))
  const moduleFile = path.join(root, 'modules.json')
  const memoryFile = path.join(root, 'memory.json')
  try {
    const modules = new ModuleStore(moduleFile, 'test-installation')
    modules.setEnabled('computer', false, 0)
    const memory = new MemoryStore({ filePath: memoryFile, installationId: 'test-installation' })
    memory.upsertFacts(['Primeiro fato'])
    const original = fs.unlinkSync
    try {
      fs.unlinkSync = ((target: fs.PathLike) => {
        if ([`${moduleFile}.bak`, `${memoryFile}.bak`].includes(String(target))) throw new Error('simulated cleanup failure')
        original(target)
      }) as typeof fs.unlinkSync
      assert.deepEqual(modules.setEnabled('computer', true, 1), { enabled: true, revision: 2 })
      memory.upsertFacts(['Segundo fato'])
      assert.equal(new ModuleStore(moduleFile, 'test-installation').get('computer').revision, 2)
      assert.equal(memory.load().facts.length, 2)
    } finally { fs.unlinkSync = original }
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
