export const IPC_CHANNELS = {
  // Agent traffic (Main <-> Renderer)
  AGENT_CONNECT: 'agent:connect',
  AGENT_DISCONNECT: 'agent:disconnect',
  AGENT_SEND_TEXT: 'agent:send-text',
  AGENT_SEND_AUDIO: 'agent:send-audio',
  AGENT_INTERRUPT: 'agent:interrupt',
  AGENT_GET_STATUS: 'agent:get-status',
  AGENT_LIVE_START: 'agent:live-start',
  AGENT_LIVE_STOP: 'agent:live-stop',
  AGENT_LIVE_AUDIO: 'agent:live-audio',

  // Agent events (Main -> Renderer)
  AGENT_STATUS: 'agent:status',
  AGENT_TEXT: 'agent:text',
  AGENT_AUDIO: 'agent:audio',
  AGENT_USER_TRANSCRIPT: 'agent:user-transcript',
  AGENT_TOOL_EXECUTION: 'agent:tool-execution',
  AGENT_TOOL_RESULT: 'agent:tool-result',
  AGENT_TURN_COMPLETE: 'agent:turn-complete',
  AGENT_INTERRUPTED: 'agent:interrupted',
  AGENT_ERROR: 'agent:error',

  // Compatibility aliases for renderer transition
  CHAT_SEND: 'agent:send-text',
  AUDIO_CHUNK: 'agent:send-audio',
  GEMINI_CONNECT: 'agent:connect',
  GEMINI_DISCONNECT: 'agent:disconnect',
  GEMINI_AUDIO_CHUNK: 'agent:audio',
  GEMINI_TEXT_CHUNK: 'agent:text',
  GEMINI_STATUS: 'agent:status',
  GEMINI_INTERRUPTED: 'agent:interrupted',
  GEMINI_TURN_COMPLETE: 'agent:turn-complete',

  // Configuration
  CONFIG_GET: 'config:get',
  CONFIG_SAVE: 'config:save',
  CONFIG_REMOVE_CREDENTIAL: 'config:remove-credential',
  CONFIG_AGENT_NAME_UPDATED: 'config:agent-name-updated',

  // Memory
  MEMORY_GET: 'memory:get',
  MEMORY_CLEAR: 'memory:clear',

  // Window Controls
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_TOGGLE_PIP: 'window:toggle-pip',
  WINDOW_PIP_CHANGE: 'window:pip-change',
  WINDOW_TOGGLE_FULLSCREEN: 'window:toggle-fullscreen',
  WINDOW_FULLSCREEN_CHANGE: 'window:fullscreen-change',

  // License & Node-Locking
  LICENSE_GET_STATUS: 'license:get-status',
  LICENSE_ACTIVATE: 'license:activate',
  LICENSE_GET_HWID: 'license:get-hwid',
  LICENSE_STATUS_CHANGED: 'license:status-changed',

  // Application updates
  UPDATE_GET_STATE: 'update:get-state',
  UPDATE_CHECK: 'update:check',
  UPDATE_DOWNLOAD: 'update:download',
  UPDATE_INSTALL: 'update:install',
  UPDATE_STATUS: 'update:status',

  // Dialog
  DIALOG_SELECT_DIRECTORY: 'dialog:select-directory',

  // Commercial Operational Consent
  CONSENT_GET_STATUS: 'consent:get-status',
  CONSENT_ACCEPT: 'consent:accept'
} as const

export type IpcChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS]

export const LOCKED_ALLOWED_CHANNELS: ReadonlySet<IpcChannel> = new Set([
  IPC_CHANNELS.LICENSE_GET_STATUS,
  IPC_CHANNELS.LICENSE_ACTIVATE,
  IPC_CHANNELS.LICENSE_GET_HWID,
  IPC_CHANNELS.WINDOW_MINIMIZE,
  IPC_CHANNELS.WINDOW_MAXIMIZE,
  IPC_CHANNELS.WINDOW_CLOSE,
  IPC_CHANNELS.WINDOW_TOGGLE_PIP,
  IPC_CHANNELS.WINDOW_TOGGLE_FULLSCREEN
])
