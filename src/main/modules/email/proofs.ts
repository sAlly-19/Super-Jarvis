import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { CapabilityResult, ExecutionContext } from '../../../shared/types/modules'
import type { EmailResult } from '../../../shared/types/email'
type Kind = 'email_read' | 'email_write' | 'email_file'
interface Observation { context: ExecutionContext; capabilityId: string; fingerprint: string; data: EmailResult; kind: Kind; reference: string; observedAt: string; check(): void }
export class EmailProofs {
  private readonly observations = new Map<string, Observation>()
  constructor(private readonly deps: { authorize(context: ExecutionContext, capabilityId: string): void; now?(): string }) {}
  observe(context: ExecutionContext, capabilityId: string, fingerprint: string, data: unknown, kind: Kind, check: () => void = () => {}): void {
    this.deps.authorize(context, capabilityId); check()
    if (!/^[a-f0-9]{64}$/.test(fingerprint) || !data || typeof data !== 'object' || !capabilityId.startsWith('email_')) throw new Error('invalid_email_observation')
    const value = structuredClone(data) as EmailResult
    if ((kind === 'email_read' && value.kind !== 'read') || (kind === 'email_write' && value.kind !== 'write') || (kind === 'email_file' && value.kind !== 'file')) throw new Error('invalid_email_observation')
    const reference = value.kind === 'write' ? value.operation.id : value.kind === 'file' ? value.receiptRef : randomUUID()
    if (typeof reference !== 'string' || !reference || reference.length > 160) throw new Error('invalid_email_observation')
    this.observations.set(context.invocationId, { context: { ...context }, capabilityId, fingerprint, data: value, kind, reference, observedAt: this.deps.now?.() ?? new Date().toISOString(), check })
  }
  verify(context: ExecutionContext, capabilityId: string, result: CapabilityResult): CapabilityResult {
    const denied: CapabilityResult = { status: 'unknown', evidence: [], errorCode: 'unverified_host_result' }
    try {
      this.deps.authorize(context, capabilityId)
      const observation = this.observations.get(context.invocationId)
      if (!observation || result.status !== 'unknown' || observation.capabilityId !== capabilityId || !isDeepStrictEqual(context, observation.context) || !isDeepStrictEqual(result.data, observation.data)) return denied
      observation.check()
      const data = structuredClone(observation.data)
      if (data.kind === 'write' && !['accepted', 'observed'].includes(data.operation.state)) {
        const code = data.operation.errorCode
        return { status: data.operation.state === 'rejected' ? 'failed' : 'unknown', data, evidence: [], errorCode: typeof code === 'string' && /^[a-z][a-z0-9_]{0,99}$/.test(code) ? code : 'email_effect_uncertain' }
      }
      if (data.kind === 'read' && !Array.isArray(data.value) && 'partial' in data.value && data.value.partial) return { status: 'unknown', data, evidence: [], errorCode: 'email_partial_search' }
      return { status: 'succeeded', data, evidence: [{ kind: observation.kind, reference: observation.reference, observedAt: observation.observedAt, verified: true }] }
    } catch { return denied }
  }
  release(invocationId: string): void { this.observations.delete(invocationId) }
  clear(): void { this.observations.clear() }
}
