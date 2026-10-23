export interface AgentStatusPayload {
  status: string
  message?: string
  model?: string
  voice?: string
  agent_name?: string
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
