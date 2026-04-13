import { EventEmitter } from 'events'
import type { DevBoxManager } from './DevBoxManager'
import type { SshTunnelManager } from './SshTunnelManager'
import type { OpenSshProvisioner } from './OpenSshProvisioner'
import type { RsyncManager } from './RsyncManager'
import type { DevTunnelManager } from './DevTunnelManager'
import type { DevBoxConnectionInfo, DevBoxProvisioningState } from '@shared/devbox-types'
import { REMOTE_PORTS } from '@shared/constants'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - ssh2 has no type definitions
import type { Client } from 'ssh2'

type ConnectionState =
  | 'idle'
  | 'starting-devbox'
  | 'ensuring-ssh'
  | 'tunneling'
  | 'verifying'
  | 'ready'
  | 'disconnected'
  | 'failed'

interface ConnectionHandle {
  id: string
  devBoxName: string
  projectName: string
  state: ConnectionState
  tunnelId?: string
  connectionInfo?: DevBoxConnectionInfo
  error?: string
  startedAt: number
  readyAt?: number
}

export interface DevBoxConnectorEvents {
  'connection:starting': (connectionId: string) => void
  'connection:provisioning': (connectionId: string) => void
  'connection:tunneling': (connectionId: string) => void
  'connection:syncing': (connectionId: string) => void
  'connection:ready': (connectionId: string) => void
  'connection:failed': (connectionId: string, error: string) => void
  'connection:disconnected': (connectionId: string) => void
}

export declare interface DevBoxConnector {
  on<K extends keyof DevBoxConnectorEvents>(
    event: K,
    listener: DevBoxConnectorEvents[K]
  ): this
  emit<K extends keyof DevBoxConnectorEvents>(
    event: K,
    ...args: Parameters<DevBoxConnectorEvents[K]>
  ): boolean
}

export class DevBoxConnector extends EventEmitter {
  private connections = new Map<string, ConnectionHandle>()
  private sshClientFactory: () => any

  constructor(
    private devBoxManager: DevBoxManager,
    private sshTunnelManager: SshTunnelManager,
    private openSshProvisioner: OpenSshProvisioner,
    private devTunnelManager?: DevTunnelManager,
    private rsyncManager?: RsyncManager,
    sshClientFactory?: () => any
  ) {
    super()
    
    // Allow test injection of SSH client factory
    this.sshClientFactory = sshClientFactory || (() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Client } = require('ssh2')
      return new Client()
    })
  }

  async connect(
    devBoxName: string,
    projectName: string,
    sshConfig?: { keyPath?: string; localPort?: number; remotePort?: number }
  ): Promise<string> {
    const connectionId = `conn-${Date.now()}-${Math.random().toString(36).substring(7)}`
    const connection: ConnectionHandle = {
      id: connectionId,
      devBoxName,
      projectName,
      state: 'idle',
      startedAt: Date.now()
    }

    this.connections.set(connectionId, connection)

    try {
      // Preflight: check SSH tunnel config exists BEFORE starting Dev Box
      if (!this.devBoxManager.hasSshConfig(devBoxName)) {
        throw new Error(
          `No SSH tunnel configured for Dev Box "${devBoxName}". ` +
          'Run the setup script on your Dev Box via RDP to create a dev tunnel, ' +
          'then add the tunnel host to ~/.tangent/devbox-config.json under devBoxes.' +
          devBoxName
        )
      }

      // Step 1: Auto-start Dev Box
      this._updateState(connection, 'starting-devbox')
      this.emit('connection:starting', connectionId)

      const devBox = await this.devBoxManager.autoStart(
        projectName,
        devBoxName,
        (state: DevBoxProvisioningState) => {
          console.log(`[Tangent 2] Dev Box ${devBoxName} state: ${state}`)
        }
      )

      if (!devBox.connectionInfo) {
        throw new Error('Dev Box started but connection info unavailable. Check your devbox-config.json.')
      }

      connection.connectionInfo = devBox.connectionInfo

      if (!devBox.connectionInfo.sshConfigured) {
        throw new Error(
          `Dev Box "${devBoxName}" is running but no SSH tunnel is configured. ` +
          'Run the setup script on your Dev Box, then add tunnelHost to devbox-config.json.'
        )
      }

      console.log(`[Tangent 2] Dev Box ${devBoxName} tunnel: ${devBox.connectionInfo.tunnelId ?? devBox.connectionInfo.sshHost} as ${devBox.connectionInfo.sshUser}`)

      // Step 2: Connect via devtunnel CLI (maps remote SSH port to localhost)
      this._updateState(connection, 'ensuring-ssh')
      this.emit('connection:provisioning', connectionId)

      let sshHost = devBox.connectionInfo.sshHost
      let sshPort = devBox.connectionInfo.sshPort

      // If we have a DevTunnelManager and a tunnel ID, use `devtunnel connect`
      // to get authenticated access through the tunnel
      if (this.devTunnelManager && devBox.connectionInfo.tunnelId) {
        console.log(`[Tangent 2] Using devtunnel connect for ${devBox.connectionInfo.tunnelId}...`)
        const localSshPort = await this.devTunnelManager.connect(devBox.connectionInfo.tunnelId)
        sshHost = '127.0.0.1'
        sshPort = localSshPort
        console.log(`[Tangent 2] DevTunnel mapped SSH to localhost:${localSshPort}`)
      }

      // Create a modified connection info pointing to the local tunnel port
      const tunnelConnInfo = { ...devBox.connectionInfo, sshHost, sshPort }

      const sshKeyPath = sshConfig?.keyPath ?? devBox.connectionInfo.sshKeyPath
      const sshClient = await this._createSshClient(tunnelConnInfo, sshKeyPath)
      const sshReady = await this.openSshProvisioner.ensureOpenSsh(sshClient)
      sshClient.end()

      if (!sshReady) {
        throw new Error('Failed to provision OpenSSH on Dev Box')
      }

      // Step 3: Establish SSH tunnel (for ACP port forwarding over the devtunnel)
      this._updateState(connection, 'tunneling')
      this.emit('connection:tunneling', connectionId)

      const acpLocalPort = sshConfig?.localPort || REMOTE_PORTS.ACP_LOCAL
      const acpRemotePort = sshConfig?.remotePort || devBox.connectionInfo.acpPort || REMOTE_PORTS.ACP_REMOTE
      const sshTunnelId = this.sshTunnelManager.createTunnel(
        tunnelConnInfo,
        acpLocalPort,
        acpRemotePort,
        sshKeyPath
      )
      connection.tunnelId = sshTunnelId
      connection.connectionInfo = tunnelConnInfo

      // Step 4: Verify tunnel health
      this._updateState(connection, 'verifying')

      await this._waitForTunnelReady(sshTunnelId, 5000) // 5s timeout

      // Step 5: Ready!
      this._updateState(connection, 'ready')
      connection.readyAt = Date.now()
      this.emit('connection:ready', connectionId)

      return connectionId
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[Tangent 2] Connection failed for ${devBoxName}:`, message)
      this._updateState(connection, 'failed', message)
      this.emit('connection:failed', connectionId, message)
      throw error
    }
  }

  async disconnect(connectionId: string, options?: { stopDevBox?: boolean }): Promise<void> {
    const connection = this.connections.get(connectionId)
    if (!connection) {
      console.warn(`[Tangent 2] Connection ${connectionId} not found`)
      return
    }

    try {
      // Close SSH tunnel
      if (connection.tunnelId) {
        this.sshTunnelManager.closeTunnel(connection.tunnelId)
      }

      // Optionally stop Dev Box
      if (options?.stopDevBox) {
        try {
          await this.devBoxManager.stopDevBox(connection.projectName, connection.devBoxName)
          console.log(`[Tangent 2] Dev Box ${connection.devBoxName} stopped`)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          console.warn(`[Tangent 2] Failed to stop Dev Box:`, message)
        }
      }

      this._updateState(connection, 'disconnected')
      this.emit('connection:disconnected', connectionId)
      this.connections.delete(connectionId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[Tangent 2] Error during disconnect:`, message)
      this._updateState(connection, 'failed', message)
    }
  }

  async syncWorkspaceOut(
    connectionId: string,
    localPath: string,
    remoteBasePath: string
  ): Promise<{ success: boolean; error?: string }> {
    const connection = this.connections.get(connectionId)
    if (!connection) {
      return { success: false, error: `Connection ${connectionId} not found` }
    }

    if (!connection.connectionInfo) {
      return { success: false, error: 'Connection info unavailable' }
    }

    if (!this.rsyncManager) {
      return { success: false, error: 'RsyncManager not configured' }
    }

    try {
      this.emit('connection:syncing', connectionId)
      
      const result = await this.rsyncManager.syncOutbound(
        localPath,
        remoteBasePath,
        connection.connectionInfo.sshHost,
        connection.connectionInfo.sshUser
      )

      if (!result.success) {
        console.warn(`[Tangent 2] Workspace sync failed:`, result.error)
        return { success: false, error: result.error }
      }

      console.log(
        `[Tangent 2] Workspace synced: ${result.filesSynced} files, ${result.bytesTransferred} bytes`
      )
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[Tangent 2] Workspace sync error:`, message)
      return { success: false, error: message }
    }
  }

  getStatus(connectionId: string): ConnectionHandle | undefined {
    const connection = this.connections.get(connectionId)
    if (!connection) {
      return undefined
    }

    if (connection.tunnelId) {
      const tunnelStatus = this.sshTunnelManager.getTunnelStatus(connection.tunnelId)
      if (tunnelStatus && tunnelStatus.status === 'error') {
        this._updateState(connection, 'failed', tunnelStatus.error)
      }
    }

    return { ...connection }
  }

  private _updateState(connection: ConnectionHandle, state: ConnectionState, error?: string): void {
    connection.state = state
    if (error) {
      connection.error = error
    }
  }

  private async _createSshClient(
    connectionInfo: DevBoxConnectionInfo,
    keyPath?: string
  ): Promise<Client> {
    return new Promise((resolve, reject) => {
      const client = this.sshClientFactory()

      client.on('ready', () => {
        resolve(client)
      })

      client.on('error', (err: any) => {
        console.warn('[Tangent 2] SSH client connection error:', err.message)
        reject(err)
      })

      const config: any = {
        host: connectionInfo.sshHost,
        port: connectionInfo.sshPort,
        username: connectionInfo.sshUser,
        readyTimeout: 30000
      }

      if (keyPath) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const fs = require('fs')
        config.privateKey = fs.readFileSync(keyPath)
      }

      client.connect(config)
    })
  }

  private async _waitForTunnelReady(tunnelId: string, timeoutMs: number): Promise<void> {
    const startTime = Date.now()
    const pollInterval = 100 // 100ms for faster testing

    while (Date.now() - startTime < timeoutMs) {
      const status = this.sshTunnelManager.getTunnelStatus(tunnelId)

      if (!status) {
        throw new Error('Tunnel status unavailable')
      }

      if (status.status === 'connected') {
        return
      }

      if (status.status === 'error') {
        throw new Error(`Tunnel error: ${status.error || 'unknown'}`)
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval))
    }

    throw new Error('Timeout waiting for tunnel to be ready')
  }
}
