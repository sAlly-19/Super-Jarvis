export const HOST_TO_SIDECAR_MESSAGE_TYPES = [
  'hello',
  'config',
  'chat',
  'audio_input',
  'interrupt',
  'memory_snapshot',
  'memory_clear',
  'shutdown',
  'live_start',
  'live_audio',
  'live_stop'
] as const

export const SIDECAR_TO_HOST_MESSAGE_TYPES = [
  'hello_ack',
  'status',
  'user_transcript',
  'response',
  'audio_output',
  'tool_execution',
  'tool_result',
  'memory_upsert',
  'memory_clear',
  'turn_complete',
  'interrupted',
  'error'
] as const

export const BACKEND_MESSAGE_TYPES = [
  ...HOST_TO_SIDECAR_MESSAGE_TYPES,
  ...SIDECAR_TO_HOST_MESSAGE_TYPES.filter((type) => type !== 'memory_clear')
] as const

export type HostToSidecarMessageType = (typeof HOST_TO_SIDECAR_MESSAGE_TYPES)[number]
export type SidecarToHostMessageType = (typeof SIDECAR_TO_HOST_MESSAGE_TYPES)[number]
export type BackendMessageType = (typeof BACKEND_MESSAGE_TYPES)[number]

export interface BackendEnvelope<TPayload = unknown> {
  version: 1
  id: string
  replyTo?: string
  type: BackendMessageType
  payload: TPayload
}

export const MAX_FRAME_BODY_LENGTH = 16 * 1024 * 1024 // 16 MiB
export const MAX_ID_LENGTH = 160
export const MAX_TYPE_LENGTH = 160
export const MAX_CHAT_TEXT_LENGTH = 20_000
