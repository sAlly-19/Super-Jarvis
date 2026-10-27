import { Notification } from 'electron'
import type { ReminderNotifier } from './scheduler'

export function electronReminderNotifier(): ReminderNotifier {
  return {
    supported: () => Notification.isSupported(),
    prepare: (item, hooks) => {
      const notification = new Notification({ title: item.title, body: item.description || 'Lembrete do Jasper', silent: true })
      let timeout: ReturnType<typeof setTimeout> | undefined
      const cancel = () => {
        if (timeout) clearTimeout(timeout)
        notification.removeAllListeners()
        // Removing callbacks does not claim to recall a toast already accepted by Windows.
      }
      notification.once('show', hooks.shown)
      notification.once('failed', hooks.failed)
      return {
        show: () => {
          if (!hooks.beforeShow()) { hooks.failed(); return }
          timeout = setTimeout(hooks.failed, 30_000)
          timeout.unref?.()
          notification.show()
        }, cancel
      }
    }
  }
}
