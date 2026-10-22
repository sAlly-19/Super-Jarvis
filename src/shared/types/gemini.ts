export type GeminiStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'speaking'
  | 'listening'
  | 'error'

export interface GeminiLiveOptions {
  apiKey: string
  voiceName?: string
  model?: string
  enableSystemTools?: boolean
  enableMediaTools?: boolean
  agentName?: string
}

export interface ToolCallItem {
  id: string
  name: string
  args: Record<string, any>
}

export interface ToolResponseItem {
  id: string
  name: string
  response: {
    output: string
  }
}

export interface FunctionDeclaration {
  name: string
  description: string
  parameters: {
    type: string
    properties: Record<string, any>
    required?: string[]
  }
}

