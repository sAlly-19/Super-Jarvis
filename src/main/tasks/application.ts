import type { StateDatabase } from '../storage/state-database'
import { TaskStore } from './task-store'
import { TaskService, type TaskDependencies } from './task-service'
import { TaskEventRouter } from './task-event-router'
import { pythonBackend } from '../services/python-backend'
import { operationalAccess } from '../services/operational-access'
import { licenseGate } from '../services/license-gate'
import { safeSend } from '../windows/main-window'
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels'
let service: TaskService | undefined
export function initializeTaskApplication(database: StateDatabase, verification: Pick<TaskDependencies, 'verifyCapability' | 'releaseObservation' | 'clearObservations'> = {}): TaskService {
  if (service) return service
  const store = new TaskStore(database)
  store.markInterrupted()
  service = new TaskService(store, {
    ...verification,
    requireAccess: () => operationalAccess.requireAgentAccess(), sessionId: () => pythonBackend.getSessionId(),
    sendCancel: taskId => pythonBackend.notify('task_cancel', { taskId }),
    changed: task => safeSend(IPC_CHANNELS.TASKS_CHANGED, task)
  })
  const router = new TaskEventRouter(service)
  pythonBackend.onSessionEnded(sessionId => service!.interruptSession(sessionId))
  let previousSession: number | undefined
  pythonBackend.onMessage((frame, sessionId) => {
    if (sessionId !== pythonBackend.getSessionId()) return
    if (frame.type === 'hello_ack') {
      if (previousSession !== undefined && previousSession !== sessionId) service!.interruptSession(previousSession)
      previousSession = sessionId
    }
    if (frame.type === 'task_event') {
      try { pythonBackend.notify('task_event_ack', router.handle(frame, sessionId)) }
      catch { console.warn('[Tasks] Invalid task event.') }
    }
  })
  licenseGate.onStateChanged(snapshot => { if (snapshot.state !== 'unlocked') service!.interruptSession() })
  return service
}
export function getTaskService(): TaskService { if (!service) throw new Error('tasks_unavailable'); return service }
