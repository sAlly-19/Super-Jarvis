import { utilityProcess } from 'electron'
import { terminateProcessTree } from '../../services/process-tree'
import type { PcHealthSnapshot } from '../../../shared/types/pc-health'
export interface HealthCollector { collect(signal: AbortSignal): Promise<PcHealthSnapshot> }
/** Disposable utility process; cancellation/timeout waits for process-tree termination. */
export class HealthCollectorClient implements HealthCollector {
  constructor(private readonly filename: string, private readonly timeoutMs = 27000) {}
  async collect(signal: AbortSignal): Promise<PcHealthSnapshot> {
    signal.throwIfAborted()
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(SystemRoot|SystemDrive|WINDIR|PATH|PATHEXT|TEMP|TMP|COMSPEC|PROCESSOR_ARCHITECTURE|ProgramFiles|ProgramFiles\(x86\)|ProgramW6432|USERPROFILE|APPDATA|LOCALAPPDATA|ALLUSERSPROFILE|HOMEDRIVE|HOMEPATH|PSModulePath)$/i.test(key)))
    const child = utilityProcess.fork(this.filename, [], { env, stdio: 'ignore', serviceName: 'Jasper PC health' })
    let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined
    let stopping = false, exited = false, ready!: () => void, exit!: () => void
    const readyPromise = new Promise<void>(resolve => { ready = resolve })
    const exitPromise = new Promise<void>(resolve => { exit = resolve })
    child.once('spawn', () => { ready(); if (stopping || signal.aborted) child.kill(); else child.postMessage({ type: 'collect' }) })
    child.once('exit', () => { exited = true; ready(); exit() })
    try {
      return await new Promise<PcHealthSnapshot>((resolve, reject) => {
        abort = () => reject(new Error('health_collection_cancelled'))
        signal.addEventListener('abort', abort, { once: true })
        timer = setTimeout(() => reject(new Error('health_collection_timeout')), this.timeoutMs)
        child.once('exit', () => reject(new Error('health_worker_exited')))
        child.once('error', () => reject(new Error('health_worker_failed')))
        child.once('message', message => {
          if (message?.ok === true && message.snapshot && JSON.stringify(message.snapshot).length < 128000) resolve(message.snapshot)
          else reject(new Error('health_worker_failed'))
        })
        if (signal.aborted) abort()
      })
    } finally {
      if (timer) clearTimeout(timer)
      if (abort) signal.removeEventListener('abort', abort)
      stopping = true
      const bounded = async (work: Promise<void>) => {
        let limit: ReturnType<typeof setTimeout> | undefined
        try { await Promise.race([work, new Promise<never>((_, reject) => { limit = setTimeout(() => reject(new Error('health_worker_cleanup_failed')), 5000) })]) }
        finally { if (limit) clearTimeout(limit) }
      }
      // A cancellation can arrive before Chromium assigned a PID. Wait for spawn
      // before terminating the tree, otherwise a late worker can survive kill().
      await bounded(readyPromise)
      const pid = child.pid
      if (pid && !exited) { try { await terminateProcessTree(pid) } catch { child.kill() } }
      else if (!exited) child.kill()
      await bounded(exitPromise)
    }
  }
}
