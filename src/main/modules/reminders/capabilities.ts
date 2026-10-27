export const REMINDER_READ_CAPABILITIES: ReadonlySet<string> = new Set(['reminder_list', 'reminder_get'])
export const REMINDER_WRITE_CAPABILITIES: ReadonlySet<string> = new Set(['reminder_create', 'reminder_update', 'reminder_delete', 'reminder_complete', 'reminder_snooze'])
export const isReminderCapability = (id: string): boolean => REMINDER_READ_CAPABILITIES.has(id) || REMINDER_WRITE_CAPABILITIES.has(id)
