export type BackendMessageType =
  // Main -> Sidecar
  | 'hello'
  | 'config'
  | 'chat'
  | 'audio_input'
  | 'interrupt'
  | 'memory_snapshot'
  | 'shutdown'
  // Sidecar -> Main
  | 'hello_ack'
  | 'status'
  | 'user_transcript'
  | 'response'
  | 'audio_output'
  | 'tool_execution'
  | 'tool_result'
  | 'memory_upsert'
  | 'memory_clear'
  | 'turn_complete'
  | 'interrupted'
  | 'error'

export interface BackendEnvelope {
  version: 1
  id: string
  type: BackendMessageType
  payload: unknown
}

export const MAX_FRAME_BODY_LENGTH = 16 * 1024 * 1024 // 16 MiB
export const MAX_ID_LENGTH = 160
export const MAX_TYPE_LENGTH = 160
export const MAX_CHAT_TEXT_LENGTH = 20_000
