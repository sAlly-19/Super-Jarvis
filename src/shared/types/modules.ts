export const MODULE_IDS = ['computer', 'reminders', 'pc-health', 'documents', 'email', 'web-research',
  'home-assistant', 'webhooks', 'semantic-memory', 'knowledge-graph', 'briefings'] as const
export type ModuleId = typeof MODULE_IDS[number]
export interface ModuleSnapshot {
  id: ModuleId
  enabled: boolean
  configured: boolean
  authorized: boolean
  health: 'healthy' | 'unavailable' | 'error'
  lifecycle: 'stopped' | 'starting' | 'running' | 'stopping'
  revision: number
  errorCode?: string
}
export type SchemaType = 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean' | 'null'
export interface ModuleSchema {
  type: SchemaType | SchemaType[]
  properties?: Record<string, ModuleSchema>
  required?: string[]
  additionalProperties?: boolean
  items?: ModuleSchema
  enum?: Array<string | number | boolean | null>
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  description?: string
}
export interface CapabilityDefinition {
  id: string
  moduleId: ModuleId
  description: string
  inputSchema: ModuleSchema
  outputSchema: ModuleSchema
  permissions: string[]
  configurationKeys: string[]
  effects: string[]
  timeoutMs: number
  cancellable: boolean
  verifierId?: string
}
export interface ExecutionContext {
  taskId: string
  stepId: string
  sessionId: number
  moduleRevision: number
  invocationId: string
}
export interface Evidence {
  kind: string
  reference: string
  observedAt: string
  verified: boolean
}
export interface CapabilityResult {
  status: 'succeeded' | 'failed' | 'cancelled' | 'unknown'
  data?: unknown
  evidence: Evidence[]
  errorCode?: string
}
export type AuthorizationDecision = { allowed: true } | { allowed: false; code: string }
