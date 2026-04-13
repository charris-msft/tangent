// === Dev Box Resource Types ===

/**
 * Provisioning state of a Dev Box resource.
 * Matches Azure Dev Center API states.
 */
export type DevBoxProvisioningState =
  | 'Creating'
  | 'Starting'
  | 'Running'
  | 'Stopping'
  | 'Stopped'
  | 'Failed'
  | 'Deleting'
  | 'Deleted'

/**
 * Health status of a Dev Box.
 * Used for connection validation and monitoring.
 */
export interface DevBoxHealthStatus {
  isHealthy: boolean
  sshReachable: boolean
  acpReachable: boolean
  lastCheckAt?: number
  error?: string
}

/**
 * Connection information for a Dev Box.
 * RDP fields come from the Azure API; SSH fields come from user config (dev tunnel).
 */
export interface DevBoxConnectionInfo {
  /** RDP web URL from Azure API (for browser-based access). */
  webUrl?: string
  /** RDP connection URL from Azure API (for native RDP client). */
  rdpConnectionUrl?: string
  /** SSH host — from user config (dev tunnel URL). Not from Azure API. */
  sshHost: string
  /** SSH port — defaults to 22. */
  sshPort: number
  /** SSH username on the Dev Box. */
  sshUser: string
  /** Path to SSH private key for auth (optional, uses ssh-agent if absent). */
  sshKeyPath?: string
  /** Whether SSH connectivity is configured (tunnel host in config). */
  sshConfigured: boolean
  /** Dev tunnel ID for `devtunnel connect` (e.g. "cpc-charr-d55kk-ssh"). */
  tunnelId?: string
  /** ACP port on the Dev Box for Copilot protocol (default 3000). */
  acpPort?: number
}

/**
 * Dev Box resource entity.
 * Represents a single Dev Box from Azure Dev Center.
 */
export interface DevBoxResource {
  id: string
  name: string
  projectName: string
  poolName: string
  state: DevBoxProvisioningState
  connectionInfo?: DevBoxConnectionInfo
  createdAt?: number
  lastUsedAt?: number
  osType: 'Windows' | 'Linux'
  location: string
  healthStatus?: DevBoxHealthStatus
}

/**
 * Dev Box project container.
 * Groups Dev Boxes by Azure Dev Center project.
 */
export interface DevBoxProject {
  name: string
  description?: string
  devBoxes: DevBoxResource[]
}

/**
 * User configuration for a Dev Box.
 * Stored in agent profile's `remote.devBox` field.
 */
export interface DevBoxConfig {
  projectName: string
  devBoxName: string
  autoStart?: boolean
  autoStop?: boolean
  stopDelayMinutes?: number
  sshKeyPath?: string
}

/**
 * Provisioning consent record.
 * Tracks user consent for first-time Dev Box setup.
 */
export interface DevBoxProvisioningConsent {
  devBoxName: string
  consentedAt: number
  changes: string[]
}

/**
 * Dev Box sync configuration.
 * Glob patterns for excluding files from workspace sync.
 */
export interface DevBoxSyncConfig {
  version: 1
  excludePatterns: string[]
}
