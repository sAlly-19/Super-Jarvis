export const IPC_CHANNELS = {
  // Audio streaming
  AUDIO_CHUNK: 'audio:chunk',

  // Chat
  CHAT_SEND: 'chat:send',

  // Gemini Connection
  GEMINI_CONNECT: 'gemini:connect',
  GEMINI_DISCONNECT: 'gemini:disconnect',

  // Configuration
  CONFIG_GET: 'config:get',
  CONFIG_SAVE: 'config:save',
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

  // Gemini Server Events (Main -> Renderer)
  GEMINI_AUDIO_CHUNK: 'gemini:audio-chunk',
  GEMINI_INTERRUPTED: 'gemini:interrupted',
  GEMINI_TURN_COMPLETE: 'gemini:turn-complete',
  GEMINI_TEXT_CHUNK: 'gemini:text-chunk',
  GEMINI_STATUS: 'gemini:status',

  // Autonomy & Proactive Services
  AUTONOMY_NOTIFICATION: 'autonomy:notification',
  AUTONOMY_SMART_HOME_TEST_CONNECTION: 'autonomy:smart-home-test-connection',
  AUTONOMY_REFLEXION_CONFIRMATION: 'autonomy:reflexion-confirmation',
  AUTONOMY_WEBHOOK_TEST: 'autonomy:webhook-test',
  DIALOG_SELECT_DIRECTORY: 'dialog:select-directory',

  // License & Node-Locking
  LICENSE_GET_STATUS: 'license:get-status',
  LICENSE_ACTIVATE: 'license:activate',
  LICENSE_GET_HWID: 'license:get-hwid',
  LICENSE_REVOKED: 'license:revoked',
  LICENSE_STATUS_CHANGED: 'license:status-changed',

  // Application updates
  UPDATE_GET_STATE: 'update:get-state',
  UPDATE_CHECK: 'update:check',
  UPDATE_DOWNLOAD: 'update:download',
  UPDATE_INSTALL: 'update:install',
  UPDATE_STATUS: 'update:status'
} as const

export type IpcChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS]

