import type { BackendEnvelope } from '../../shared/types/backend-protocol'
import type { TaskMutation, TaskOrigin } from '../../shared/types/tasks'
import { validateTaskPayload } from './task-protocol'
import { TaskService } from './task-service'

export class TaskEventRouter {
  constructor(private readonly service: TaskService) {}
  public handle(frame: BackendEnvelope, sessionId: number) {
    validateTaskPayload('task_event', frame.payload)
    const p = frame.payload as { requestId: string; sessionId: number; taskId: string; expectedRevision: number; event: TaskMutation | { type: 'open'; origin: TaskOrigin } | { type: 'abandoned'; sequence: number } }
    const denied = { requestId: p.requestId, taskId: p.taskId, revision: p.expectedRevision, accepted: false, errorCode: 'task_event_rejected' }
    if (p.sessionId !== sessionId) return denied
    try {
      const task = p.event.type === 'open'
        ? (p.taskId === '' && p.expectedRevision === 0 ? this.service.open(p.event.origin, sessionId) : null)
        : p.event.type === 'abandoned' ? this.service.abandon(p.taskId, sessionId)
        : this.service.event(p.taskId, p.expectedRevision, p.event, sessionId)
      if (!task) return denied
      return { requestId: p.requestId, taskId: task.taskId, revision: task.revision, accepted: true }
    } catch {
      // CAS rejection may be the host's cancel_requested event, not an effect retry.
      try { denied.revision = this.service.get(p.taskId)?.revision ?? p.expectedRevision } catch {}
      return denied
    }
  }
}
