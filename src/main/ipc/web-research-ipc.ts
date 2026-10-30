import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS as C, type IpcChannel } from '../../shared/constants/ipc-channels'
import type { WebResearchApplication } from '../modules/web-research/application'
import { isResearchId } from '../modules/web-research/history-codec'
import { WebNetworkPolicy } from '../modules/web-research/network-policy'
interface Dependencies {
  handle(channel: IpcChannel, handler: (event: IpcMainInvokeEvent, payload?: unknown) => unknown): void
  window(): Pick<BrowserWindow, 'isDestroyed' | 'webContents'> | null
  application(): WebResearchApplication
  openExternal(url: string): Promise<unknown>
}
function fields(value: unknown, keys: string[]): asserts value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length
    || keys.some(key => !Object.hasOwn(value, key))) throw Error('invalid_web_ipc')
}
export function registerWebResearchIpc(guard: (event: IpcMainInvokeEvent, channel: IpcChannel) => void, deps: Dependencies): void {
  const handle = (channel: IpcChannel, action: (payload: unknown) => unknown) => deps.handle(channel, (event, payload) => {
    guard(event, channel)
    const win = deps.window()
    if (!win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw Error('untrusted_web_window')
    return action(payload)
  })
  const empty = (value: unknown) => { if (value !== undefined) fields(value, []) }
  handle(C.WEB_RESEARCH_HISTORY_LIST, value => { empty(value); return deps.application().list() })
  handle(C.WEB_RESEARCH_HISTORY_GET, value => { fields(value, ['id']); if (!isResearchId(value.id)) throw Error('invalid_web_ipc'); return deps.application().get(value.id) })
  handle(C.WEB_RESEARCH_HISTORY_CLEAR, value => {
    fields(value, ['expectedGeneration'])
    if (!Number.isSafeInteger(value.expectedGeneration) || value.expectedGeneration < 0) throw Error('invalid_web_ipc')
    return deps.application().clear(value.expectedGeneration)
  })
  handle(C.WEB_RESEARCH_TEST, value => { empty(value); return deps.application().testConnection() })
  handle(C.WEB_RESEARCH_OPEN_SOURCE, async value => {
    fields(value, ['id', 'url'])
    if (!isResearchId(value.id) || typeof value.url !== 'string') throw Error('invalid_web_ipc')
    const record = deps.application().get(value.id)
    if (!record || ![...record.results, ...record.pages].some(source => source.url === value.url)) throw Error('invalid_web_source')
    const url = new WebNetworkPolicy().validateUrl(value.url).href
    await deps.openExternal(url)
  })
}
