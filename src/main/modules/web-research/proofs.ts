import { isDeepStrictEqual } from 'node:util'
import { randomUUID } from 'node:crypto'
import type { CapabilityResult, ExecutionContext } from '../../../shared/types/modules'
import type { WebCapabilityData } from '../../../shared/types/web-research'
export class WebProofs {
  private readonly observations = new Map<string, { context: ExecutionContext; id: string; data: WebCapabilityData; check(): void; at: string; ref: string }>()
  constructor(private readonly authorize: (context: ExecutionContext, id: string) => void, private readonly now: () => string) {}
  observe(context: ExecutionContext, id: string, data: WebCapabilityData, check: () => void): void {
    this.authorize(context, id); check()
    this.observations.set(context.invocationId, { context: { ...context }, id, data: structuredClone(data), check, at: this.now(), ref: randomUUID() })
  }
  verify(context: ExecutionContext, id: string, result: CapabilityResult): CapabilityResult {
    const denied: CapabilityResult = { status: 'unknown', evidence: [], errorCode: 'unverified_host_result' }
    try {
      this.authorize(context, id)
      const observation = this.observations.get(context.invocationId)
      if (!observation || result.status !== 'unknown' || observation.id !== id || !isDeepStrictEqual(context, observation.context)
        || !isDeepStrictEqual(result.data, observation.data)) return denied
      observation.check()
      const data = structuredClone(observation.data)
      if (data.kind === 'search' || data.kind === 'read') {
        if (['blocked', 'unavailable'].includes(data.outcome.state)) return { status: 'failed', data, evidence: [], errorCode: data.outcome.code ?? 'network_unavailable' }
        if (data.outcome.state === 'partial') return { status: 'unknown', data, evidence: [], errorCode: 'web_partial_content' }
      }
      return { status: 'succeeded', data, evidence: [{ kind: 'web_observation', reference: observation.ref, observedAt: observation.at, verified: true }] }
    } catch { return denied }
  }
  release(id: string): void { this.observations.delete(id) }
  clear(): void { this.observations.clear() }
}
