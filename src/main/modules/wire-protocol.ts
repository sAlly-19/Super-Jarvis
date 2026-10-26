import type { ModuleSchema } from '../../shared/types/modules'
import { validateValue } from './schema'
import { ModuleRegistry } from './registry'

const text: ModuleSchema = { type: 'string', minLength: 1, maxLength: 160 }
const integer: ModuleSchema = { type: 'integer', minimum: 0 }
const object: ModuleSchema = { type: 'object' }
const context: ModuleSchema = { type: 'object', properties: { taskId: text, stepId: text, invocationId: text, sessionId: integer, moduleRevision: integer }, required: ['taskId', 'stepId', 'invocationId', 'sessionId', 'moduleRevision'], additionalProperties: false }
const result: ModuleSchema = { type: 'object', properties: { status: { type: 'string', enum: ['succeeded', 'failed', 'cancelled', 'unknown'] }, evidence: { type: 'array', items: object }, data: { type: ['object', 'array', 'string', 'number', 'boolean', 'null'] }, errorCode: text }, required: ['status', 'evidence'], additionalProperties: false }
const schema = (properties: Record<string, ModuleSchema>): ModuleSchema => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
const SCHEMAS: Record<string, ModuleSchema> = {
  module_snapshot: schema({ moduleRuntimeVersion: { type: 'integer', enum: [1] }, snapshotVersion: integer, sessionId: integer, capabilities: { type: 'array', items: object } }),
  module_snapshot_ack: schema({ moduleRuntimeVersion: { type: 'integer', enum: [1] }, snapshotVersion: integer }),
  capability_request: { type: 'object', properties: { requestId: text, snapshotVersion: integer, capabilityId: text, args: object,
    task: schema({ taskId: text, stepId: text }) }, required: ['requestId', 'snapshotVersion', 'capabilityId', 'args'], additionalProperties: false },
  capability_cancel_request: schema({ requestId: text }),
  capability_execute: schema({ requestId: text, context, capabilityId: text, args: object, snapshotVersion: integer }),
  capability_result: schema({ context, result }),
  capability_response: schema({ requestId: text, result }),
  invocation_cancel: schema({ invocationId: text, reason: text })
}

export function validateModulePayload(type: string, payload: unknown): boolean {
  if (!Object.hasOwn(SCHEMAS, type)) return false
  validateValue(SCHEMAS[type], payload)
  if (type === 'module_snapshot') new ModuleRegistry((payload as { capabilities: ConstructorParameters<typeof ModuleRegistry>[0] }).capabilities)
  return true
}
