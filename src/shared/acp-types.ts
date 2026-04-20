// === Agent Client Protocol (ACP) Types ===

/**
 * Connection state of an ACP session.
 * Tracks tunnel and protocol connection lifecycle.
 */
export type AcpConnectionState =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'failed'

/**
 * Workspace context for creating ACP sessions.
 * Mirrors local session environment on remote Dev Box.
 */
export interface AcpSessionConfig {
  cwd: string
  mcpServers?: Record<string, unknown>
  env?: Record<string, string>
  sessionId?: string // optional session ID to resume
}

/**
 * Active ACP session.
 * Represents a running agent session over ACP protocol.
 */
export interface AcpSession {
  id: string
  state: AcpConnectionState
  config: AcpSessionConfig
  createdAt: number
  lastActiveAt: number
  metrics?: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    cost: number
    totalPremiumRequests: number
  }
}

/**
 * Permission request from ACP server.
 * Agent asks user to approve/deny a tool execution or resource access.
 */
export interface AcpPermissionRequest {
  id: string
  sessionId: string
  action: string
  resource: string
  toolName?: string
  toolArgs?: unknown
  timestamp: number
}

/**
 * User's decision on a permission request.
 */
export interface AcpPermissionResponse {
  requestId: string
  approved: boolean
  rememberChoice?: boolean
}

/**
 * Structured response from ACP agent.
 * Includes text, tool executions, and status updates.
 */
export interface AcpAgentResponse {
  sessionId: string
  text?: string
  toolExecutions?: AcpToolExecution[]
  status?: 'processing' | 'tool_executing' | 'needs_input' | 'completed' | 'error'
  error?: string
  timestamp: number
}

/**
 * Tool execution record from ACP.
 * Matches structure of local ToolUseEntry but from remote protocol.
 */
export interface AcpToolExecution {
  id: string
  name: string
  source: 'built-in' | 'mcp' | 'skill'
  status: 'running' | 'success' | 'error'
  startedAt: number
  completedAt?: number
  mcpServerName?: string
  args?: unknown
  result?: string
  error?: string
  progressMessage?: string
}

/**
 * Base message type for ACP protocol communication.
 * All ACP messages extend this structure.
 */
export interface AcpMessage {
  type: string
  sessionId: string
  timestamp: number
  payload?: unknown
}

/**
 * ACP event types sent from server to client.
 * Matches JSON-RPC notification structure.
 */
export type AcpEvent =
  | { type: 'session.created'; session: AcpSession }
  | { type: 'session.updated'; session: AcpSession }
  | { type: 'session.closed'; sessionId: string }
  | { type: 'message.received'; message: AcpAgentResponse }
  | { type: 'permission.requested'; request: AcpPermissionRequest }
  | { type: 'status.changed'; sessionId: string; status: string }
  | { type: 'error'; sessionId: string; error: string }

/**
 * ACP connection options.
 * Configuration for establishing SSH tunnel and ACP protocol.
 */
export interface AcpConnectionOptions {
  host: string
  port: number
  username: string
  privateKeyPath?: string
  password?: string
  acpPort: number
  keepaliveInterval?: number
  reconnectDelay?: number
  maxReconnectAttempts?: number
}
