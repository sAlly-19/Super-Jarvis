import path from 'node:path'
import { EmailStore } from '../../../src/main/modules/email/store'
import { EmailReadService } from '../../../src/main/modules/email/read-service'
import { EmailWriteService } from '../../../src/main/modules/email/write-service'
import { EmailOperationStore } from '../../../src/main/modules/email/operation-store'
import { EmailOperationCodec } from '../../../src/main/modules/email/operation-codec'
import { EmailAttachments } from '../../../src/main/modules/email/attachments'
import { EmailService } from '../../../src/main/modules/email/service'
import { GmailEmailProvider } from '../../../src/main/modules/email/providers/gmail'
import { OutlookEmailProvider } from '../../../src/main/modules/email/providers/outlook'
import { createGmailSdkTransport, createOutlookSdkTransport } from '../../../src/main/modules/email/providers/sdk-transport'
import type { StateDatabase } from '../../../src/main/storage/state-database'
import type { ModulePolicy } from '../../../src/main/modules/policy'
import { emailFixtureFetch } from './fake-provider'
export function emailAcceptanceHost(database: StateDatabase, root: string, policy: ModulePolicy) {
  const accounts = new EmailStore(database), counters = { sends: 0, requests: [] as string[], loseSendResponse: false }
  const connected = (provider: 'gmail' | 'outlook') => { const record = accounts.upsertIdentity({ provider, subjectId: provider, tenantId: null, address: `${provider}@example.invalid`, displayName: 'Synthetic account' }, provider); return accounts.setConnection(record.id, 'connected', record.revision) }
  const gmail = connected('gmail'), outlook = connected('outlook'); accounts.setDefault(outlook.id, accounts.getPreferences().revision)
  const token = { accessToken: async () => 'synthetic-access-token' }
  const providers = { gmail: new GmailEmailProvider(account => createGmailSdkTransport(account.id, token, emailFixtureFetch('gmail', counters))), outlook: new OutlookEmailProvider(account => createOutlookSdkTransport(account.id, token, emailFixtureFetch('outlook', counters))) }
  const codec = new EmailOperationCodec(path.join(root, 'fixture-key.json'), { available: () => true, encrypt: text => Buffer.from(text).reverse(), decrypt: bytes => Buffer.from(bytes).reverse().toString() })
  const reads = new EmailReadService(accounts, providers, { authorize: scope => scope.check() })
  const writes = new EmailWriteService(accounts, new EmailOperationStore(database), codec, reads, providers, { authorize: scope => scope.check() })
  const files = new EmailAttachments({ selectFiles: async () => { throw new Error('synthetic_dialog_forbidden') }, selectDirectory: async () => { throw new Error('synthetic_dialog_forbidden') }, download: async function* () { throw new Error('synthetic_download_forbidden') } })
  const service = new EmailService(accounts, reads, writes, files, codec, { authorize: (context, id) => { const decision = policy.authorize(id, context); if (!decision.allowed) throw new Error(decision.code) } })
  return { service, accounts, gmail, outlook, counters }
}
