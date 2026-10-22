export function isTrustedRendererUrl(url: string, developmentUrl?: string): boolean {
  try {
    const parsed = new URL(url)
    if (developmentUrl) return parsed.origin === new URL(developmentUrl).origin
    return parsed.protocol === 'app:' && parsed.hostname === 'jasper' &&
      parsed.username === '' && parsed.password === '' && parsed.port === ''
  } catch {
    return false
  }
}
