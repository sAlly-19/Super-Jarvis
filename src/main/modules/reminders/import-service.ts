import type { ImportCandidate, ImportReport, MutationContext } from '../../../shared/types/reminders'
import { emptyImportReport } from './ical-codec'
import type { RemindersStore } from './store'

export class RemindersImportService {
  constructor(private readonly store: RemindersStore, private readonly authorize: () => void) {}
  public async apply(candidates: ImportCandidate[], context: MutationContext, signal: AbortSignal): Promise<ImportReport> {
    if (!Array.isArray(candidates) || candidates.length > 1000) throw new Error('ical_component_limit')
    const report = emptyImportReport()
    const interrupted = () => { report.interrupted = true; report.warnings.push('Importação interrompida; lotes já gravados foram preservados.'); return report }
    for (let index = 0; index < candidates.length; index += 100) {
      let result: ImportReport
      for (;;) {
        try {
          signal.throwIfAborted(); this.authorize()
          result = this.store.applyImportBatch(candidates.slice(index, index + 100), { ...context, invocationId: `${context.invocationId}:${index / 100}` })
          break
        } catch (error) {
          if (error instanceof Error && error.message === 'recurrence_checkpoint_pending') { await new Promise<void>(resolve => setImmediate(resolve)); continue }
          if (index > 0) return interrupted()
          throw error
        }
      }
      report.created += result.created; report.updated += result.updated; report.unchanged += result.unchanged
      report.conflicts.push(...result.conflicts); report.rejected.push(...result.rejected); report.warnings.push(...result.warnings)
      report.affected = [...(report.affected ?? []), ...(result.affected ?? [])]
      if (index + 100 < candidates.length) await new Promise<void>(resolve => setImmediate(resolve))
      if (signal.aborted) return interrupted()
    }
    if (signal.aborted) return interrupted()
    try { this.authorize() } catch (error) { if (candidates.length) return interrupted(); throw error }
    return report
  }
}
