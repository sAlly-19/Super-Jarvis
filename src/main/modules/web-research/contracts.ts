import type { WebCode, ReadOutcome } from '../../../shared/types/web-research'
export type { WebCode, SearchHit, SearchOutcome, WebPage, ReadOutcome } from '../../../shared/types/web-research'

export interface WebScope { signal: AbortSignal; deadline: number; check(): void }
export interface SafeHttpResponse { url: string; status: number; headers: Record<string, string>; body: Uint8Array }
export interface WebTransport {
  fetch(url: string, scope: WebScope, options?: { method?: 'GET' | 'HEAD'; accept?: string }): Promise<SafeHttpResponse>
}
export interface WebReader {
  read(url: string, mode: 'auto' | 'http' | 'browser', scope: WebScope): Promise<ReadOutcome>
}
export class WebError extends Error {
  constructor(public readonly code: WebCode) { super(code); this.name = 'WebError' }
}
export const WEB_RESPONSE_BYTES = 2 * 1024 * 1024

export function checkWebScope(scope: WebScope, now: () => number = Date.now): void {
  if (scope.signal.aborted) throw new WebError('cancelled')
  if (!Number.isFinite(scope.deadline) || scope.deadline <= now()) throw new WebError('timeout')
  scope.check()
}

/** DNS promises cannot be cancelled; ignore late resolution and never authorize a late connection. */
export async function withinWebScope<T>(scope: WebScope, run: () => Promise<T>, now: () => number = Date.now): Promise<T> {
  checkWebScope(scope, now)
  return new Promise<T>((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (error?: unknown, value?: T) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      scope.signal.removeEventListener('abort', abort)
      if (error !== undefined) reject(error)
      else resolve(value as T)
    }
    const abort = () => finish(new WebError('cancelled'))
    scope.signal.addEventListener('abort', abort, { once: true })
    timer = setTimeout(() => finish(new WebError('timeout')), Math.min(2_147_483_647, Math.max(0, scope.deadline - now())))
    Promise.resolve().then(() => { checkWebScope(scope, now); return run() }).then(value => {
      if (settled) return
      checkWebScope(scope, now); finish(undefined, value)
    }).catch(error => finish(error))
  })
}
