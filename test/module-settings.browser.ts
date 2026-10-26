import { initializeModuleSettings } from '../src/renderer/ui/module-settings'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const tick = () => new Promise(resolve => setTimeout(resolve, 20))
async function run(): Promise<void> {
  document.body.innerHTML = '<button id="btn-settings">Settings</button><div id="module-settings-list"></div><p id="module-settings-feedback"></p><button id="module-settings-refresh">Refresh</button>'
  const computer = { id: 'computer', enabled: true, configured: true, authorized: true, health: 'healthy', lifecycle: 'running', revision: 0 }
  const future = { id: 'email', enabled: false, configured: false, authorized: true, health: 'unavailable', lifecycle: 'stopped', revision: 0 }
  let failWrite = false
  let pendingList: ((value: unknown) => void) | undefined
  const server = {
    listModules: async () => [structuredClone(computer), structuredClone(future)],
    setModuleEnabled: async (id: string, enabled: boolean, expectedRevision: number) => {
      assert(id === 'computer' && expectedRevision === computer.revision, 'Stale IPC payload')
      if (failWrite) throw new Error('simulated failure')
      computer.enabled = enabled
      computer.revision++
      return structuredClone(computer)
    },
    diagnoseModule: async () => structuredClone(computer)
  }
  Object.defineProperty(window, 'electronAPI', { value: server })
  initializeModuleSettings()
  document.getElementById('btn-settings')!.click()
  await tick()
  let toggles = document.querySelectorAll<HTMLInputElement>('#module-settings-list input')
  assert(toggles.length === 2 && toggles[0].checked, 'Active module not rendered')
  assert(toggles[1].disabled && !toggles[1].checked, 'Unimplemented module became interactive')
  assert(document.getElementById('module-settings-feedback')!.textContent!.includes('encerre e inicie a chamada novamente'), 'Missing manual Live reconnection guidance')
  toggles[0].click()
  await tick()
  assert(!computer.enabled && computer.revision === 1, 'Toggle did not persist through IPC')
  assert(!document.querySelector<HTMLInputElement>('#module-settings-list input')!.checked, 'Saved state not displayed')
  failWrite = true
  document.querySelector<HTMLInputElement>('#module-settings-list input')!.click()
  await tick()
  assert(!document.querySelector<HTMLInputElement>('#module-settings-list input')!.checked, 'Failed update left optimistic state')
  assert(document.getElementById('module-settings-feedback')!.textContent!.includes('Não foi possível'), 'Failure not reported')
  // An older list response must not replace newer state.
  server.listModules = async () => new Promise(resolve => { pendingList = resolve as (value: unknown) => void })
  document.getElementById('module-settings-refresh')!.click()
  await tick()
  const releaseOld = pendingList!
  server.listModules = async () => [structuredClone(computer), structuredClone(future)]
  document.getElementById('module-settings-refresh')!.click()
  await tick()
  releaseOld([{ ...computer, enabled: true }, future])
  await tick()
  assert(!document.querySelector<HTMLInputElement>('#module-settings-list input')!.checked, 'Late response overwrote current module state')
  console.log('MODULE_SETTINGS_PASS')
}
run().catch(error => console.error('MODULE_SETTINGS_FAIL', error.stack || String(error)))
