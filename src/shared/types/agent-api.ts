export interface AgentStatusPayload {
  status: string
  message?: string
  model?: string
  voice?: string
  agent_name?: string
}

export interface RemindersAPI {
  listReminders(query: import('./reminders').ReminderListQuery): Promise<import('./reminders').ReminderPage>
  getReminder(id: string): Promise<import('./reminders').ReminderView | null>
  mutateReminder(request: import('./reminders').MutationRequest): Promise<void>
  reminderPreferences(request: import('./reminders').ReminderPreferencesRequest): Promise<import('./reminders').ReminderPreferences>
  importReminders(request: import('./reminders').ReminderImportAction): Promise<import('./reminders').ReminderImportResult>
  exportReminders(request: import('./reminders').ReminderExportRequest): Promise<boolean>
  getOverdueReminders(cursor?: string, batchId?: string): Promise<import('./reminders').ReminderOverdueSummary | null>
  acknowledgeOverdueReminders(batchId: string, observedTotal: number): Promise<boolean>
  onRemindersChanged(callback: () => void): () => void
  onOverdueReminders(callback: (batch: import('./reminders').ReminderOverdueSummary) => void): () => void
}

export interface AgentAudioPayload {
  audio_base64: string
  format: string
  text?: string
}

export interface ToolExecutionPayload {
  tool: string
  args: Record<string, unknown>
}

export interface ToolResultPayload {
  tool: string
  result: unknown
}

export interface UserTranscriptPayload {
  text: string
}
