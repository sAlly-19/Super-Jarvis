import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { OAuthSession } from '../src/main/modules/email/oauth-session'
import type { EmailScope } from '../src/main/modules/email/contracts'
const context = { taskId: 'fixture', stepId: 'setup', sessionId: 1, moduleRevision: 0, invocationId: 'oauth-test' }
const scope = (controller = new AbortController()): EmailScope => ({ context, signal: controller.signal, check: () => controller.signal.throwIfAborted() })
const authorization = (redirectUri: string, state: string, challenge: string) => `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ redirect_uri: redirectUri, state, code_challenge: challenge })}`
test('email OAuth rejects wrong callback/state, correlates PKCE once and closes the ephemeral listener', async () => {
  let opened!: (url: string) => void
  const browser = new Promise<string>(resolve => { opened = resolve })
  const oauth = new OAuthSession({ openBrowser: async url => { opened(url) } })
  const pending = oauth.begin({ provider: 'gmail', buildAuthorizationUrl: authorization }, scope())
  try {
    const url = new URL(await browser), callback = new URL(url.searchParams.get('redirect_uri')!)
    const wrong = new URL(callback); wrong.searchParams.set('state', 'invalid'); wrong.searchParams.set('code', 'wrong')
    assert.equal((await fetch(wrong)).status, 400)
    const wrongPath = new URL('/wrong', callback); assert.equal((await fetch(wrongPath)).status, 400)
    callback.searchParams.set('state', url.searchParams.get('state')!); callback.searchParams.set('code', 'synthetic-code')
    const response = await fetch(callback); assert.equal(response.status, 200)
    assert.doesNotMatch(await response.text(), /synthetic-code|invalid/)
    const result = await pending
    assert.equal(result.code, 'synthetic-code')
    assert.equal(createHash('sha256').update(result.verifier).digest('base64url'), url.searchParams.get('code_challenge'))
    assert.match(result.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/oauth\//)
    await assert.rejects(fetch(callback))
  } finally { await oauth.stop() }
})
test('email OAuth timeout and cancellation during browser opening both close listeners', async () => {
  const timeout = new OAuthSession({ openBrowser: async () => {}, timeoutMs: 100 })
  await assert.rejects(timeout.begin({ provider: 'gmail', buildAuthorizationUrl: authorization }, scope()), /email_oauth_timeout/)
  await timeout.stop()
  let opened!: (url: string) => void
  const browser = new Promise<string>(resolve => { opened = resolve })
  const oauth = new OAuthSession({ openBrowser: url => { opened(url); return new Promise(() => {}) } })
  const pending = oauth.begin({ provider: 'gmail', buildAuthorizationUrl: authorization }, scope())
  const rejected = assert.rejects(pending, /email_oauth_cancelled/)
  const callback = new URL(new URL(await browser).searchParams.get('redirect_uri')!)
  await oauth.stop(); await rejected
  await assert.rejects(fetch(callback))
})
test('email OAuth does not open a browser without current scope or an allowlisted provider URL', async () => {
  let opens = 0
  const oauth = new OAuthSession({ openBrowser: async () => { opens++ } })
  const controller = new AbortController(); controller.abort()
  await assert.rejects(oauth.begin({ provider: 'gmail', buildAuthorizationUrl: authorization }, scope(controller)))
  await assert.rejects(oauth.begin({ provider: 'gmail', buildAuthorizationUrl: () => 'https://untrusted.invalid' }, scope()), /invalid_email_authorization_url/)
  assert.equal(opens, 0); await oauth.stop()
})
test('email OAuth awaits the asynchronous authorization URL returned by the Microsoft SDK', async () => {
  const oauth = new OAuthSession({ openBrowser: async authorizationUrl => {
    const authorization = new URL(authorizationUrl), callback = new URL(authorization.searchParams.get('redirect_uri')!)
    callback.searchParams.set('state', authorization.searchParams.get('state')!); callback.searchParams.set('code', 'synthetic')
    await fetch(callback)
  } })
  try {
    const result = await oauth.begin({ provider: 'outlook', buildAuthorizationUrl: async (redirect, state, challenge) => authorization(redirect, state, challenge).replace('accounts.google.com/o/oauth2/v2/auth', 'login.microsoftonline.com/common/oauth2/v2.0/authorize') }, scope())
    assert.equal(result.code, 'synthetic')
  } finally { await oauth.stop() }
})

test('Microsoft callback uses a registrable localhost path with ephemeral port; state and PKCE keep per-attempt correlation', async () => {
  const paths: string[] = [], states: string[] = []
  const oauth = new OAuthSession({ openBrowser: async address => {
    const url = new URL(address), callback = new URL(url.searchParams.get('redirect_uri')!)
    assert.equal(callback.hostname, 'localhost'); assert.equal(callback.pathname, '/oauth/microsoft')
    paths.push(callback.pathname); states.push(url.searchParams.get('state')!)
    callback.searchParams.set('state', url.searchParams.get('state')!); callback.searchParams.set('code', 'synthetic')
    assert.equal((await fetch(callback)).status, 200)
  } })
  try {
    const buildAuthorizationUrl = (redirectUri: string, state: string, challenge: string) => `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${new URLSearchParams({ redirect_uri: redirectUri, state, code_challenge: challenge })}`
    await oauth.begin({ provider: 'outlook', buildAuthorizationUrl }, scope())
    await oauth.begin({ provider: 'outlook', buildAuthorizationUrl }, scope())
    assert.equal(paths.length, 2); assert.notEqual(states[0], states[1])
  } finally { await oauth.stop() }
})
