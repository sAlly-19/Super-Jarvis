/**
 * Autonomy Subsystem Types for Jasper AI HUD
 */

export interface AutonomyConfig {
  enableScreenAwareness: boolean
  enableWindowTracker: boolean
  enableClipboardWatcher: boolean
  enableCronEngine: boolean
  enableDailyBriefing: boolean
  enableSystemHealth: boolean
  enableSemanticMemory: boolean
  enableKnowledgeGraph: boolean
  // OS & Workspace Autonomy modules
  enableHeadlessBrowser: boolean
  enableGitWatcher: boolean
  enableFolderOrganizer: boolean
  // Multi-Agent, Reflexion & Integrations
  enableSubagents: boolean
  enableReflexionLoop: boolean
  enableCalendarEmail: boolean
  enableWebhooks: boolean
  enableSmartHome: boolean
}

export interface SystemHealthData {
  cpuUsagePercent: number
  totalRamGb: number
  usedRamGb: number
  freeRamGb: number
  ramUsagePercent: number
  diskFreeGb?: number
  diskTotalGb?: number
  uptimeHours: number
  batteryPercent?: number
  isCharging?: boolean
  timestamp: number
}

export interface ScheduledTask {
  id: string
  title: string
  description?: string
  dueTimestamp: number
  recurrence: 'once' | 'daily' | 'hourly'
  completed: boolean
  createdAt: number
}

export interface AutonomyNotification {
  id: string
  type: 'info' | 'warning' | 'reminder' | 'clipboard' | 'window' | 'system'
  title: string
  message: string
  timestamp: number
  data?: any
  silentAudio?: boolean
}

export interface KnowledgeNode {
  id: string
  label: string
  type: 'Person' | 'Project' | 'Technology' | 'Preference' | 'Concept' | 'File'
  properties?: Record<string, any>
  createdAt: number
}

export interface KnowledgeEdge {
  id: string
  source: string
  target: string
  relation: string
  weight?: number
  createdAt: number
}

export interface KnowledgeGraphData {
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
}

export interface SemanticMemoryItem {
  id: string
  content: string
  category: 'fact' | 'preference' | 'conversation_summary' | 'task'
  tokens: string[]
  createdAt: number
  updatedAt: number
}

export interface BrowserScrapeResult {
  success: boolean
  url: string
  title: string
  content: string
  screenshotBase64?: string
  error?: string
}

export interface GitStatusResult {
  isGit: boolean
  branch: string
  modifiedFiles: string[]
  untrackedFiles: string[]
  deletedFiles: string[]
  lastCommit: string
  changesSummary: string
  suggestedCommitMessage?: string
}

export interface DuplicateFileGroup {
  hash: string
  files: string[]
  sizeBytes: number
}

export interface OldInstallerItem {
  name: string
  path: string
  daysOld: number
  sizeMb: number
}

export interface FolderScanResult {
  target: string
  totalFilesScanned: number
  duplicates: DuplicateFileGroup[]
  oldInstallers: OldInstallerItem[]
  totalReclaimableBytes: number
  summary: string
}

export interface FolderOrganizeResult {
  success: boolean
  dryRun: boolean
  targetDir: string
  movedFiles: Array<{ from: string; to: string; category: string }>
  summary: string
}

// ----------------------------------------------------
// Multi-Agent Swarm Types
// ----------------------------------------------------
export type SubagentRole = 'researcher' | 'coder' | 'tester' | 'analyst' | 'general'

export interface SubagentTask {
  id: string
  role: SubagentRole
  task: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  progressPercent: number
  result?: string
  error?: string
  startTime: number
  endTime?: number
}

// ----------------------------------------------------
// Reflexion & ReAct Framework Types
// ----------------------------------------------------
export type RiskLevel = 'SAFE' | 'MODERATE' | 'HIGH'

export interface ReflexionCheckResult {
  allowed: boolean
  riskLevel: RiskLevel
  reason?: string
  requiresConfirmation: boolean
  sanitizedArgs?: Record<string, any>
}

// ----------------------------------------------------
// Calendar & Email Types
// ----------------------------------------------------
export interface CalendarEvent {
  id: string
  title: string
  description?: string
  startDateTime: number
  endDateTime: number
  location?: string
  attendees?: string[]
}

export interface EmailSummary {
  id: string
  from: string
  subject: string
  date: number
  snippet: string
  isUrgent: boolean
  unread: boolean
}

// ----------------------------------------------------
// Webhooks & Workflow Integration Types
// ----------------------------------------------------
export interface WebhookConfig {
  name: string
  url: string
  method?: 'POST' | 'GET' | 'PUT'
  headers?: Record<string, string>
  description?: string
}

export interface WebhookTriggerResult {
  success: boolean
  status: number
  responseBody: string
  executionTimeMs: number
  error?: string
}

// ----------------------------------------------------
// Smart Home Integration Types
// ----------------------------------------------------
export interface SmartHomeEntity {
  entityId: string
  domain: string
  friendlyName: string
  state: string
  attributes?: Record<string, any>
}

export interface SmartHomeActionResult {
  success: boolean
  entityId: string
  action: string
  message: string
  error?: string
}



