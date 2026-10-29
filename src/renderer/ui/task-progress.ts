import type { TaskRecord, TaskStatus } from '@shared'
const LABELS: Record<TaskStatus, string> = { queued: 'Na fila', planning: 'Planejando', running: 'Executando', cancelling: 'Cancelando',
  cancelled: 'Cancelada', succeeded: 'Verificada', failed: 'Falhou', partial: 'Parcialmente verificada', unknown: 'Resultado desconhecido', interrupted: 'Interrompida — sem retomada automática' }
export function initializeTaskProgress(): void {
  const container = document.getElementById('task-progress')
  if (!container) return
  const tasks = new Map<string, TaskRecord>()
  const render = (): void => {
    container.hidden = tasks.size === 0
    container.replaceChildren(...[...tasks.values()].slice(-5).reverse().map(task => {
      const row = document.createElement('div')
      const label = document.createElement('span')
      const states = Object.values(task.stepStates)
      label.textContent = `Histórico de tarefas · ${task.origin === 'live' ? 'Chamada' : 'Chat'}: ${LABELS[task.status]} · ${states.filter(s => !['pending', 'running'].includes(s)).length}/${states.length} etapas`
      row.append(label)
      if (['queued', 'planning', 'running', 'cancelling'].includes(task.status)) {
        const cancel = document.createElement('button')
        cancel.type = 'button'; cancel.textContent = 'Cancelar tarefa'; cancel.disabled = task.status === 'cancelling'
        cancel.addEventListener('click', async () => {
          cancel.disabled = true
          try { accept(await window.electronAPI.cancelTask(task.taskId)) }
          catch { cancel.disabled = false; label.textContent = 'Não foi possível cancelar. Verifique a conexão do agente.' }
        })
        row.append(cancel)
      }
      return row
    }))
  }
  const accept = (task: TaskRecord): void => {
    const old = tasks.get(task.taskId)
    if (old && old.revision >= task.revision) return
    tasks.set(task.taskId, task)
    if (tasks.size > 100) tasks.delete(tasks.keys().next().value!)
    render()
  }
  const load = (): void => { void window.electronAPI.listTasks().then(list => { for (const task of [...list].reverse()) accept(task) }).catch(() => {}) }
  window.electronAPI.onTaskChanged(accept)
  window.electronAPI.onLicenseState(snapshot => {
    if (snapshot.state === 'unlocked') load()
    else { tasks.clear(); render() }
  })
  load()
}
