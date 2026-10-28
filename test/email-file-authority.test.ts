import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { EmailAttachments } from '../src/main/modules/email/attachments'
import type { EmailScope } from '../src/main/modules/email/contracts'
const scope = (): EmailScope => ({ context: { taskId: 't', stepId: 's', sessionId: 1, moduleRevision: 1, invocationId: 'i' }, signal: new AbortController().signal, check() {} })
test('email attachment download blocks oversized unknown streams and revocation without leaving a file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jasper-email-authority-'))
  let mode: 'large' | 'revoke' = 'large'
  const files = new EmailAttachments({ selectFiles: async () => [], selectDirectory: async () => root,
    download: async function* () { if (mode === 'large') { yield Buffer.alloc(10485760); yield Buffer.from('x') } else { yield Buffer.from('a'); files.clear(); yield Buffer.from('b') } } })
  try {
    const destination = (await files.chooseDownloadDirectory('a', scope()))!
    const info = { ref: { accountId: 'a', messageId: 'm' }, attachmentId: 'f', name: 'untrusted.txt', contentType: 'text/plain', sizeBytes: null }
    await assert.rejects(files.download(info, destination, scope()), /email_attachment_size/)
    assert.deepEqual(await fs.readdir(root), [])
    mode = 'revoke'; await assert.rejects(files.download(info, destination, scope()), /email_file_authority/)
    assert.deepEqual(await fs.readdir(root), [])
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
test('email upload refuses directory junctions and hardlinks; delayed dialog cannot restore revoked tickets', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jasper-email-authority-'))
  let selected: string[] = [], release: (() => void) | null = null
  const files = new EmailAttachments({ selectFiles: async () => { if (release === null) await new Promise<void>(resolve => { release = resolve }); return selected }, selectDirectory: async () => root, download: async function* () {} })
  try {
    const target = path.join(root, 'target'); await fs.mkdir(target)
    const filename = path.join(target, 'fixture.txt'); await fs.writeFile(filename, 'synthetic')
    const junction = path.join(root, 'junction'); await fs.symlink(target, junction, process.platform === 'win32' ? 'junction' : 'dir')
    selected = [path.join(junction, 'fixture.txt')]
    const delayed = files.selectUploads('a', scope()); files.clear(); (release as unknown as () => void)()
    await assert.rejects(delayed, /email_file_authority/)
    await assert.rejects(files.selectUploads('a', scope()), /email_file_unavailable/)
    const hardlink = path.join(root, 'linked.txt'); await fs.link(filename, hardlink); selected = [hardlink]
    await assert.rejects(files.selectUploads('a', scope()), /email_file_unavailable/)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
