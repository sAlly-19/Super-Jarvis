import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { EmailAttachments } from '../src/main/modules/email/attachments'
import type { EmailScope } from '../src/main/modules/email/contracts'
const scope = (sessionId = 1): EmailScope => ({ context: { taskId: 't', stepId: 's', sessionId, moduleRevision: 2, invocationId: 'i' }, signal: new AbortController().signal, check() {} })
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jasper-email-files-'))
  let selected: string[] = [], now = 1000
  const files = new EmailAttachments({ selectFiles: async () => selected, selectDirectory: async () => root, now: () => now,
    download: async function* () { yield Buffer.from('fixture') } })
  return { root, files, select: (paths: string[]) => { selected = paths }, expire: () => { now += 300001 }, close: () => fs.rm(root, { recursive: true, force: true }) }
}
test('email attachments accept exact limits and reject changed, expired and cross-account/session tickets', async () => {
  const f = await fixture()
  try {
    const filename = path.join(f.root, 'fixture.txt'); await fs.writeFile(filename, Buffer.alloc(10485760))
    f.select([filename]); const [ticket] = await f.files.selectUploads('a', scope())
    assert.equal((await f.files.resolveUploads([ticket.handle], 'a', scope()))[0].bytes.length, 10485760)
    await assert.rejects(f.files.resolveUploads([ticket.handle], 'b', scope()), /email_file_authority/)
    await assert.rejects(f.files.resolveUploads([ticket.handle], 'a', scope(2)), /email_file_authority/)
    await fs.writeFile(filename, Buffer.alloc(10485760, 1))
    await assert.rejects(f.files.resolveUploads([ticket.handle], 'a', scope()), /email_file_changed/)
    const [fresh] = await f.files.selectUploads('a', scope()); f.expire()
    await assert.rejects(f.files.resolveUploads([fresh.handle], 'a', scope()), /email_file_authority/)
    await fs.appendFile(filename, 'x'); await assert.rejects(f.files.selectUploads('a', scope()), /email_attachment_limit/)
  } finally { await f.close() }
})
test('email attachments reject directories, links and eleven selected files without leaking paths', async () => {
  const f = await fixture()
  try {
    f.select([f.root]); await assert.rejects(f.files.selectUploads('a', scope()), /email_file_unavailable/)
    const filename = path.join(f.root, 'small.txt'); await fs.writeFile(filename, 'fixture')
    f.select(Array(11).fill(filename)); await assert.rejects(f.files.selectUploads('a', scope()), /email_attachment_limit/)
    const tickets = await f.files.chooseDownloadDirectory('a', scope()); assert.ok(tickets); assert.ok(!tickets.includes(f.root))
    f.files.clear(); await assert.rejects(f.files.download({ ref: { accountId: 'a', messageId: 'm' }, attachmentId: 'f', name: 'safe.txt', contentType: 'text/plain', sizeBytes: 7 }, tickets!, scope()), /email_file_authority/)
  } finally { await f.close() }
})
test('email downloads sanitize untrusted names, never overwrite, and remove only their own temporary files', async () => {
  const f = await fixture()
  try {
    const destination = (await f.files.chooseDownloadDirectory('a', scope()))!
    await fs.writeFile(path.join(f.root, 'safe.txt'), 'existing')
    const info = { ref: { accountId: 'a', messageId: 'm' }, attachmentId: 'f', name: 'safe.txt', contentType: 'text/plain', sizeBytes: 7 }
    const results = await Promise.all([f.files.download(info, destination, scope()), f.files.download(info, destination, scope())])
    assert.notEqual(results[0].name, results[1].name); assert.equal(await fs.readFile(path.join(f.root, 'safe.txt'), 'utf8'), 'existing')
    await assert.rejects(f.files.download({ ...info, sizeBytes: 6 }, destination, scope()), /email_attachment_size/)
    for (const name of ['../../escape', 'C:\\secret.txt', '\\\\server\\x', 'x:stream', 'CON', 'invoice.pdf.exe']) {
      const result = await f.files.download({ ...info, name }, destination, scope())
      assert.equal(path.dirname(path.resolve(f.root, result.name)), f.root)
      assert.doesNotMatch(result.name, /[\\/:]|^CON(?:\.|$)|\.exe$/i)
    }
    assert.equal((await fs.readdir(f.root)).some(name => name.endsWith('.part')), false)
  } finally { await f.close() }
})
