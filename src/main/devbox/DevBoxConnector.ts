import { EventEmitter } from 'events'
import { createConnection as netCreateConnection } from 'net'
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
  acpLocalPort?: number  // The local port forwarded to remote ACP
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

      // Preflight: check devtunnel sign-in status up-front so we can give
      // a clear, actionable error before anything else times out.
      if (this.devTunnelManager) {
        const auth = await this.devTunnelManager.checkAuth()
        if (!auth.signedIn) {
          this.devTunnelManager.emit('auth:required', {
            reason: 'preflight-check',
            detail: auth.message ?? 'not signed in',
            message: 'Dev tunnel sign-in required. Click "Sign in" to open GitHub authentication.'
          })
          throw new Error(
            `Not signed in to dev tunnels (${auth.message ?? 'no identity'}). ` +
            `Click the "Sign in to dev tunnels" banner in Tangent, or run 'devtunnel user login -g' in a terminal.`
          )
        }
        console.log(`[Tangent] DevTunnel signed in${auth.identity ? ` as ${auth.identity}` : ''}`)
      }

      // Step 1: Auto-start Dev Box
      this._updateState(connection, 'starting-devbox')
      this.emit('connection:starting', connectionId)

      const devBox = await this.devBoxManager.autoStart(
        projectName,
        devBoxName,
        (state: DevBoxProvisioningState) => {
          console.log(`[Tangent] Dev Box ${devBoxName} state: ${state}`)
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

      console.log(`[Tangent] Dev Box ${devBoxName} tunnel: ${devBox.connectionInfo.tunnelId ?? devBox.connectionInfo.sshHost} as ${devBox.connectionInfo.sshUser}`)

      // Step 2: Connect via devtunnel CLI (direct ACP port forwarding)
      this._updateState(connection, 'tunneling')
      this.emit('connection:tunneling', connectionId)

      let acpLocalPort: number | undefined

      // If we have a DevTunnelManager and a tunnel ID, use `devtunnel connect`
      // to get authenticated direct port forwarding to ACP (no SSH middleman)
      if (this.devTunnelManager && devBox.connectionInfo.tunnelId) {
        console.log(`[Tangent] Using devtunnel connect for ${devBox.connectionInfo.tunnelId}...`)
        const tunnelPorts = await this.devTunnelManager.connect(devBox.connectionInfo.tunnelId)

        acpLocalPort = tunnelPorts.acpPort
        if (!acpLocalPort) {
          throw new Error(
            `Dev tunnel connected but ACP port (${REMOTE_PORTS.ACP_REMOTE}) not mapped. ` +
            `Run the setup script on your Dev Box to configure port ${REMOTE_PORTS.ACP_REMOTE}.`
          )
        }

        console.log(`[Tangent] DevTunnel mapped ACP port ${REMOTE_PORTS.ACP_REMOTE} → localhost:${acpLocalPort}`)
        if (tunnelPorts.sshPort) {
          console.log(`[Tangent] DevTunnel mapped SSH port 22 → localhost:${tunnelPorts.sshPort} (available for rsync)`)
        }
      } else {
        throw new Error('DevTunnelManager not configured or tunnel ID missing')
      }

      connection.acpLocalPort = acpLocalPort

      // Step 3: Verify ACP port is reachable.
      // The ACP server (embedded `copilot --ui-server`) typically needs
      // 20-45s to finish booting after the Dev Box reaches Running state.
      this._updateState(connection, 'verifying')

      try {
        await this._waitForAcpReady(acpLocalPort, 60_000)
      } catch (err) {
        // Enrich the timeout error with a current Dev Box state check so
        // the user knows whether to retry, sign in, or run setup.
        const base = err instanceof Error ? err.message : String(err)
        let hint = ''
        try {
          const current = await this.devBoxManager.getDevBox(projectName, devBoxName)
          if (current) {
            hint = ` Dev Box state: ${current.state}.`
            if (current.state !== 'Running') {
              hint += ' The Dev Box is not fully running — try again in a moment.'
            } else {
              hint += ' The agent server may still be starting. ' +
                'Verify that the setup script has been run on the Dev Box ' +
                `(port ${REMOTE_PORTS.ACP_REMOTE} must be listening).`
            }
          }
        } catch { /* ignore enrichment failure */ }
        throw new Error(`${base}.${hint}`)
      }

      // Step 5: Ready!
      this._updateState(connection, 'ready')
      connection.readyAt = Date.now()
      this.emit('connection:ready', connectionId)

      return connectionId
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[Tangent] Connection failed for ${devBoxName}:`, message)
      this._updateState(connection, 'failed', message)
      this.emit('connection:failed', connectionId, message)
      throw error
    }
  }

  async disconnect(connectionId: string, options?: { stopDevBox?: boolean }): Promise<void> {
    const connection = this.connections.get(connectionId)
    if (!connection) {
      console.warn(`[Tangent] Connection ${connectionId} not found`)
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
          console.log(`[Tangent] Dev Box ${connection.devBoxName} stopped`)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          console.warn(`[Tangent] Failed to stop Dev Box:`, message)
        }
      }

      this._updateState(connection, 'disconnected')
      this.emit('connection:disconnected', connectionId)
      this.connections.delete(connectionId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[Tangent] Error during disconnect:`, message)
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
        console.warn(`[Tangent] Workspace sync failed:`, result.error)
        return { success: false, error: result.error }
      }

      console.log(
        `[Tangent] Workspace synced: ${result.filesSynced} files, ${result.bytesTransferred} bytes`
      )
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[Tangent] Workspace sync error:`, message)
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
        console.warn('[Tangent] SSH client connection error:', err.message)
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

  private async _waitForAcpReady(localPort: number, timeoutMs: number): Promise<void> {
    const startTime = Date.now()
    const pollInterval = 500 // Poll every 500ms

    while (Date.now() - startTime < timeoutMs) {
      try {
        await new Promise<void>((resolve, reject) => {
          const socket = netCreateConnection({
            port: localPort,
            host: '127.0.0.1',
            timeout: 1000
          })

          socket.on('connect', () => {
            socket.end()
            resolve()
          })

          socket.on('error', (err: Error) => {
            reject(err)
          })

          socket.on('timeout', () => {
            socket.destroy()
            reject(new Error('Socket timeout'))
          })
        })

        console.log(`[Tangent] ACP port ${localPort} is reachable`)
        return
      } catch (err) {
        // Port not ready yet, continue polling
        await new Promise((resolve) => setTimeout(resolve, pollInterval))
      }
    }

    throw new Error(`Timeout waiting for ACP port ${localPort} to be ready`)
  }
}
