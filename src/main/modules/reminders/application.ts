import { powerMonitor } from 'electron'
import type { RemindersStore } from './store'
import { ReminderScheduler } from './scheduler'
import { electronReminderNotifier } from './notifier'
import { createVisualReminderNotifier } from './visual-notifier'
import type { SchedulerDependencies } from './scheduler'

/** Owns process-local timers/listeners only. No tray, service, autostart or provider dependency. */
export function startRemindersApplication(store: RemindersStore, allowed: () => boolean, presenter?: SchedulerDependencies['presenter']) {
  let suspended = false, closed = false
  const scheduler = new ReminderScheduler(store, {
    allowed: () => !closed && !suspended && allowed(), nowUtc: () => new Date().toISOString(), notifier: electronReminderNotifier(createVisualReminderNotifier()), presenter
  })
  const reconcile = () => {
    if (closed || suspended || !allowed()) { if (scheduler.isRunning()) scheduler.stop(); return }
    if (!scheduler.isRunning()) void scheduler.start().catch(() => {
      if (!closed) scheduler.stop()
      console.warn('[Reminders] Scheduler unavailable; no notification delivery claimed.')
    })
  }
  const suspend = () => { suspended = true; scheduler.stop() }
  const resume = () => { suspended = false; reconcile() }
  powerMonitor.on('suspend', suspend)
  powerMonitor.on('resume', resume)
  const supervisor = setInterval(reconcile, 1000)
  supervisor.unref?.()
  reconcile()
  return {
    scheduler,
    stop: () => { if (!closed) scheduler.stop() },
    close: () => {
      if (closed) return
      closed = true
      clearInterval(supervisor)
      powerMonitor.removeListener('suspend', suspend)
      powerMonitor.removeListener('resume', resume)
      scheduler.stop()
    }
  }
}
