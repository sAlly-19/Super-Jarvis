import type { ModuleSchema } from '../../shared/types/modules'
import { validateValue } from '../modules/schema'
const text: ModuleSchema = { type: 'string', minLength: 1, maxLength: 160 }
const integer: ModuleSchema = { type: 'integer', minimum: 0 }
const obj = (properties: Record<string, ModuleSchema>, required = Object.keys(properties)): ModuleSchema => ({ type: 'object', properties, required, additionalProperties: false })
const SCHEMAS: Record<string, ModuleSchema> = {
  task_runtime: obj({ taskRuntimeVersion: { type: 'integer', enum: [1] }, sessionId: integer }),
  task_runtime_ack: obj({ taskRuntimeVersion: { type: 'integer', enum: [1] }, sessionId: integer }),
  task_cancel: obj({ taskId: text }),
  task_event: obj({ requestId: text, sessionId: integer, taskId: { type: 'string', maxLength: 160 }, expectedRevision: integer, event: { type: 'object' } }),
  task_event_ack: obj({ requestId: text, taskId: { type: 'string', maxLength: 160 }, revision: integer, accepted: { type: 'boolean' }, errorCode: text }, ['requestId', 'taskId', 'revision', 'accepted'])
}
const EVENTS: Record<string, ModuleSchema> = {
  abandoned: obj({ type: text, sequence: integer }),
  open: obj({ type: { type: 'string', enum: ['open'] }, origin: { type: 'string', enum: ['chat', 'live'] } }),
  planning: obj({ type: text, sequence: integer }),
  plan_ready: obj({ type: text, sequence: integer, stepIds: { type: 'array', minItems: 1, maxItems: 8, items: text } }),
  step_started: obj({ type: text, sequence: integer, stepId: text }),
  step_finished: obj({ type: text, sequence: integer, stepId: text, status: { type: 'string', enum: ['succeeded', 'failed', 'cancelled', 'skipped', 'unknown'] } }),
  cancel_requested: obj({ type: text, sequence: integer }),
  finished: obj({ type: text, sequence: integer, status: { type: 'string', enum: ['cancelled', 'succeeded', 'failed', 'partial', 'unknown', 'interrupted'] } })
}
export function validateTaskPayload(type: string, payload: unknown): boolean {
  if (!Object.hasOwn(SCHEMAS, type)) return false
  validateValue(SCHEMAS[type], payload)
  if (type === 'task_event') {
    const event = (payload as { event: { type: string } }).event
    if (!Object.hasOwn(EVENTS, event.type)) throw new Error('invalid_task_event_type')
    validateValue(EVENTS[event.type], event)
  }
  return true
}
