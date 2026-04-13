// === Session Status ===

export type SessionStatus =
  | 'shell_ready'
  | 'agent_launching'
  | 'agent_ready'
  | 'processing'
  | 'tool_executing'
  | 'needs_input'
  | 'failed'
  | 'exited'

export type AgentType = 'copilot-cli' | 'claude-code' | 'shell'

export type UIStatusLabel = 'shell' | 'running' | 'idle' | 'attention' | 'error'

// === Session Kind ===

export type SessionKind = 'shell' | 'copilot-sdk' | 'pty-agent' | 'remote-agent'

// === Session Metrics (from SDK) ===

export interface SessionMetrics {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cost: number
  totalPremiumRequests: number
  contextTokens?: number
  contextLimit?: number
}

// === Remote Session State ===

/**
 * State lifecycle for remote agent execution on Dev Boxes.
 * Tracks the progression from Dev Box startup through sync and ACP connection.
 */
export type RemoteSessionState =
  | 'starting-devbox'
  | 'syncing-out'
  | 'tunneling'
  | 'verifying-acp'
  | 'running'
  | 'syncing-back'

// === Remote Session Metrics ===

/**
 * Metrics for remote agent sessions running on Dev Boxes.
 * Tracks sync performance and tunnel reliability.
 */
export interface RemoteSessionMetrics {
  syncOutCount: number
  syncInCount: number
  totalBytesSynced: number
  tunnelUptime: number
  reconnectionCount: number
  avgSyncDurationMs: number
}

// === Session ===

export interface Session {
  id: string
  kind: SessionKind
  agentType: AgentType
  name: string
  folderName: string
  folderPath: string
  isRenamed: boolean
  status: SessionStatus
  lastActivity: string
  startedAt: number
  updatedAt: number
  ptyId: string
  exitCode?: number
  isExternal: boolean
  sourceFile?: string
  agentCommand?: string
  agentArgs?: string[]
  agentEnv?: Record<string, string>
  sdkSessionId?: string
  metrics?: SessionMetrics
  // Remote session fields (for kind = 'remote-agent')
  remoteState?: RemoteSessionState
  devBoxName?: string
  devBoxProject?: string
  remoteConnectionId?: string
  remoteSyncState?: 'idle' | 'syncing-out' | 'syncing-in'
  lastSyncTime?: number
  acpSessionId?: string
  remoteMetrics?: RemoteSessionMetrics
}

// === UI Status Indicator ===

export interface UIStatusIndicator {
  label: UIStatusLabel
  dotVisible: boolean
  dotColor: string | null
  dotAnimation: 'pulse-slow' | 'pulse-fast' | 'none'
  barColor: string | null
  bgTint: string
  bgTintSelected: string
  bgTintHover: string
  glowShadow: string
}

// === Agent Profiles ===

export interface AgentProfile {
  id: string
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
  cwdMode: 'activeSession'
  launchTarget: 'currentTab' | 'newTab' | 'path'
  cwdPath?: string
  // Remote execution configuration (opt-in per agent)
  remote?: {
    enabled: boolean
    devBoxProject?: string
    devBoxName?: string
    repoPath?: string
    sshUser?: string
  }
}

export interface ProjectFolder {
  id: string
  name: string
  agents: AgentProfile[]
  iconPath?: string
}

export interface AgentStoreData {
  version: 3
  groups: ProjectFolder[]
}

// === Tool Use Tracking ===

export type ToolUseKind = 'tool' | 'skill' | 'subagent'
export type ToolUseSource = 'built-in' | 'mcp' | 'skill'
export type ToolUseStatus = 'running' | 'success' | 'error'

export interface ToolUseEntry {
  id: string              // toolCallId from SDK
  sessionId: string
  kind: ToolUseKind
  name: string            // tool name, skill name, or agent name
  source: ToolUseSource
  status: ToolUseStatus
  startedAt: number
  completedAt?: number
  mcpServerName?: string  // MCP server that provided the tool
  mcpToolName?: string    // actual tool name within MCP server
  pluginName?: string     // plugin that provided the skill
  pluginVersion?: string
  args?: unknown          // tool arguments
  result?: string         // summary of result
  error?: string          // error message if failed
  progressMessage?: string
  parentToolCallId?: string // for nested/subagent calls
}

// === Human Context (for context-switching users) ===

export type PromptSource = 'terminal' | 'sdk'

export interface PromptEntry {
  text: string
  timestamp: number
  source: PromptSource
}

export interface ResumeSuggestion {
  icon: string
  text: string
  action?: string
}

export interface HumanContext {
  sessionId: string
  prompts: PromptEntry[]
  resumeSuggestion: ResumeSuggestion
  snapshot: {
    agentType: AgentType
    status: SessionStatus
    folderPath: string
    lastActiveAgo: number
    metrics?: SessionMetrics
  }
}

// === Status File (System A) ===

export interface StatusFile {
  status: 'ready' | 'processing' | 'tool' | 'input' | 'error'
  detail?: string
  updatedAt: number
}

// === IPC Event Types ===

export type SessionEvent =
  | { type: 'created'; session: Session }
  | { type: 'updated'; session: Session }
  | { type: 'closed'; sessionId: string }

// === OSC Sequence Data ===

export interface OscTitleChange {
  sessionId: string
  title: string
}

export interface OscProgressChange {
  sessionId: string
  state: 'hidden' | 'indeterminate' | 'normal' | 'error' | 'warning'
  progress: number
}
