import { test } from 'node:test'
import assert from 'node:assert/strict'
import { composeGmailMessage, resolveEmailRecipients } from '../src/main/modules/email/mime'
const account = { id: 'account', provider: 'gmail' as const, subjectId: 'sub', tenantId: null, address: 'sender@example.invalid', displayName: 'Jasper Test', status: 'connected' as const, revision: 0 }
const composition = { accountId: account.id, to: ['"Recipient, Test" <recipient@example.invalid>'], cc: [] as string[], bcc: ['hidden@example.invalid'], subject: 'Olá 🙂', text: 'Mensagem sintética\nsegunda linha', attachmentHandles: [] as string[] }
test('email MIME is produced locally with Unicode, Bcc and a stable operation Message-ID', async () => {
  const bytes = await composeGmailMessage(composition, account, [], '<fixture@jasper.invalid>')
  assert.ok(bytes.length > 100)
  assert.match(Buffer.from(bytes).toString(), /Message-ID: <fixture@jasper.invalid>/i)
  assert.match(Buffer.from(bytes).toString(), /recipient@example.invalid/)
  assert.deepEqual(await resolveEmailRecipients(composition.to), ['recipient@example.invalid'])
})
test('email MIME refuses header injection, disguised paths and more than fifty parsed recipients', async () => {
  await assert.rejects(composeGmailMessage({ ...composition, subject: 'Subject\r\nBcc: evil@example.invalid' }, account, [], '<fixture@jasper.invalid>'), /invalid_email/)
  await assert.rejects(composeGmailMessage(composition, account, [{ name: '../private.txt', contentType: 'text/plain', bytes: Buffer.from('fixture') }], '<fixture@jasper.invalid>'), /invalid_email_attachment/)
  await assert.rejects(composeGmailMessage({ ...composition, to: [Array.from({ length: 51 }, (_, i) => `r${i}@example.invalid`).join(',')], bcc: [] }, account, [], '<fixture@jasper.invalid>'), /invalid_email/)
})
test('email subject limit is characters rather than encoded UTF-8 byte count', async () => {
  const bytes = await composeGmailMessage({ ...composition, subject: 'á'.repeat(600) }, account, [], '<fixture@jasper.invalid>')
  assert.ok(bytes.length > 100)
})
