import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { writeEmailVaultDocument, readEmailVaultDocument } from '../src/main/modules/email/vault-file'
test('async vault replacement restores previous document after rename failure and recovers an interrupted backup', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jasper-email-vault-atomic-')), file = path.join(root, 'vault.json')
  try {
    await writeEmailVaultDocument(file, { old: true })
    let renames = 0
    await assert.rejects(writeEmailVaultDocument(file, { replacement: true }, async (source, target) => {
      if (++renames === 2) throw new Error('injected replacement error')
      await fs.rename(source, target)
    }))
    assert.deepEqual(await readEmailVaultDocument(file), { old: true })
    assert.equal((await fs.readdir(root)).some(name => name.includes('.tmp.')), false)
    await fs.rename(file, `${file}.bak`)
    assert.deepEqual(await readEmailVaultDocument(file), { old: true })
    assert.equal((await fs.readdir(root)).includes('vault.json.bak'), false)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
