import { randomBytes } from 'node:crypto'
import { PublicClientApplication, type INetworkModule, type NetworkRequestOptions, type NetworkResponse, type AuthenticationResult } from '@azure/msal-node'
import type { EmailPublisherConfig } from '../../../shared/types/email'
import type { EmailScope } from './contracts'
import type { EmailAuthDriver } from './auth'
import type { OAuthSession } from './oauth-session'
import { emailAuthError } from './auth-errors'

type Config = NonNullable<EmailPublisherConfig['microsoft']>
type Client = Pick<PublicClientApplication, 'getAuthCodeUrl' | 'acquireTokenByCode' | 'acquireTokenSilent' | 'getTokenCache'>
const scopes = ['Mail.ReadWrite', 'Mail.Send']
function granted(result: AuthenticationResult): void {
  const actual = result.scopes.map(scope => scope.toLowerCase().replace(/^https:\/\/graph\.microsoft\.com\//, ''))
  if (!result.account || !result.accessToken || scopes.some(scope => !actual.includes(scope.toLowerCase()))) throw new Error('email_reauth_required')
}
function network(scope: EmailScope): INetworkModule {
  async function request<T>(method: 'GET' | 'POST', address: string, options?: NetworkRequestOptions, timeout = 30000): Promise<NetworkResponse<T>> {
    scope.check(); scope.signal.throwIfAborted()
    const url = new URL(address)
    if (url.origin !== 'https://login.microsoftonline.com' || url.username || url.password) throw new Error('email_auth_failed')
    const response = await fetch(url, { method, headers: options?.headers, body: method === 'POST' ? options?.body : undefined,
      redirect: 'error', signal: AbortSignal.any([scope.signal, AbortSignal.timeout(Math.max(1, Math.min(timeout, 30000)))]) })
    const reader = response.body?.getReader(), parts: Uint8Array[] = []
    let size = 0
    try {
      if (reader) while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.length
        if (size > 2097152) throw new Error('email_auth_failed')
        parts.push(chunk.value)
      }
    } finally { if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock() } }
    scope.check(); scope.signal.throwIfAborted()
    const text = Buffer.concat(parts).toString('utf8')
    return { headers: Object.fromEntries(response.headers.entries()), status: response.status, body: (text ? JSON.parse(text) : {}) as T }
  }
  return { sendGetRequestAsync: <T>(url: string, options?: NetworkRequestOptions, timeout?: number) => request<T>('GET', url, options, timeout),
    sendPostRequestAsync: <T>(url: string, options?: NetworkRequestOptions) => request<T>('POST', url, options) }
}
export class MicrosoftEmailAuthDriver implements EmailAuthDriver {
  constructor(private readonly config: Config, private readonly oauth: Pick<OAuthSession, 'begin'>, private readonly makeClient?: (scope: EmailScope, cache: string | null) => Client) {}
  private client(scope: EmailScope, serialized: string | null): Client {
    if (this.makeClient) return this.makeClient(scope, serialized)
    let current = serialized
    return new PublicClientApplication({ auth: { clientId: this.config.clientId, authority: this.config.authority },
      system: { networkClient: network(scope), disableInternalRetries: true, loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => {} } },
      cache: { cachePlugin: {
        beforeCacheAccess: async context => { scope.check(); if (current) context.tokenCache.deserialize(current) },
        afterCacheAccess: async context => { scope.check(); if (context.cacheHasChanged) current = context.tokenCache.serialize() }
      } } })
  }
  async authorize(scope: EmailScope) {
    try {
      scope.check(); scope.signal.throwIfAborted()
      const client = this.client(scope, null), nonce = randomBytes(32).toString('base64url')
      let state = ''
      const callback = await this.oauth.begin({ provider: 'outlook', buildAuthorizationUrl: async (redirectUri, suppliedState, challenge) => {
        state = suppliedState
        return client.getAuthCodeUrl({ scopes, redirectUri, nonce, state, codeChallenge: challenge, codeChallengeMethod: 'S256', prompt: 'select_account' })
      } }, scope)
      scope.check(); scope.signal.throwIfAborted()
      const result = await client.acquireTokenByCode({ scopes, code: callback.code, codeVerifier: callback.verifier, redirectUri: callback.redirectUri, nonce, state })
      scope.check(); scope.signal.throwIfAborted(); granted(result)
      const account = result.account!
      if (!account.homeAccountId || !account.localAccountId || !account.tenantId || !account.username) throw new Error('email_reauth_required')
      return { identity: { provider: 'outlook' as const, subjectId: account.localAccountId, tenantId: account.tenantId, address: account.username, displayName: account.name ?? account.username },
        credentials: { cache: client.getTokenCache().serialize(), homeAccountId: account.homeAccountId } }
    } catch (error) { throw emailAuthError(error) }
  }
  async access(credentials: unknown, scope: EmailScope) {
    try {
      scope.check(); scope.signal.throwIfAborted()
      const saved = credentials as { cache?: string; homeAccountId?: string } | null
      if (!saved || typeof saved.cache !== 'string' || typeof saved.homeAccountId !== 'string') throw new Error('email_reauth_required')
      const client = this.client(scope, saved.cache), accounts = await client.getTokenCache().getAllAccounts()
      scope.check(); scope.signal.throwIfAborted()
      const account = accounts.find(account => account.homeAccountId === saved.homeAccountId)
      if (!account) throw new Error('email_reauth_required')
      const result = await client.acquireTokenSilent({ scopes, account })
      scope.check(); scope.signal.throwIfAborted(); granted(result)
      if (result.account!.homeAccountId !== account.homeAccountId) throw new Error('email_reauth_required')
      return { accessToken: result.accessToken, credentials: { cache: client.getTokenCache().serialize(), homeAccountId: account.homeAccountId } }
    } catch (error) { throw emailAuthError(error) }
  }
}
