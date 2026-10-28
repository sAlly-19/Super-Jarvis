import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GoogleEmailAuthDriver } from '../src/main/modules/email/google-auth'
import { MicrosoftEmailAuthDriver } from '../src/main/modules/email/microsoft-auth'
import type { EmailScope } from '../src/main/modules/email/contracts'
const scope: EmailScope = { context: { taskId: 't', stepId: 's', sessionId: 1, moduleRevision: 0, invocationId: 'i' }, signal: new AbortController().signal, check() {} }
test('Google email auth delegates signature verification to SDK, requests limited scopes and refuses expired non-refreshable credentials', async () => {
  let nonce = '', verified = 0, exchange: any, options: any
  const oauth: any = { begin: async (request: any) => { const url = new URL(await request.buildAuthorizationUrl('http://127.0.0.1:1234/oauth/fixture', 'state-fixture', 'challenge-fixture')); nonce = url.searchParams.get('nonce')!; return { code: 'code-fixture', verifier: 'verifier-fixture', redirectUri: 'http://127.0.0.1:1234/oauth/fixture' } } }
  const client: any = { generateAuthUrl: (value: any) => { options = value; return 'https://accounts.google.com/o/oauth2/v2/auth' },
    getToken: async (value: any) => { exchange = value; return { tokens: { access_token: 'fixture-access', refresh_token: 'fixture-refresh', id_token: 'signed-fixture', expiry_date: 200000, scope: 'https://www.googleapis.com/auth/gmail.modify' } } },
    verifyIdToken: async () => { verified++; return { getPayload: () => ({ sub: 'fixture-sub', email: 'test@example.invalid', email_verified: true, nonce }) } }
  }
  const driver = new GoogleEmailAuthDriver({ clientId: 'fixture.apps.googleusercontent.com' }, oauth, { client: () => client, now: () => 0 })
  const grant = await driver.authorize(scope)
  assert.equal(grant.identity.subjectId, 'fixture-sub'); assert.equal(verified, 1)
  assert.equal(exchange.codeVerifier, 'verifier-fixture'); assert.equal(options.access_type, 'offline')
  assert.ok(options.scope.includes('https://www.googleapis.com/auth/gmail.modify'))
  assert.ok(!options.scope.includes('https://mail.google.com/'))
  assert.equal((await driver.access(grant.credentials, scope)).accessToken, 'fixture-access')
  await assert.rejects(driver.access({ tokens: { access_token: 'old', expiry_date: -1 } }, scope), /email_reauth_required/)
  client.verifyIdToken = async () => ({ getPayload: () => ({ sub: 'fixture-sub', email: 'test@example.invalid', email_verified: false, nonce }) })
  await assert.rejects(driver.authorize(scope), /email_reauth_required/)
})
test('Microsoft email auth selects the exact cached home account and never another signed-in account', async () => {
  let nonce = '', selected: any
  const account = { homeAccountId: 'home-a', localAccountId: 'local-a', tenantId: 'tenant-a', username: 'a@example.invalid', name: 'Synthetic' }
  const oauth: any = { begin: async (request: any) => { await request.buildAuthorizationUrl('http://127.0.0.1:1234/oauth/fixture', 'state-fixture', 'challenge-fixture'); return { code: 'code-fixture', verifier: 'verifier-fixture', redirectUri: 'http://127.0.0.1:1234/oauth/fixture' } } }
  let accounts = [{ ...account, homeAccountId: 'home-b' }, account]
  const cache = { serialize: () => 'fixture-cache', getAllAccounts: async () => accounts }
  const client: any = { getAuthCodeUrl: async (request: any) => { nonce = request.nonce; return 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize' },
    acquireTokenByCode: async (request: any) => { assert.equal(request.nonce, nonce); return { account, scopes: ['Mail.ReadWrite', 'Mail.Send'], accessToken: 'fixture-access' } },
    acquireTokenSilent: async (request: any) => { selected = request.account; return { account, scopes: ['Mail.ReadWrite', 'Mail.Send'], accessToken: 'fixture-access' } }, getTokenCache: () => cache }
  const driver = new MicrosoftEmailAuthDriver({ clientId: 'fixture-client', authority: 'https://login.microsoftonline.com/common' }, oauth, () => client)
  const grant = await driver.authorize(scope)
  assert.equal(grant.identity.tenantId, 'tenant-a')
  assert.equal((await driver.access(grant.credentials, scope)).accessToken, 'fixture-access')
  assert.equal(selected.homeAccountId, 'home-a')
  accounts = [{ ...account, homeAccountId: 'home-b' }]
  await assert.rejects(driver.access(grant.credentials, scope), /email_reauth_required/)
})
