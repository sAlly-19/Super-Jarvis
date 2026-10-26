export type TaskStatus = 'queued' | 'planning' | 'running' | 'cancelling' | 'cancelled' | 'succeeded' | 'failed' | 'partial' | 'unknown' | 'interrupted'
export type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'skipped' | 'unknown'
export type TaskOrigin = 'chat' | 'live' | 'automation'
export interface InputBinding { inputField: string; fromStepId: string; outputField: string }
export interface PlanStep {
  id: string; capabilityId: string; args: Record<string, unknown>; dependsOn: string[]; bindings: InputBinding[]
  successCriterion: { verifierId: string; expected: unknown }
}
export interface TaskPlan { taskId: string; revision: number; steps: PlanStep[] }
export interface TaskRecord {
  taskId: string; origin: TaskOrigin; sessionId: number; status: TaskStatus; revision: number
  createdAt: string; updatedAt: string; stepStates: Record<string, StepStatus>; evidence: never[]; errorCode?: string
}
export type TaskMutation = { sequence: number } & (
  { type: 'planning' } | { type: 'plan_ready'; stepIds: string[] } |
  { type: 'step_started'; stepId: string } |
  { type: 'step_finished'; stepId: string; status: Exclude<StepStatus, 'pending' | 'running'> } |
  { type: 'cancel_requested' } |
  { type: 'finished'; status: Exclude<TaskStatus, 'queued' | 'planning' | 'running' | 'cancelling'> }
)
export interface TaskEvent {
  taskId: string; sequence: number; revision: number; type: TaskMutation['type']; stepId?: string
  summary: string; occurredAt: string
}
export const TASK_LIMITS = Object.freeze({ maxSteps: 8, timeoutMs: 120000, maxRevisions: 2 })
