import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
test('final package contains health worker, dependency, migration, panel and read-only capability', () => {
  const asar = createRequire(path.resolve('package.json'))('@electron/asar')
  const archive = path.resolve('release/win-unpacked/resources/app.asar')
  const extract = (name: string) => asar.extractFile(archive, path.join(...name.split('/'))).toString()
  for (const name of ['out/main/pc-health-worker.js', 'src/main/storage/migrations/007-pc-health.sql', 'node_modules/systeminformation/package.json']) assert.ok(extract(name).length)
  assert.match(extract('out/renderer/index.html'), /pc-health-panel/)
  const registry = JSON.parse(extract('resources/modules/native-capabilities.json'))
  assert.deepEqual(registry.filter((entry: any) => entry.moduleId === 'pc-health').map((entry: any) => entry.id), ['pc_health_read'])
})
