export function emailAuthError(error: unknown): Error {
  const value = error as { message?: string; errorCode?: string; response?: { data?: { error?: string } } }
  const safe = ['email_reauth_required', 'stale_email_account', 'email_oauth_cancelled', 'email_oauth_timeout', 'email_oauth_denied', 'email_account_unavailable', 'email_account_cleanup_failed', 'invalid_email_authorization_url']
  if (value && safe.includes(value.message ?? '')) return new Error(value.message)
  const code = value?.errorCode ?? value?.response?.data?.error
  if (typeof code === 'string' && ['invalid_grant', 'interaction_required', 'login_required', 'consent_required'].includes(code)) return new Error('email_reauth_required')
  return new Error('email_auth_failed')
}
