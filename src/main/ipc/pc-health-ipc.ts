import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS, type IpcChannel, type PcHealthPreferencesRequest } from '../../shared'
import { getPcHealthApplication } from '../modules/application'
import { getMainWindow } from '../windows/main-window'
import { exactFields } from '../modules/reminders/calendar'
export function registerPcHealthIpc(guard: (event: IpcMainInvokeEvent, channel: IpcChannel) => void) {
  const handle = (channel: IpcChannel, run: (value: any) => unknown) => ipcMain.handle(channel, (event, value) => {
    guard(event, channel)
    const win = getMainWindow()
    if (!win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('untrusted_health_window')
    return run(value)
  })
  handle(IPC_CHANNELS.PC_HEALTH_GET, payload => { if (payload !== undefined) throw new Error('invalid_health_request'); return getPcHealthApplication().state() })
  handle(IPC_CHANNELS.PC_HEALTH_REFRESH, payload => { if (payload !== undefined) throw new Error('invalid_health_request'); return getPcHealthApplication().read() })
  handle(IPC_CHANNELS.PC_HEALTH_PREFERENCES, (payload: PcHealthPreferencesRequest) => {
    if (payload?.type === 'get') { exactFields(payload, ['type']); return getPcHealthApplication().preferences() }
    exactFields(payload, ['type', 'patch', 'expectedRevision'])
    if (payload.type !== 'update') throw new Error('invalid_health_request')
    return getPcHealthApplication().configure(payload.patch, payload.expectedRevision)
  })
}
