import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS, type IpcChannel } from '../../shared'
import { getRemindersApplication } from '../modules/application'
import { getMainWindow } from '../windows/main-window'
import { exactFields } from '../modules/reminders/calendar'

export function registerRemindersIpc(guard: (event: IpcMainInvokeEvent, channel: IpcChannel) => void): void {
  const handle = (channel: IpcChannel, run: (payload: any) => unknown) => ipcMain.handle(channel, (event, payload: unknown) => {
    guard(event, channel)
    const win = getMainWindow()
    if (!win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('untrusted_reminder_window')
    return run(payload)
  })
  handle(IPC_CHANNELS.REMINDERS_LIST, payload => getRemindersApplication().dashboard.list(payload))
  handle(IPC_CHANNELS.REMINDERS_GET, payload => getRemindersApplication().dashboard.get(payload))
  handle(IPC_CHANNELS.REMINDERS_MUTATE, payload => getRemindersApplication().dashboard.mutate(payload))
  handle(IPC_CHANNELS.REMINDERS_PREFERENCES, payload => getRemindersApplication().dashboard.preferences(payload))
  handle(IPC_CHANNELS.REMINDERS_IMPORT, payload => getRemindersApplication().dashboard.import(payload))
  handle(IPC_CHANNELS.REMINDERS_EXPORT, payload => getRemindersApplication().dashboard.export(payload))
  handle(IPC_CHANNELS.REMINDERS_OVERDUE, async payload => {
    exactFields(payload, [], ['cursor', 'batchId'])
    const { dashboard, scheduler, store } = getRemindersApplication()
    dashboard.preferences({ type: 'get' }) // Same domain gate, independent of provider status.
    await scheduler.recover(new Date().toISOString())
    return store.pendingBatch(payload.cursor, payload.batchId)
  })
  handle(IPC_CHANNELS.REMINDERS_ACK_OVERDUE, payload => {
    exactFields(payload, ['batchId', 'observedTotal'])
    if (typeof payload.batchId !== 'string' || !Number.isSafeInteger(payload.observedTotal) || payload.observedTotal < 1) throw new Error('invalid_overdue_batch')
    return getRemindersApplication().scheduler.acknowledgeBatch(payload.batchId, payload.observedTotal)
  })
}
