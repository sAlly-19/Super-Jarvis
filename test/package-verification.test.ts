import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

describe('Packaged Binary Fuse Verification & Integrity (Task 9)', () => {
  const root = process.cwd()
  const verifyScriptPath = path.join(root, 'scripts', 'verify-package.mjs')
  const flavorPath = path.join(root, 'src', 'main', 'generated', 'build-flavor.ts')

  test('verify-package.mjs inspects binary fuses directly via @electron/fuses API on the packaged executable', () => {
    assert.equal(fs.existsSync(verifyScriptPath), true, 'scripts/verify-package.mjs must exist')
    const content = fs.readFileSync(verifyScriptPath, 'utf-8')

    assert.match(
      content,
      /@electron\/fuses|getCurrentFuseWire/i,
      'verify-package.mjs must use @electron/fuses or getCurrentFuseWire to inspect the actual executable binary'
    )
    assert.match(content, /onlyLoadAppFromAsar/i, 'must verify onlyLoadAppFromAsar fuse on the binary')
    assert.match(content, /enableEmbeddedAsarIntegrityValidation/i, 'must verify enableEmbeddedAsarIntegrityValidation fuse on the binary')
  })

  test('commercial build flavor never includes smoke public keys or private material', () => {
    assert.equal(fs.existsSync(flavorPath), true, 'src/main/generated/build-flavor.ts must exist')
    const content = fs.readFileSync(flavorPath, 'utf-8')

    assert.match(content, /BUILD_FLAVOR:\s*BuildFlavor\s*=\s*['"]commercial['"]/, 'default build flavor must be commercial')
    assert.match(content, /SMOKE_PUBLIC_KEY:\s*Readonly<JsonWebKey>\s*\|\s*null\s*=\s*null/, 'commercial build flavor must have null smoke key')
  })
})

