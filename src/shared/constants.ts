import type { StatusFile, SessionStatus } from './types'

// Status file value -> SessionStatus mapping
export const STATUS_FILE_MAP: Record<StatusFile['status'], SessionStatus> = {
  ready: 'agent_ready',
  processing: 'processing',
  tool: 'tool_executing',
  input: 'needs_input',
  error: 'failed'
}

// OSC 9;4 progress state codes (Windows Terminal spec)
export const OSC_PROGRESS_STATES = {
  0: 'hidden',
  1: 'normal',
  2: 'error',
  3: 'indeterminate',
  4: 'warning'
} as const

// Timing constants for System B debounce
export const STATUS_TIMING = {
  MIN_HOLD_MS: 500,
  PROMPT_SILENCE_MS: 300,
  FAILED_PERSIST_MS: 2000,
  FAILED_WINDOW_MS: 3000,
  ACTIVITY_TIMEOUT_MS: 60_000,
  AGENT_LAUNCH_TIMEOUT_MS: 30_000,
  OUTPUT_BUFFER_LINES: 20
} as const

// Default zoom
export const ZOOM = {
  DEFAULT: 14,
  MIN: 8,
  MAX: 32,
} as const

// Dev Center API resilience settings
export const DEVBOX_API = {
  /** Abort a single request after 30 seconds (fail fast, don't wait for 60s gateway timeout). */
  TIMEOUT_MS: 30_000,
  /** Number of retry attempts after the initial request fails. */
  MAX_RETRIES: 3,
  /** Fixed delay between retry attempts. */
  RETRY_DELAY_MS: 2_000,
  /** HTTP status codes that are safe to retry. */
  RETRYABLE_STATUS_CODES: [502, 503, 504] as readonly number[],
} as const

// Remote Dev Box / ACP port configuration
export const REMOTE_PORTS = {
  /** Port ACP server listens on inside the Dev Box. */
  ACP_REMOTE: 7333,
  /** Default local port for ACP if dev tunnel assigns dynamically. */
  ACP_LOCAL: 7777
} as const

/** Root directory on the Dev Box where agent workspaces are created. */
export const REMOTE_WORKSPACE_ROOT = 'C:\\Agents'

/**
 * Build a remote workspace path for an agent session.
 * Structure: {root}\{sanitized-agent-name}\{leaf-folder}
 * Example: C:\Agents\lego-1\lego1
 */
export function buildRemoteWorkspacePath(
  agentName: string,
  localPath: string,
  root: string = REMOTE_WORKSPACE_ROOT
): string {
  // Sanitize agent name for filesystem (replace non-alphanumeric with dash, lowercase)
  const safeName = agentName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  
  // Get leaf folder from localPath (e.g., "d:\git\demos\lego1" → "lego1")
  const parts = localPath.split(/[\\/]/).filter(Boolean)
  const leafFolder = parts.length > 0 ? parts[parts.length - 1] : 'workspace'
  
  return `${root}\\${safeName}\\${leafFolder}`
}
