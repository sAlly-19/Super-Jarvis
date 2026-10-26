import type { ExecutionContext } from '../../shared/types/modules'
import { StateDatabase } from '../storage/state-database'

/** Durable admission only; no command, arguments, result, credentials or transcript. */
export class InvocationStore {
  constructor(private readonly database: StateDatabase) {}

  public reserve(capabilityId: string, context: ExecutionContext): boolean {
    if (!/^[a-z][a-z0-9_]{0,159}$/.test(capabilityId)
      || ![context.invocationId, context.taskId, context.stepId].every(id => typeof id === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(id))
      || !Number.isSafeInteger(context.sessionId) || context.sessionId < 0
      || !Number.isSafeInteger(context.moduleRevision) || context.moduleRevision < 0) throw new Error('invalid_invocation_reservation')
    return this.database.transaction(tx => Boolean(tx.prepare(`
      INSERT INTO capability_invocations (invocation_id, capability_id, task_id, step_id, session_id, module_revision)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(invocation_id) DO NOTHING RETURNING invocation_id
    `).get(context.invocationId, capabilityId, context.taskId, context.stepId, context.sessionId, context.moduleRevision)))
  }
}
