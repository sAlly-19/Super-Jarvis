import { randomUUID } from 'node:crypto'
import type { TaskRecord, TaskOrigin, TaskMutation, StepStatus, TaskStatus, TaskEvidence } from '../../shared/types/tasks'
import { StateDatabase, type StateTransaction } from '../storage/state-database'

const ACTIVE = ['queued', 'planning', 'running', 'cancelling']
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value)
const record = (row: Record<string, unknown>): TaskRecord => ({ taskId: String(row.task_id), origin: row.origin as TaskOrigin,
  sessionId: Number(row.session_id), status: row.status as TaskStatus, revision: Number(row.revision),
  createdAt: String(row.created_at), updatedAt: String(row.updated_at), stepStates: JSON.parse(String(row.step_states)), evidence: [] })

/** Metadata only. Caller-provided summaries, commands, plans and tool data never enter the database. */
export class TaskStore {
  constructor(private readonly database: StateDatabase) {}
  private hydrate(tx: StateTransaction, row: Record<string, unknown>): TaskRecord {
    const task = record(row)
    task.evidence = tx.prepare('SELECT * FROM task_evidence WHERE task_id=? ORDER BY observed_at,step_id').all(task.taskId).map(proof => ({
      stepId: String(proof.step_id), invocationId: String(proof.invocation_id), kind: String(proof.kind), reference: String(proof.reference), observedAt: String(proof.observed_at), verified: proof.verified === 1
    }))
    return task
  }
  public create(origin: TaskOrigin, sessionId: number): TaskRecord {
    if (!['chat', 'live', 'automation'].includes(origin) || !Number.isSafeInteger(sessionId) || sessionId < 0) throw new Error('invalid_task_origin')
    const taskId = randomUUID(), now = new Date().toISOString()
    this.database.transaction(tx => tx.prepare('INSERT INTO tasks (task_id,origin,session_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(taskId, origin, sessionId, 'queued', now, now))
    return this.get(taskId)!
  }
  public get(taskId: string): TaskRecord | null {
    return this.database.transaction(tx => { const row = tx.prepare('SELECT * FROM tasks WHERE task_id=?').get(taskId); return row ? this.hydrate(tx, row) : null })
  }
  public listActive(): TaskRecord[] { return this.database.transaction(tx => tx.prepare("SELECT * FROM tasks WHERE status IN ('queued','planning','running','cancelling') ORDER BY created_at").all().map(row => this.hydrate(tx, row))) }
  public list(): TaskRecord[] { return this.database.transaction(tx => tx.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 100').all().map(row => this.hydrate(tx, row))) }
  public appendEvent(taskId: string, expectedRevision: number, event: TaskMutation, hostVerified = false, evidence: TaskEvidence[] = []): TaskRecord {
    for (const proof of evidence) {
      if (!proof || Object.keys(proof).sort().join(',') !== 'invocationId,kind,observedAt,reference,stepId,verified'
        || proof.verified !== true || ![proof.stepId, proof.invocationId, proof.kind, proof.reference].every(value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value))
        || !Number.isFinite(Date.parse(proof.observedAt)) || event.type !== 'step_finished' || event.status !== 'succeeded' || event.stepId !== proof.stepId || !hostVerified) throw new Error('invalid_task_evidence')
    }
    const allowed: Record<string, string[]> = {
      planning: [], plan_ready: ['stepIds'], step_started: ['stepId'], step_finished: ['stepId', 'status'], cancel_requested: [], finished: ['status']
    }
    if (!event || !Object.hasOwn(allowed, event.type) || Object.keys(event).some(key => !['type', 'sequence', ...allowed[event.type]].includes(key))) throw new Error('invalid_task_event')
    return this.database.transaction(tx => {
      const row = tx.prepare('SELECT * FROM tasks WHERE task_id=?').get(taskId)
      if (!row) throw new Error('task_not_found')
      const task = this.hydrate(tx, row)
      if (task.revision !== expectedRevision) throw new Error('stale_task')
      if (event.sequence !== task.revision + 1) throw new Error('event_order')
      if (!ACTIVE.includes(task.status)) throw new Error('terminal_task')
      switch (event.type) {
        case 'planning':
          if (task.status !== 'queued') throw new Error('invalid_task_transition')
          task.status = 'planning'; break
        case 'plan_ready':
          if (task.status !== 'planning' || !Array.isArray(event.stepIds) || event.stepIds.length < 1 || event.stepIds.length > 8
            || !event.stepIds.every(id) || new Set(event.stepIds).size !== event.stepIds.length) throw new Error('invalid_task_plan')
          task.stepStates = Object.fromEntries(event.stepIds.map(step => [step, 'pending' as StepStatus])); task.status = 'running'; break
        case 'step_started':
          if (task.status !== 'running' || task.stepStates[event.stepId] !== 'pending' || Object.values(task.stepStates).includes('running')) throw new Error('invalid_step_transition')
          task.stepStates[event.stepId] = 'running'; break
        case 'step_finished':
          if (!['running', 'cancelling'].includes(task.status) || task.stepStates[event.stepId] !== 'running'
            || !['succeeded', 'failed', 'cancelled', 'skipped', 'unknown'].includes(event.status)) throw new Error('invalid_step_transition')
          if (event.status === 'succeeded' && !hostVerified) throw new Error('unverified_step')
          task.stepStates[event.stepId] = event.status; break
        case 'cancel_requested': task.status = 'cancelling'; break
        case 'finished': {
          const statuses = Object.values(task.stepStates)
          if (event.status === 'succeeded' && (!statuses.length || !statuses.every(status => status === 'succeeded'))) throw new Error('unverified_task')
          if (event.status === 'partial' && (!statuses.includes('succeeded') || statuses.includes('unknown') || statuses.every(status => status === 'succeeded'))) throw new Error('unverified_task')
          if (!['succeeded', 'partial', 'cancelled', 'failed', 'unknown', 'interrupted'].includes(event.status)) throw new Error('invalid_task_transition')
          if (statuses.includes('unknown') && event.status !== 'unknown') throw new Error('uncertain_effect')
          if (statuses.includes('running')) throw new Error('unfinished_step')
          if (event.status === 'cancelled' && statuses.includes('unknown')) throw new Error('uncertain_effect')
          task.status = event.status
          for (const step of Object.keys(task.stepStates)) if (task.stepStates[step] === 'pending') task.stepStates[step] = 'skipped'
          break
        }
      }
      const now = new Date().toISOString()
      for (const proof of evidence) tx.prepare('INSERT INTO task_evidence (task_id,step_id,invocation_id,kind,reference,observed_at,verified) VALUES (?,?,?,?,?,?,1)').run(taskId, proof.stepId, proof.invocationId, proof.kind, proof.reference, proof.observedAt)
      tx.prepare('INSERT INTO task_events (task_id,sequence,type,step_id,occurred_at) VALUES (?,?,?,?,?)').run(taskId, event.sequence, event.type, 'stepId' in event ? event.stepId : null, now)
      tx.prepare('UPDATE tasks SET status=?,revision=?,updated_at=?,step_states=? WHERE task_id=? AND revision=?').run(task.status, event.sequence, now, JSON.stringify(task.stepStates), taskId, expectedRevision)
      return { ...task, revision: event.sequence, updatedAt: now, evidence: [...task.evidence, ...evidence] }
    })
  }
  public markInterrupted(sessionId?: number, taskId?: string): TaskRecord[] {
    // No LIMIT: every active row must be reconciled, not only the visible history page.
    return this.database.transaction(tx => {
      const rows = tx.prepare("SELECT * FROM tasks WHERE status IN ('queued','planning','running','cancelling')" + (sessionId === undefined ? '' : ' AND session_id=?') + (taskId === undefined ? '' : ' AND task_id=?')).all(...(sessionId === undefined ? [] : [sessionId]), ...(taskId === undefined ? [] : [taskId]))
      const changed: TaskRecord[] = []
      for (const row of rows) {
        const task = this.hydrate(tx, row)
        const uncertain = Object.values(task.stepStates).some(status => status === 'running' || status === 'unknown')
        for (const step of Object.keys(task.stepStates)) {
          if (task.stepStates[step] === 'running') task.stepStates[step] = 'unknown'
          else if (task.stepStates[step] === 'pending') task.stepStates[step] = 'skipped'
        }
        const now = new Date().toISOString()
        tx.prepare('UPDATE tasks SET status=?,revision=revision+1,updated_at=?,step_states=? WHERE task_id=?').run(uncertain ? 'unknown' : 'interrupted', now, JSON.stringify(task.stepStates), task.taskId)
        tx.prepare('INSERT INTO task_events (task_id,sequence,type,occurred_at) VALUES (?,?,?,?)').run(task.taskId, task.revision + 1, 'finished', now)
        changed.push({ ...task, status: uncertain ? 'unknown' : 'interrupted', revision: task.revision + 1, updatedAt: now })
      }
      return changed
    })
  }
}
