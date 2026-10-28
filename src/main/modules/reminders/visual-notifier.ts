import { BrowserWindow, screen } from 'electron'
import { getMainWindow } from '../../windows/main-window'
import type { Reminder } from '../../../shared/types/reminders'
import type { NotificationHooks, ReminderNotifier } from './scheduler'

export interface ReminderPopup {
  loadURL(url: string): Promise<unknown>
  showInactive(): void
  isVisible(): boolean
  isDestroyed(): boolean
  close(): void
  once(event: 'closed', listener: () => void): unknown
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
function createPopup(title = 'Lembretes do Jasper'): ReminderPopup {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const width = Math.min(420, area.width), height = Math.min(360, area.height)
  const window = new BrowserWindow({
    width, height, x: area.x + area.width - width, y: area.y + area.height - height,
    title, show: false, alwaysOnTop: true, skipTaskbar: true,
    resizable: false, minimizable: false, maximizable: false, backgroundColor: '#101014',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false }
  })
  window.setMenu(null)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  return window
}

/** Visible without restoring the main window; no preload, script, network or new IPC. */
interface PopupOwner {
  once(event: 'closed', listener: () => void): unknown
  removeListener(event: 'closed', listener: () => void): unknown
}
export function createVisualReminderNotifier(open?: () => ReminderPopup, owner: () => PopupOwner | null = getMainWindow,
  copy = { title: 'Lembretes do Jasper', heading: 'Hora do lembrete', footer: 'Feche esta janela para dispensar o aviso. O lembrete continua salvo no Jasper.' }): ReminderNotifier {
  const openPopup = open ?? (() => createPopup(copy.title))
  type Entry = { title: string; description: string; hooks: NotificationHooks; shown: boolean; timer?: ReturnType<typeof setTimeout> }
  const entries = new Set<Entry>()
  let popup: ReminderPopup | null = null, generation = 0, queued = false
  const close = () => {
    generation++
    const previous = popup
    popup = null
    const pending = [...entries].filter(entry => !entry.shown)
    for (const entry of entries) if (entry.timer) clearTimeout(entry.timer)
    entries.clear()
    if (previous && !previous.isDestroyed()) previous.close()
    for (const entry of pending) entry.hooks.failed()
  }
  const schedule = () => {
    if (queued) return
    queued = true
    queueMicrotask(() => { queued = false; void render() })
  }
  const render = async () => {
    const current = ++generation
    for (const entry of entries) if (!entry.shown && !entry.hooks.beforeShow()) { if (entry.timer) clearTimeout(entry.timer); entries.delete(entry); entry.hooks.failed() }
    if (!entries.size) { close(); return }
    try {
      if (!popup || popup.isDestroyed()) {
        const created = openPopup()
        popup = created
        const main = owner(), closeWithMain = () => { if (popup === created) close() }
        main?.once('closed', closeWithMain)
        created.once('closed', () => { main?.removeListener('closed', closeWithMain); if (popup === created) close() })
      }
      const target = popup
      const rendered = [...entries]
      const content = rendered.map(entry => `<article><h2>${escapeHtml(entry.title)}</h2><p>${escapeHtml(entry.description || 'Este é o horário do seu lembrete.')}</p></article>`).join('')
      const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(copy.title)}</title><style>body{background:#101014;color:#fafafa;font:15px system-ui;margin:20px}h1{font-size:18px}h2{font-size:17px;overflow-wrap:anywhere}p{white-space:pre-wrap;overflow-wrap:anywhere;color:#ccc}article{border-top:1px solid #444;padding:8px 0}small{color:#aaa}</style><h1>${escapeHtml(copy.heading)}</h1>${content}<small>${escapeHtml(copy.footer)}</small></html>`
      await target.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      if (current !== generation || target !== popup || target.isDestroyed()) return
      // Authority may change while Chromium loads. Never show a revoked reminder.
      if (rendered.some(entry => !entry.shown && !entry.hooks.beforeShow())) { schedule(); return }
      target.showInactive()
      if (!target.isVisible()) throw new Error('reminder_popup_not_visible')
      for (const entry of rendered) if (entries.has(entry) && !entry.shown) { entry.shown = true; if (entry.timer) clearTimeout(entry.timer); entry.hooks.shown() }
    } catch {
      if (current === generation) close()
    }
  }
  return {
    supported: () => true,
    prepare: (item: Reminder, hooks: NotificationHooks) => {
      const entry: Entry = { title: item.title, description: item.description, hooks, shown: false }
      return {
        show: () => {
          if (!hooks.beforeShow()) { hooks.failed(); return }
          if (entries.has(entry)) return
          entries.add(entry)
          entry.timer = setTimeout(() => { if (entries.delete(entry)) { hooks.failed(); schedule() } }, 30_000)
          entry.timer.unref?.()
          schedule()
        },
        cancel: () => { if (entry.timer) clearTimeout(entry.timer); if (!entry.shown && entries.delete(entry)) schedule() }
      }
    }, close
  }
}
