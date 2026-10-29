import { initializeTaskProgress } from '../src/renderer/ui/task-progress'
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const tick = () => new Promise(resolve => setTimeout(resolve, 20))
async function run() {
  document.body.innerHTML = '<section id="task-progress" hidden></section>'
  let receive: (value: any) => void = () => {}
  const calls: string[] = []
  Object.defineProperty(window, 'electronAPI', { value: {
    listTasks: async () => [],
    onTaskChanged: (callback: typeof receive) => { receive = callback; return () => {} },
    onLicenseState: () => () => {},
    cancelTask: async (id: string) => { calls.push(id); return { ...task, status: 'cancelling', revision: 2 } }
  } })
  const task = { taskId: 'id', origin: 'chat', status: 'running', revision: 1, stepStates: { a: 'running', b: 'pending' } }
  initializeTaskProgress()
  await tick()
  receive(task)
  assert(!document.querySelector<HTMLElement>('#task-progress')!.hidden, 'Missing task panel')
  assert(document.querySelector('#task-progress')!.textContent!.includes('Histórico de tarefas'), 'Old tasks must be identified as history')
  document.querySelector<HTMLButtonElement>('#task-progress button')!.click()
  await tick()
  assert(calls[0] === 'id', 'Cancel did not target task ID')
  assert(document.querySelector('#task-progress')!.textContent!.includes('Cancelando'), 'Cancellation announced terminal state too early')
  receive({ ...task, revision: 0, status: 'succeeded' })
  assert(!document.querySelector('#task-progress')!.textContent!.includes('Verificada'), 'Stale state replaced latest revision')
  receive({ ...task, revision: 3, status: 'unknown' })
  assert(document.querySelector('#task-progress')!.textContent!.includes('Resultado desconhecido'), 'Uncertain effect hidden')
  console.log('TASK_PROGRESS_PASS')
}
run().catch(error => console.error('TASK_PROGRESS_FAIL', String(error)))
