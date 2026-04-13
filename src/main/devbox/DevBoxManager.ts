import { EventEmitter } from 'events'
import type {
  DevBoxResource,
  DevBoxProvisioningState,
  DevBoxConnectionInfo,
  DevBoxHealthStatus
} from '../../shared/devbox-types'

/**
 * NOTE: This implementation uses @microsoft/devbox-mcp package which bundles
 * the internal devcenter-internal-stable SDK. The public @azure/arm-devcenter
 * SDK is management plane only and doesn't support data plane operations like
 * listing user's Dev Boxes.
 * 
 * Future: Once Azure Dev Box data plane SDK is publicly available, migrate to it.
 * Current: This manager will need to spawn the MCP server as a child process
 * and communicate via JSON-RPC, or use the bundled SDK directly via dynamic import.
 */

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

export class DevBoxManager extends EventEmitter {
  // Will hold MCP client connection or direct SDK client when implemented
  private client: any = null

  constructor(client?: any) {
    super()
    if (client) {
      // Injected client (for testing)
      this.client = client
    } else {
      // Production: try to load MCP client
      this.initializeClient()
    }
  }

  private initializeClient(): void {
    try {
      // Dynamic import will be mocked in tests
      const { DevBoxClient } = require('@microsoft/devbox-mcp')
      this.client = new DevBoxClient()
    } catch (error) {
      // Silently fail if MCP package not available - tests will mock this
      console.log('[Tangent 2] DevBox MCP client not available')
    }
  }

  async initialize(): Promise<void> {
    try {
      // TODO: Initialize connection to Dev Box service
      // Option 1: Spawn @microsoft/devbox-mcp as child process and use JSON-RPC
      // Option 2: Import bundled devcenter-internal-stable SDK directly
      console.log('[Tangent 2] DevBoxManager initialized (placeholder)')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn('[Tangent 2] Failed to initialize DevBoxManager:', message)
    }
  }

  /**
   * List all Dev Boxes across all projects for the current user.
   * 
   * TODO: Implement using Dev Box data plane SDK or MCP server communication.
   * For now returns empty array as placeholder.
   */
  async listDevBoxes(): Promise<DevBoxResource[]> {
    try {
      // TODO: Call Dev Box API to list user's dev boxes
      // Scope: /projects/*/users/me/devboxes/* (read)
      console.log('[Tangent 2] listDevBoxes called (not yet implemented)')
      return []
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn('[Tangent 2] Failed to list dev boxes:', message)
      return []
    }
  }

  /**
   * Start a Dev Box.
   * 
   * TODO: Implement using Dev Box data plane SDK or MCP server.
   * Scope: /projects/{projectName}/users/me/devboxes/{devBoxName} (action: start)
   */
  async startDevBox(projectName: string, devBoxName: string): Promise<boolean> {
    try {
      console.log(`[Tangent 2] Starting Dev Box: ${projectName}/${devBoxName} (not yet implemented)`)
      
      if (!this.client) {
        return false
      }

      const result = await this.client.startDevBox(projectName, devBoxName)
      this.emit('devbox:state-changed', devBoxName, 'Starting')
      
      return result !== null && result !== undefined
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[Tangent 2] Failed to start Dev Box ${devBoxName}:`, message)
      this.emit('devbox:error', devBoxName, message)
      return false
    }
  }

  /**
   * Stop a Dev Box.
   * 
   * TODO: Implement using Dev Box data plane SDK or MCP server.
   * Scope: /projects/{projectName}/users/me/devboxes/{devBoxName} (action: stop)
   */
  async stopDevBox(projectName: string, devBoxName: string): Promise<boolean> {
    try {
      console.log(`[Tangent 2] Stopping Dev Box: ${projectName}/${devBoxName} (not yet implemented)`)
      
      // TODO: Call Dev Box API to stop the box
      // this.emit('devbox:state-changed', devBoxName, 'Stopping')
      // ... wait for completion ...
      // this.emit('devbox:state-changed', devBoxName, 'Stopped')
      
      return false // Not implemented
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[Tangent 2] Failed to stop Dev Box ${devBoxName}:`, message)
      this.emit('devbox:error', devBoxName, message)
      return false
    }
  }

  /**
   * Get connection information for a Dev Box.
   * 
   * TODO: Implement using Dev Box data plane SDK or MCP server.
   * Scope: /projects/{projectName}/users/me/devboxes/{devBoxName} (action: getRemoteConnection)
   */
  async getConnectionInfo(
    projectName: string,
    devBoxName: string
  ): Promise<DevBoxConnectionInfo | null> {
    try {
      console.log(`[Tangent 2] Getting connection info for ${projectName}/${devBoxName} (not yet implemented)`)
      
      // TODO: Call Dev Box API to get remote connection details
      // Parse SSH connection string and return connection info
      
      return null // Not implemented
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[Tangent 2] Failed to get connection info for ${devBoxName}:`, message)
      return null
    }
  }

  /**
   * Check health status of a Dev Box.
   * 
   * TODO: Implement using Dev Box state check + actual connectivity tests.
   * Should test both SSH (port 22) and ACP (port 7777) reachability.
   */
  async checkHealth(
    projectName: string,
    devBoxName: string
  ): Promise<DevBoxHealthStatus> {
    try {
      console.log(`[Tangent 2] Checking health for ${projectName}/${devBoxName} (not yet implemented)`)
      
      // TODO: Get Dev Box state from API
      // TODO: Test SSH connectivity (port 22)
      // TODO: Test ACP connectivity (port 7777)
      
      const health: DevBoxHealthStatus = {
        isHealthy: false,
        sshReachable: false,
        acpReachable: false,
        lastCheckAt: Date.now(),
        error: 'Health check not yet implemented'
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
   * 
   * @param projectName - Azure Dev Center project name
   * @param devBoxName - Name of the Dev Box to start
   * @param progressCallback - Optional callback for progress updates (state, elapsed time in ms)
   * @returns DevBoxResource with state 'Running' and connection info
   * @throws Error on timeout (5 minutes) or if Dev Box enters Failed state
   */
  async autoStart(
    projectName: string,
    devBoxName: string,
    progressCallback?: (state: DevBoxProvisioningState, elapsed: number) => void
  ): Promise<DevBoxResource> {
    const startTime = Date.now()
    const timeoutMs = 5 * 60 * 1000 // 5 minutes
    const pollIntervalMs = 5 * 1000 // 5 seconds

    try {
      console.log(`[Tangent 2] Auto-starting ${projectName}/${devBoxName}`)
      
      // Check current state first — if already running, skip start and return full resource
      const currentBox = await this.getDevBox(projectName, devBoxName)
      if (currentBox && currentBox.state === 'Running') {
        console.log(`[Tangent 2] Dev Box ${devBoxName} already running`)
        return currentBox
      }

      // Start the Dev Box
      progressCallback?.('Starting', Date.now() - startTime)
      const started = await this.startDevBox(projectName, devBoxName)
      if (!started) {
        throw new Error('Failed to start Dev Box')
      }

      // Poll until Running or timeout
      while (Date.now() - startTime < timeoutMs) {
        const devBox = await this.getDevBox(projectName, devBoxName)
        const state = devBox?.state || 'Failed'
        const elapsed = Date.now() - startTime
        
        // Report progress
        progressCallback?.(state, elapsed)
        
        // Success case
        if (state === 'Running') {
          console.log(`[Tangent 2] Dev Box ${devBoxName} reached Running state after ${elapsed}ms`)
          if (!devBox) {
            throw new Error('Dev Box is running but resource data unavailable')
          }
          return devBox
        }
        
        // Failure case
        if (state === 'Failed') {
          throw new Error(`Dev Box ${devBoxName} entered Failed state`)
        }
        
        // Continue polling
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
      }

      // Timeout
      const elapsed = Date.now() - startTime
      throw new Error(`Timeout waiting for Dev Box ${devBoxName} to start (${elapsed}ms elapsed)`)
      
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[Tangent 2] Failed to auto-start Dev Box ${devBoxName}:`, message)
      this.emit('devbox:error', devBoxName, message)
      throw error
    }
  }

  /**
   * Get Dev Box resource details.
   * Helper method for status polling.
   */
  private async getDevBox(
    projectName: string,
    devBoxName: string
  ): Promise<DevBoxResource | null> {
    try {
      console.log(`[Tangent 2] Getting Dev Box details for ${projectName}/${devBoxName} (not yet implemented)`)
      
      if (!this.client) {
        return null
      }

      const result = await this.client.getDevBox(projectName, devBoxName)
      return result || null
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[Tangent 2] Failed to get Dev Box details:`, message)
      return null
    }
  }

  dispose(): void {
    this.client = null
    this.removeAllListeners()
  }
}
