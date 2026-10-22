export type UpdatePhase = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'

export interface UpdateState {
  phase: UpdatePhase
  currentVersion: string
  availableVersion?: string
  progressPercent?: number
  message: string
  portable: boolean
}
