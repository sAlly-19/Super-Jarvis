import { randomBytes } from 'node:crypto'
import { OAuth2Client, CodeChallengeMethod, type Credentials } from 'google-auth-library'
import type { EmailPublisherConfig } from '../../../shared/types/email'
import type { EmailScope } from './contracts'
import type { EmailAuthDriver } from './auth'
import type { OAuthSession } from './oauth-session'
import { emailAuthError } from './auth-errors'

type Client = Pick<OAuth2Client, 'generateAuthUrl' | 'getToken' | 'verifyIdToken' | 'setCredentials' | 'refreshAccessToken'>
type Config = NonNullable<EmailPublisherConfig['google']>
const mailScope = 'https://www.googleapis.com/auth/gmail.modify'
export class GoogleEmailAuthDriver implements EmailAuthDriver {
  constructor(private readonly config: Config, private readonly oauth: Pick<OAuthSession, 'begin'>, private readonly deps: { client?(scope: EmailScope): Client; now?(): number } = {}) {}
  private client(scope: EmailScope): Client {
    return this.deps.client?.(scope) ?? new OAuth2Client({ clientId: this.config.clientId, clientSecret: this.config.desktopClientSecret,
      transporterOptions: { signal: scope.signal, retry: false, timeout: 30000, maxRedirects: 0, maxContentLength: 2097152 } })
  }
  async authorize(scope: EmailScope) {
    try {
      scope.check(); scope.signal.throwIfAborted()
      const client = this.client(scope), nonce = randomBytes(32).toString('base64url')
      const callback = await this.oauth.begin({ provider: 'gmail', buildAuthorizationUrl: (redirectUri, state, challenge) => {
        const url = new URL(client.generateAuthUrl({ redirect_uri: redirectUri, access_type: 'offline', prompt: 'consent select_account', scope: ['openid', 'email', mailScope], state, code_challenge: challenge, code_challenge_method: CodeChallengeMethod.S256 }))
        url.searchParams.set('nonce', nonce)
        return url.toString()
      } }, scope)
      scope.check(); scope.signal.throwIfAborted()
      const { tokens } = await client.getToken({ code: callback.code, codeVerifier: callback.verifier, redirect_uri: callback.redirectUri })
      scope.check(); scope.signal.throwIfAborted()
      if (!tokens.id_token || !tokens.access_token || !tokens.scope?.split(' ').includes(mailScope)) throw new Error('email_reauth_required')
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: this.config.clientId }), identity = ticket.getPayload()
      scope.check(); scope.signal.throwIfAborted()
      if (!identity?.sub || !identity.email || identity.email_verified !== true || identity.nonce !== nonce) throw new Error('email_reauth_required')
      const { id_token: _identityToken, ...durable } = tokens
      return { identity: { provider: 'gmail' as const, subjectId: identity.sub, tenantId: null, address: identity.email, displayName: typeof identity.name === 'string' ? identity.name : identity.email }, credentials: { tokens: durable } }
    } catch (error) { throw emailAuthError(error) }
  }
  async access(credentials: unknown, scope: EmailScope) {
    try {
      scope.check(); scope.signal.throwIfAborted()
      const tokens = (credentials as { tokens?: Credentials } | null)?.tokens
      if (!tokens || typeof tokens !== 'object' || !tokens.scope?.split(' ').includes(mailScope)) throw new Error('email_reauth_required')
      const now = this.deps.now?.() ?? Date.now()
      if (typeof tokens.access_token === 'string' && typeof tokens.expiry_date === 'number' && tokens.expiry_date > now + 60000) return { accessToken: tokens.access_token, credentials }
      if (!tokens.refresh_token || typeof tokens.refresh_token !== 'string') throw new Error('email_reauth_required')
      const client = this.client(scope); client.setCredentials(tokens)
      const { credentials: refreshed } = await client.refreshAccessToken()
      scope.check(); scope.signal.throwIfAborted()
      if (!refreshed.access_token) throw new Error('email_reauth_required')
      const { id_token: _identityToken, ...durable } = { ...tokens, ...refreshed }
      return { accessToken: refreshed.access_token, credentials: { tokens: durable } }
    } catch (error) { throw emailAuthError(error) }
  }
}
