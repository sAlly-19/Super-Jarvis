import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createRequire } from 'node:module'

test('final ASAR contains reminder migrations, isolated worker, runtime library and its license', () => {
  const asar = createRequire(path.resolve('package.json'))('@electron/asar')
  const archive = path.resolve('release/win-unpacked/resources/app.asar')
  const extract = (name: string) => asar.extractFile(archive, path.join(...name.split('/')))
  for (const name of ['out/main/reminders-ical-worker.js', 'src/main/storage/migrations/005-reminders.sql', 'src/main/storage/migrations/006-reminder-imports.sql', 'resources/licenses/ical.js-LICENSE.txt', 'node_modules/ical.js/package.json']) {
    assert.ok(extract(name).length > 0, `Missing reminder resource: ${name}`)
  }
  const worker = extract('out/main/reminders-ical-worker.js').toString()
  const chunks = [...worker.matchAll(/(?:require\(|from\s+)["'](\.\/chunks\/[^"']+)["']/g)].map(match => `out/main/${match[1].slice(2)}`)
  assert.ok(chunks.length > 0, 'Worker must reference its bundled codec')
  for (const name of chunks) assert.ok(extract(name).length > 0)
  const registry = JSON.parse(extract('resources/modules/native-capabilities.json').toString())
  const entries = Array.isArray(registry) ? registry : registry.capabilities
  assert.equal(entries.filter((item: any) => item.moduleId === 'reminders').length, 7)
  assert.equal(entries.filter((item: any) => item.moduleId === 'computer').length, 5)
})
