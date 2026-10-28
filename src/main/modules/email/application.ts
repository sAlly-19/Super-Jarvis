import path from 'node:path'
import type { EmailProviderId, EmailPublisherConfig } from '../../../shared/types/email'
import type { ExecutionContext } from '../../../shared/types/modules'
import type { StateDatabase } from '../../storage/state-database'
import type { EmailScope, VaultCrypto } from './contracts'
import { EmailStore } from './store'
import { EmailTokenVault } from './token-vault'
import { EmailAuth, type EmailAuthDriver } from './auth'
import { OAuthSession } from './oauth-session'
import { GoogleEmailAuthDriver } from './google-auth'
import { MicrosoftEmailAuthDriver } from './microsoft-auth'
import { GmailEmailProvider } from './providers/gmail'
import { OutlookEmailProvider } from './providers/outlook'
import { createGmailSdkTransport, createOutlookSdkTransport } from './providers/sdk-transport'
import { readEmailPublisherConfig } from './publisher-config'
import { EmailAttachments } from './attachments'
import { EmailReadService } from './read-service'
import { EmailWriteService } from './write-service'
import { EmailOperationStore } from './operation-store'
import { EmailOperationCodec } from './operation-codec'
import { EmailService } from './service'
interface Dependencies {
  database: StateDatabase; profileRoot: string; publisherRoot: string; crypto: VaultCrypto
  authorizeAgent(context: ExecutionContext, id: string): void
  authorizeManagement(): void; moduleRevision(): number; sessionId(): number
  openBrowser(url: string): Promise<void>; selectFiles(): Promise<string[]>; selectDirectory(): Promise<string | null>; changed(): void
  config?(): EmailPublisherConfig | null
  drivers?(config: EmailPublisherConfig): Partial<Record<EmailProviderId, EmailAuthDriver>>
}
export function startEmailApplication(deps: Dependencies) {
  const accounts = new EmailStore(deps.database), operations = new EmailOperationStore(deps.database)
  operations.interruptDispatches()
  let generation = 0, stopping: Promise<void> | null = null, unsafe = false, vaultReady = false, vaultError = false
  const active = new Set<AbortController>()
  const config = () => deps.config ? deps.config() : readEmailPublisherConfig(deps.publisherRoot)
  const management = () => { deps.authorizeManagement(); if (unsafe || stopping) throw new Error('email_unavailable') }
  const authorize = (scope: EmailScope) => scope.check()
  const oauth = new OAuthSession({ openBrowser: deps.openBrowser })
  let publisher: EmailPublisherConfig | null = null, configError = false
  try { publisher = config() } catch { configError = true }
  const drivers: Partial<Record<EmailProviderId, EmailAuthDriver>> = publisher ? deps.drivers?.(publisher) ?? {
    ...(publisher.google ? { gmail: new GoogleEmailAuthDriver(publisher.google, oauth) } : {}),
    ...(publisher.microsoft ? { outlook: new MicrosoftEmailAuthDriver(publisher.microsoft, oauth) } : {})
  } : {}
  const auth = new EmailAuth(accounts, new EmailTokenVault(path.join(deps.profileRoot, 'email-tokens.json'), deps.crypto), drivers, { authorize: management })
  const providers = { gmail: new GmailEmailProvider(account => createGmailSdkTransport(account.id, auth)), outlook: new OutlookEmailProvider(account => createOutlookSdkTransport(account.id, auth)) }
  const reads = new EmailReadService(accounts, providers, { authorize })
  const files = new EmailAttachments({ selectFiles: deps.selectFiles, selectDirectory: deps.selectDirectory,
    download: async function* (info, scope) {
      const account = accounts.getAccount(info.ref.accountId)
      if (!account || account.status !== 'connected') throw new Error('email_account_unavailable')
      const check = () => { scope.check(); if (accounts.getAccount(account.id)?.revision !== account.revision) throw new Error('stale_email_account') }
      yield* providers[account.provider].download(account, info, { ...scope, check })
    } })
  const codec = new EmailOperationCodec(path.join(deps.profileRoot, 'email-operation-key.json'), deps.crypto)
  const writes = new EmailWriteService(accounts, operations, codec, reads, providers, { authorize, attachments: (handles, accountId, scope) => files.resolveUploads(handles, accountId, scope) })
  const service = new EmailService(accounts, reads, writes, files, codec, { authorize: deps.authorizeAgent })
  async function run<T>(work: (scope: EmailScope) => Promise<T>, file = false): Promise<T> {
    management()
    const epoch = generation, revision = deps.moduleRevision(), sessionId = file ? deps.sessionId() : 0, controller = new AbortController()
    active.add(controller)
    const check = () => { controller.signal.throwIfAborted(); management(); if (generation !== epoch || deps.moduleRevision() !== revision || file && deps.sessionId() !== sessionId) throw new Error('email_unavailable') }
    const scope: EmailScope = { context: { taskId: 'email-panel', stepId: 'management', sessionId, moduleRevision: revision, invocationId: 'email-panel' }, signal: controller.signal, check }
    try { const result = await work(scope); check(); return result }
    finally { active.delete(controller) }
  }
  function account(id: string) { const value = accounts.getAccount(id); if (!value || value.status !== 'connected') throw new Error('email_account_unavailable'); return value }
  function status(): { health: 'healthy' | 'unavailable' | 'error'; errorCode?: string } {
    try {
      management()
      if (configError) return { health: 'error', errorCode: 'invalid_email_publisher_config' }
      const current = config()
      if (!current || !current.google && !current.microsoft) return { health: 'unavailable', errorCode: 'email_oauth_not_configured' }
      if (!deps.crypto.available()) return { health: 'unavailable', errorCode: 'email_crypto_unavailable' }
      if (vaultError) return { health: 'error', errorCode: 'email_vault_unavailable' }
      if (!vaultReady) return { health: 'unavailable', errorCode: 'email_credentials_not_restored' }
      if (!accounts.listAccounts().some(item => item.status === 'connected' && (item.provider === 'gmail' ? current.google : current.microsoft))) return { health: 'unavailable', errorCode: 'email_account_unavailable' }
      return { health: 'healthy' }
    } catch { return { health: 'unavailable', errorCode: 'email_unavailable' } }
  }
  return {
    service, accounts, auth, status,
    abortPanel() { generation++; for (const controller of active) controller.abort(new Error('email_unavailable')); files.clear() },
    state() { management(); return { accounts: accounts.listAccounts(), preferences: accounts.getPreferences(), status: status(), providers: { gmail: !!publisher?.google, outlook: !!publisher?.microsoft } } },
    async restore() { return run(async scope => { const before = JSON.stringify(accounts.listAccounts()), ready = vaultReady, failed = vaultError; try { await auth.restore(scope); vaultReady = true; vaultError = false; if (!ready || failed || before !== JSON.stringify(accounts.listAccounts())) deps.changed() } catch (error) { vaultError = true; throw error } }) },
    async connect(provider: EmailProviderId) {
      return run(async scope => {
        const current = config()
        if (!['gmail', 'outlook'].includes(provider) || !current || !(provider === 'gmail' ? current.google : current.microsoft) || !drivers[provider]) throw new Error('email_oauth_not_configured')
        const connected = await auth.connect(provider, scope); vaultReady = true; reads.clear(); files.clear(); service.clearObservations(); deps.changed(); return connected
      })
    },
    async disconnect(id: string, expectedRevision: number) {
      return run(async scope => {
        if (accounts.getAccount(id)?.revision !== expectedRevision) throw new Error('stale_email_revision')
        await auth.disconnect(id, scope); reads.clear(); files.clear(); service.clearObservations(); deps.changed()
      })
    },
    setDefault(id: string | null, expectedRevision: number) { management(); const result = accounts.setDefault(id, expectedRevision); deps.changed(); return result },
    selectUploads(id: string) { return run(async scope => { const selected = account(id); const result = await files.selectUploads(id, scope); if (accounts.getAccount(id)?.revision !== selected.revision) throw new Error('stale_email_account'); return result }, true) },
    selectDownloadDirectory(id: string) { return run(async scope => { const selected = account(id); const handle = await files.chooseDownloadDirectory(id, scope); if (accounts.getAccount(id)?.revision !== selected.revision) throw new Error('stale_email_account'); return handle }, true) },
    stop(): Promise<void> {
      if (stopping) return stopping
      generation++; vaultReady = false; for (const controller of active) controller.abort(new Error('email_unavailable'))
      reads.clear(); files.clear(); service.clearObservations()
      stopping = (async () => { try { await Promise.all([service.stop(), auth.stop(), oauth.stop()]) } catch { unsafe = true; throw new Error('email_cleanup_failed') } finally { stopping = null } })()
      return stopping
    }
  }
}
export type EmailApplication = ReturnType<typeof startEmailApplication>
