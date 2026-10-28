import { Notification } from 'electron'
import type { ReminderNotifier } from './scheduler'

export function electronReminderNotifier(visual?: ReminderNotifier): ReminderNotifier {
  const retained = new Set<Notification>()
  return {
    supported: () => Boolean(visual?.supported() || Notification.isSupported()),
    prepare: (item, hooks) => {
      // The Jasper window is the delivery proof when enabled. Windows' `show`
      // only means its API accepted the toast, even when banners are suppressed.
      const primary = visual?.supported() ? visual.prepare(item, hooks) : null
      const nativeHooks = primary ? { ...hooks, shown: () => {}, failed: () => {} } : hooks
      const notification = Notification.isSupported()
        ? new Notification({ title: item.title, body: item.description || 'Lembrete do Jasper', silent: true }) : null
      let timeout: ReturnType<typeof setTimeout> | undefined
      const release = () => { if (notification) retained.delete(notification) }
      const cancel = () => {
        if (timeout) clearTimeout(timeout)
        notification?.removeListener('show', nativeHooks.shown)
        notification?.removeListener('failed', nativeHooks.failed)
        primary?.cancel()
        // Keep accepted toasts alive until Windows closes them.
      }
      notification?.once('close', release)
      notification?.once('failed', release)
      notification?.once('show', nativeHooks.shown)
      notification?.once('failed', nativeHooks.failed)
      return {
        show: () => {
          if (!hooks.beforeShow()) { hooks.failed(); return }
          if (notification) {
            retained.add(notification)
            if (!primary) { timeout = setTimeout(() => { nativeHooks.failed(); release() }, 30_000); timeout.unref?.() }
            try { notification.show() } catch { release(); if (!primary) nativeHooks.failed() }
          }
          if (primary) primary.show()
          else if (!notification) hooks.failed()
        }, cancel
      }
    },
    close: () => {
      visual?.close?.()
      for (const notification of retained) { notification.removeAllListeners(); notification.close() }
      retained.clear()
    }
  }
}
