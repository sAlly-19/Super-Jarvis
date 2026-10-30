import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { webDatabase } from './fixtures/web/database'
import { ModuleRegistry } from '../src/main/modules/registry'
import { ModulePolicy } from '../src/main/modules/policy'
import { InvocationStore } from '../src/main/modules/invocation-store'
import { ModuleRuntimeBridge } from '../src/main/modules/runtime-bridge'
test('web catalog is withheld from old sidecars without affecting other modules', async () => {
  const db = webDatabase()
  try {
    const registry = new ModuleRegistry(JSON.parse(fs.readFileSync('resources/modules/native-capabilities.json', 'utf8')))
    const policy = new ModulePolicy(registry, { requireAgentAccess() {}, getSessionId: () => 2,
      getSnapshot: id => ({ id, enabled: true, configured: true, authorized: true, health: 'healthy', lifecycle: 'running', revision: 0 }),
      getPermissions: id => registry.list().filter(c => c.moduleId === id).flatMap(c => c.permissions) })
    let catalog: string[] = []
    const bridge = new ModuleRuntimeBridge(registry, policy, new InvocationStore(db), { getSessionId: () => 2, notify() {},
      async request(_type, data: any) { catalog = data.capabilities.map((c: any) => c.id); return { moduleRuntimeVersion: 1, snapshotVersion: data.snapshotVersion } } }, () => 0, undefined, { 'web-research': async () => ({}) })
    await bridge.negotiate({ moduleRuntimeVersion: 1 }, 2)
    assert.equal(catalog.includes('web_search'), false); assert.equal(catalog.includes('run_powershell'), true)
    await bridge.negotiate({ moduleRuntimeVersion: 1, webResearchRuntimeVersion: 1 }, 2)
    assert.equal(catalog.includes('web_search'), true)
    await bridge.close()
  } finally { db.close() }
})
