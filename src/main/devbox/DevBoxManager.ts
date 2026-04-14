import { EventEmitter } from 'events'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { DefaultAzureCredential, AzureCliCredential } from '@azure/identity'
import type {
  DevBoxResource,
  DevBoxProvisioningState,
  DevBoxConnectionInfo,
  DevBoxHealthStatus
} from '../../shared/devbox-types'
import { REMOTE_PORTS } from '@shared/constants'

const API_VERSION = '2024-02-01'
const TOKEN_SCOPE = 'https://devcenter.azure.com/.default'
const CONFIG_PATH = join(homedir(), '.tangent', 'devbox-config.json')

interface DevBoxTunnelConfig {
  tunnelHost: string
  tunnelId?: string
  sshUser: string
  sshPort?: number
  sshKeyPath?: string
}

interface DevBoxConfig {
  devCenterEndpoint: string
  projectName: string
  /** Per-devbox SSH tunnel configuration (keyed by Dev Box name). */
  devBoxes?: Record<string, DevBoxTunnelConfig>
  /** Legacy single-devbox fields (used if devBoxes map is absent). */
  tunnelHost?: string
  sshUser?: string
  sshKeyPath?: string
}

export interface DevBoxManagerEvents {
  'devbox:state-changed': (devBoxName: string, state: DevBoxProvisioningState) => void
  'devbox:health-updated': (devBoxName: string, health: DevBoxHealthStatus) => void
  'devbox:error': (devBoxName: string, error: string) => void
}

export declare interface DevBoxManager {
  on<K extends keyof DevBoxManagerEvents>(
    event: K,
    listener: DevBoxManagerEvents[K]
  ): this
  emit<K extends keyof DevBoxManagerEvents>(
    event: K,
    ...args: Parameters<DevBoxManagerEvents[K]>
  ): boolean
}

/**
 * Manages Dev Boxes via Azure Dev Center data-plane REST API.
 * Auth: @azure/identity DefaultAzureCredential (az login, env vars, managed identity).
 * Config: ~/.tangent/devbox-config.json with devCenterEndpoint + projectName.
 */
export class DevBoxManager extends EventEmitter {
  private config: DevBoxConfig | null = null
  private credential: DefaultAzureCredential | null = null
  private configError: string | null = null

  constructor(injectedConfig?: DevBoxConfig | null, injectedCredential?: DefaultAzureCredential | null) {
    super()
    if (injectedConfig !== undefined) {
      // Test injection path
      this.config = injectedConfig
      this.credential = injectedCredential ?? null
    } else {
      this.loadConfig()
    }
  }

  private loadConfig(): void {
    try {
      if (!existsSync(CONFIG_PATH)) {
        this.configError = `Config file not found: ${CONFIG_PATH}`
        console.log(`[Tangent] DevBox config not found at ${CONFIG_PATH}`)
        return
      }
      const raw = readFileSync(CONFIG_PATH, 'utf-8')
      const parsed = JSON.parse(raw)
      if (!parsed.devCenterEndpoint || !parsed.projectName) {
        this.configError = 'Config missing devCenterEndpoint or projectName'
        console.warn('[Tangent] DevBox config missing required fields')
        return
      }
      this.config = {
        devCenterEndpoint: parsed.devCenterEndpoint.replace(/\/+$/, ''),
        projectName: parsed.projectName
      }
      this.credential = new AzureCliCredential()
      console.log(`[Tangent] DevBox configured: ${this.config.devCenterEndpoint} / ${this.config.projectName} (using AzureCliCredential)`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.configError = `Failed to load config: ${message}`
      console.warn('[Tangent] Failed to load DevBox config:', message)
    }
  }

  /** Whether the manager has a valid config loaded. */
  get isConfigured(): boolean {
    return this.config !== null && this.credential !== null
  }

  /** Human-readable reason config is missing (for UI). */
  get configStatus(): string | null {
    return this.configError
  }

  // ---------------------------------------------------------------------------
  // Auth helper
  // ---------------------------------------------------------------------------

  private async getToken(): Promise<string> {
    if (!this.credential) {
      throw new Error('No Azure credential available')
    }
    const token = await this.credential.getToken(TOKEN_SCOPE)
    return token.token
  }

  // ---------------------------------------------------------------------------
  // REST helper
  // ---------------------------------------------------------------------------

  private async request<T>(method: string, path: string, retries = 2): Promise<T> {
    if (!this.config) throw new Error('DevBox not configured')
    const token = await this.getToken()
    const separator = path.includes('?') ? '&' : '?'
    const url = `${this.config.devCenterEndpoint}${path}${separator}api-version=${API_VERSION}`

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        })
        if (response.status === 504 || response.status === 503 || response.status === 429) {
          if (attempt < retries) {
            console.warn(`[Tangent] DevBox REST ${response.status}, retrying (${attempt + 1}/${retries})...`)
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
            continue
          }
        }
        if (!response.ok) {
          const body = await response.text().catch(() => '')
          throw new Error(`REST ${method} ${path} failed: ${response.status} ${response.statusText} ${body}`)
        }
        // Actions (start/stop) return 202 with no body
        if (response.status === 202 || response.status === 204) {
          return undefined as unknown as T
        }
        return response.json() as Promise<T>
      } catch (error) {
        if (attempt < retries && error instanceof TypeError) {
          // Network error — retry
          console.warn(`[Tangent] DevBox REST network error, retrying (${attempt + 1}/${retries})...`)
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
          continue
        }
        throw error
      }
    }
    throw new Error(`REST ${method} ${path} failed after ${retries} retries`)
  }

  // ---------------------------------------------------------------------------
  // Map API response to DevBoxResource
  // ---------------------------------------------------------------------------

  private mapDevBox(raw: any): DevBoxResource {
    return {
      id: raw.uniqueId ?? raw.name ?? '',
      name: raw.name ?? '',
      projectName: this.config?.projectName ?? '',
      poolName: raw.poolName ?? '',
      state: this.mapPowerState(raw.powerState, raw.provisioningState),
      osType: raw.osType === 'Linux' ? 'Linux' : 'Windows',
      location: raw.location ?? '',
      createdAt: raw.createdTime ? new Date(raw.createdTime).getTime() : undefined,
      connectionInfo: undefined
    }
  }

  private mapPowerState(powerState?: string, provisioningState?: string): DevBoxProvisioningState {
    if (provisioningState === 'Creating') return 'Creating'
    if (provisioningState === 'Deleting') return 'Deleting'
    if (provisioningState === 'Failed') return 'Failed'
    const ps = (powerState ?? '').toLowerCase()
    if (ps === 'running') return 'Running'
    if (ps === 'stopped' || ps === 'deallocated') return 'Stopped'
    if (ps === 'starting') return 'Starting'
    if (ps === 'stopping') return 'Stopping'
    if (ps === 'hibernated') return 'Stopped'
    return 'Stopped'
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  async initialize(): Promise<void> {
    if (!this.isConfigured) {
      console.log('[Tangent] DevBoxManager not configured — skipping initialization')
      return
    }
    console.log('[Tangent] DevBoxManager initialized')
  }

  /**
   * List all Dev Boxes for the current user in the configured project.
   * Returns empty array when not configured (does not crash).
   */
  async listDevBoxes(): Promise<DevBoxResource[]> {
    if (!this.isConfigured) return []
    try {
      const data = await this.request<{ value: any[] }>(
        'GET',
        `/projects/${this.config!.projectName}/users/me/devboxes`
      )
      return (data.value ?? []).map((raw) => this.mapDevBox(raw))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn('[Tangent] Failed to list dev boxes:', message)
      throw new Error(`Failed to list Dev Boxes: ${message}`)
    }
  }

  /**
   * Start a Dev Box. Returns true if the start was accepted.
   */
  async startDevBox(projectName: string, devBoxName: string): Promise<boolean> {
    if (!this.isConfigured) return false
    try {
      await this.request<void>(
        'POST',
        `/projects/${projectName}/users/me/devboxes/${devBoxName}:start`
      )
      this.emit('devbox:state-changed', devBoxName, 'Starting')
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[Tangent] Failed to start Dev Box ${devBoxName}:`, message)
      this.emit('devbox:error', devBoxName, message)
      return false
    }
  }

  /**
   * Stop a Dev Box. Returns true if the stop was accepted.
   */
  async stopDevBox(projectName: string, devBoxName: string): Promise<boolean> {
    if (!this.isConfigured) return false
    try {
      await this.request<void>(
        'POST',
        `/projects/${projectName}/users/me/devboxes/${devBoxName}:stop`
      )
      this.emit('devbox:state-changed', devBoxName, 'Stopping')
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[Tangent] Failed to stop Dev Box ${devBoxName}:`, message)
      this.emit('devbox:error', devBoxName, message)
      return false
    }
  }

  /**
   * Get connection info for a Dev Box.
   * Merges Azure API info (webUrl, rdpConnectionUrl) with local tunnel config.
   */
  async getConnectionInfo(
    projectName: string,
    devBoxName: string
  ): Promise<DevBoxConnectionInfo | null> {
    if (!this.isConfigured) return null
    try {
      const data = await this.request<any>(
        'GET',
        `/projects/${projectName}/users/me/devboxes/${devBoxName}/remoteConnection`
      )

      // Look up per-devbox tunnel config
      const tunnelCfg = this.getTunnelConfig(devBoxName)

      // Extract tunnel ID from the tunnel host URL if not explicitly set
      // e.g. "mbhj7258-22.usw2.devtunnels.ms" → tunnel ID is "mbhj7258"
      let tunnelId = tunnelCfg?.tunnelId
      if (!tunnelId && tunnelCfg?.tunnelHost) {
        const match = tunnelCfg.tunnelHost.match(/^([a-z0-9-]+?)(?:-\d+)?\./)
        if (match) tunnelId = match[1]
      }

      return {
        webUrl: data.webUrl ?? undefined,
        rdpConnectionUrl: data.rdpConnectionUrl ?? undefined,
        sshHost: tunnelCfg?.tunnelHost ?? '',
        sshPort: tunnelCfg?.sshPort ?? 22,
        sshUser: tunnelCfg?.sshUser ?? 'azureuser',
        sshKeyPath: tunnelCfg?.sshKeyPath,
        sshConfigured: !!tunnelCfg?.tunnelHost,
        tunnelId,
        acpPort: REMOTE_PORTS.ACP_REMOTE
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[Tangent] Failed to get connection info for ${devBoxName}:`, message)
      return null
    }
  }

  /**
   * Check whether a Dev Box has SSH tunnel configuration.
   * Use this as a preflight before auto-starting a Dev Box.
   */
  hasSshConfig(devBoxName: string): boolean {
    const cfg = this.getTunnelConfig(devBoxName)
    return !!cfg?.tunnelHost
  }

  /**
   * Get the tunnel configuration for a specific Dev Box.
   * Checks per-devbox map first, then falls back to top-level fields.
   */
  private getTunnelConfig(devBoxName: string): DevBoxTunnelConfig | null {
    if (!this.config) return null

    // Per-devbox config takes priority
    if (this.config.devBoxes?.[devBoxName]) {
      return this.config.devBoxes[devBoxName]
    }

    // Fall back to top-level fields (single Dev Box convenience)
    if (this.config.tunnelHost) {
      return {
        tunnelHost: this.config.tunnelHost,
        sshUser: this.config.sshUser ?? 'azureuser',
        sshKeyPath: this.config.sshKeyPath
      }
    }

    return null
  }

  /**
   * Check health by fetching Dev Box state from the API.
   */
  async checkHealth(
    projectName: string,
    devBoxName: string
  ): Promise<DevBoxHealthStatus> {
    try {
      const devBox = await this.getDevBox(projectName, devBoxName)
      const isRunning = devBox?.state === 'Running'
      const health: DevBoxHealthStatus = {
        isHealthy: isRunning,
        sshReachable: isRunning,
        acpReachable: false,
        lastCheckAt: Date.now()
      }
      if (!isRunning) {
        health.error = devBox ? `Dev Box state: ${devBox.state}` : 'Dev Box not found'
      }
      this.emit('devbox:health-updated', devBoxName, health)
      return health
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const health: DevBoxHealthStatus = {
        isHealthy: false,
        sshReachable: false,
        acpReachable: false,
        lastCheckAt: Date.now(),
        error: message
      }
      this.emit('devbox:health-updated', devBoxName, health)
      return health
    }
  }

  /**
   * Auto-start a Dev Box and poll until ready.
   * Orchestrates start + polling with progress reporting.
   */
  async autoStart(
    projectName: string,
    devBoxName: string,
    progressCallback?: (state: DevBoxProvisioningState, elapsed: number) => void
  ): Promise<DevBoxResource> {
    const startTime = Date.now()
    const timeoutMs = 5 * 60 * 1000
    const pollIntervalMs = 5 * 1000

    try {
      console.log(`[Tangent] Auto-starting ${projectName}/${devBoxName}`)

      const currentBox = await this.getDevBox(projectName, devBoxName)
      if (currentBox && currentBox.state === 'Running') {
        console.log(`[Tangent] Dev Box ${devBoxName} already running`)
        const connInfo = await this.getConnectionInfo(projectName, devBoxName)
        if (connInfo) {
          currentBox.connectionInfo = connInfo
        }
        return currentBox
      }

      progressCallback?.('Starting', Date.now() - startTime)
      const started = await this.startDevBox(projectName, devBoxName)
      if (!started) {
        throw new Error('Failed to start Dev Box')
      }

      while (Date.now() - startTime < timeoutMs) {
        const devBox = await this.getDevBox(projectName, devBoxName)
        const state = devBox?.state || 'Failed'
        const elapsed = Date.now() - startTime

        progressCallback?.(state, elapsed)

        if (state === 'Running') {
          console.log(`[Tangent] Dev Box ${devBoxName} reached Running state after ${elapsed}ms`)
          if (!devBox) throw new Error('Dev Box is running but resource data unavailable')
          // Fetch connection info (webUrl, rdpConnectionUrl)
          const connInfo = await this.getConnectionInfo(projectName, devBoxName)
          if (connInfo) {
            devBox.connectionInfo = connInfo
          }
          return devBox
        }

        if (state === 'Failed') {
          throw new Error(`Dev Box ${devBoxName} entered Failed state`)
        }

        await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
      }

      const elapsed = Date.now() - startTime
      throw new Error(`Timeout waiting for Dev Box ${devBoxName} to start (${elapsed}ms elapsed)`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[Tangent] Failed to auto-start Dev Box ${devBoxName}:`, message)
      this.emit('devbox:error', devBoxName, message)
      throw error
    }
  }

  /**
   * Get a single Dev Box by name via REST API.
   */
  async getDevBox(
    projectName: string,
    devBoxName: string
  ): Promise<DevBoxResource | null> {
    if (!this.isConfigured) return null
    try {
      const raw = await this.request<any>(
        'GET',
        `/projects/${projectName}/users/me/devboxes/${devBoxName}`
      )
      return this.mapDevBox(raw)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[Tangent] Failed to get Dev Box details:`, message)
      return null
    }
  }

  dispose(): void {
    this.credential = null
    this.config = null
    this.removeAllListeners()
  }
}
