import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS, type IpcChannel } from '../../shared/constants/ipc-channels'
import type { EmailApplication } from '../modules/email/application'
interface Dependencies {
  handle(channel: IpcChannel, handler: (event: IpcMainInvokeEvent, payload?: unknown) => unknown): void
  window(): Pick<BrowserWindow, 'isDestroyed' | 'webContents'> | null
  application(): EmailApplication
}
function fields(value: unknown, keys: string[]): asserts value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !(key in value))) throw new Error('invalid_email_ipc')
}
function id(value: unknown): asserts value is string { if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(value)) throw new Error('invalid_email_ipc') }
function revision(value: unknown): void { if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('invalid_email_ipc') }
export function registerEmailIpc(guard: (event: IpcMainInvokeEvent, channel: IpcChannel) => void, deps: Dependencies): void {
  const handle = (channel: IpcChannel, run: (payload: unknown) => unknown) => deps.handle(channel, (event, payload) => {
    guard(event, channel)
    const win = deps.window()
    if (!win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('untrusted_email_window')
    return run(payload)
  })
  const empty = (payload: unknown) => { if (payload !== undefined) fields(payload, []) }
  handle(IPC_CHANNELS.EMAIL_ACCOUNTS, payload => { empty(payload); return deps.application().state() })
  handle(IPC_CHANNELS.EMAIL_PREFERENCES, payload => { empty(payload); return deps.application().state().preferences })
  handle(IPC_CHANNELS.EMAIL_CONNECT, payload => { fields(payload, ['provider']); if (!['gmail', 'outlook'].includes(payload.provider)) throw new Error('invalid_email_ipc'); return deps.application().connect(payload.provider) })
  handle(IPC_CHANNELS.EMAIL_DISCONNECT, payload => { fields(payload, ['id', 'expectedRevision']); id(payload.id); revision(payload.expectedRevision); return deps.application().disconnect(payload.id, payload.expectedRevision) })
  handle(IPC_CHANNELS.EMAIL_DEFAULT, payload => { fields(payload, ['id', 'expectedRevision']); if (payload.id !== null) id(payload.id); revision(payload.expectedRevision); return deps.application().setDefault(payload.id, payload.expectedRevision) })
  handle(IPC_CHANNELS.EMAIL_UPLOADS, payload => { fields(payload, ['accountId']); id(payload.accountId); return deps.application().selectUploads(payload.accountId) })
  handle(IPC_CHANNELS.EMAIL_DOWNLOAD_DIRECTORY, payload => { fields(payload, ['accountId']); id(payload.accountId); return deps.application().selectDownloadDirectory(payload.accountId) })
}
