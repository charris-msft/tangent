import { EventEmitter } from 'events'
import { StringDecoder } from 'string_decoder'
import type { DevBoxConnector } from '../devbox/DevBoxConnector'
import type { DevBoxProvisioner } from '../devbox/DevBoxProvisioner'
import type { AcpClient } from '../devbox/AcpClient'
import type { RsyncManager } from '../devbox/RsyncManager'
import type { SessionStore } from './SessionStore'
import type { PtyManager } from '../pty/PtyManager'
import type { AgentStore } from '../agents/AgentStore'
import { StatusEngine } from '../status/StatusEngine'
import type { AgentProfile, RemoteSessionState } from '@shared/types'
import type { AcpSessionConfig } from '@shared/acp-types'
import { REMOTE_PORTS, buildRemoteWorkspacePath } from '@shared/constants'
import { v4 as uuid } from 'uuid'

interface RemoteSessionHandle {
  sessionId: string
  agentProfile: AgentProfile
  localPath: string
  connectionId?: string
  acpSessionId?: string
  ptySocket?: import('net').Socket
  mode: 'acp' | 'pty'
  state: RemoteSessionState
  error?: string
  startedAt: number
  readyAt?: number
  reconnectionAttempts: number
}

export interface RemoteSessionManagerEvents {
  'remote:state-changed': (sessionId: string, state: RemoteSessionState) => void
  'remote:error': (sessionId: string, error: string) => void
  'remote:message': (sessionId: string, text: string) => void
  'remote:data': (sessionId: string, data: Buffer) => void
}

export declare interface RemoteSessionManager {
  on<K extends keyof RemoteSessionManagerEvents>(
    event: K,
    listener: RemoteSessionManagerEvents[K]
  ): this
  emit<K extends keyof RemoteSessionManagerEvents>(
    event: K,
    ...args: Parameters<RemoteSessionManagerEvents[K]>
  ): boolean
}

/**
 * RemoteSessionManager orchestrates the full lifecycle of remote Dev Box sessions:
 * 1. Connect to Dev Box (via DevBoxConnector)
 * 2. Check/run provisioning (via DevBoxProvisioner)
 * 3. Sync workspace outbound (via DevBoxConnector.syncWorkspaceOut)
 * 4. Create ACP session (via AcpClient)
 * 5. Launch agent on remote Dev Box
 * 6. Track session in SessionStore with remote state
 * 
 * Remote session state progression:
 * starting-devbox → syncing-out → tunneling → verifying-acp → running → syncing-back
 */
export class RemoteSessionManager extends EventEmitter {
  private remoteSessions = new Map<string, RemoteSessionHandle>()
  private reconnectionTimers = new Map<string, NodeJS.Timeout>()
  private statusEngines = new Map<string, StatusEngine>()
  private utf8Decoders = new Map<string, StringDecoder>()

  constructor(
    private devBoxConnector: DevBoxConnector,
    private devBoxProvisioner: DevBoxProvisioner,
    private acpClient: AcpClient,
    private rsyncManager: RsyncManager,
    private sessionStore: SessionStore,
    private ptyManager?: PtyManager,
    private agentStore?: AgentStore
  ) {
    super()

    // Listen to ACP messages and forward to session
    this.acpClient.on('acp:message', (response) => {
      const session = this.findSessionByAcpId(response.sessionId)
      if (session && response.text) {
        this.emit('remote:message', session.sessionId, response.text)
      }
    })

    // Listen to ACP errors
    this.acpClient.on('acp:error', (error) => {
      console.warn('[Tangent 2] RemoteSessionManager: ACP error:', error.message)
    })

    // P4.10: Listen to connection failures for auto-reconnect
    this.devBoxConnector.on('connection:failed', (connectionId, error) => {
      console.warn(`[Tangent 2] RemoteSessionManager: Connection failed: ${connectionId} - ${error}`)
      this._handleConnectionFailure(connectionId)
    })
  }

  /**
   * Create and launch a remote session on a Dev Box.
   * Orchestrates the full connection → provisioning → sync → ACP workflow.
   */
  async createRemoteSession(
    agentProfile: AgentProfile,
    localPath: string
  ): Promise<string> {
    if (!agentProfile.remote?.enabled) {
      throw new Error('Agent profile does not have remote execution enabled')
    }

    if (!agentProfile.remote.devBoxProject || !agentProfile.remote.devBoxName) {
      throw new Error('Agent profile missing Dev Box configuration')
    }

    // Default to PTY mode for full TUI; fall back to ACP if agent specifies it
    const remoteMode = agentProfile.remote.protocol === 'acp' ? 'acp' : 'pty'

    const sessionId = `remote-${Date.now()}-${Math.random().toString(36).substring(7)}`
    const handle: RemoteSessionHandle = {
      sessionId,
      agentProfile,
      localPath,
      mode: remoteMode,
      state: 'starting-devbox',
      startedAt: Date.now(),
      reconnectionAttempts: 0
    }

    this.remoteSessions.set(sessionId, handle)

    // Add to SessionStore
    const folderParts = localPath.split(/[\\/]/).filter(Boolean)
    const folderName = folderParts.length > 0 ? folderParts[folderParts.length - 1] : 'workspace'

    this.sessionStore.add({
      id: sessionId,
      kind: 'remote-agent',
      agentType: 'copilot-cli',
      name: agentProfile.name,
      folderName,
      folderPath: localPath,
      isRenamed: false,
      status: 'agent_launching',
      lastActivity: 'Connecting to Dev Box...',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      ptyId: '',
      isExternal: false,
      remoteState: 'starting-devbox',
      devBoxName: agentProfile.remote.devBoxName,
      devBoxProject: agentProfile.remote.devBoxProject
    })

    this._updateState(handle, 'starting-devbox')

    try {
      // Step 1: Connect to Dev Box (includes auto-start + SSH tunnel setup)
      console.log(
        `[Tangent 2] RemoteSessionManager: Connecting to Dev Box ${agentProfile.remote.devBoxName}...`
      )

      const connectionId = await this.devBoxConnector.connect(
        agentProfile.remote.devBoxName,
        agentProfile.remote.devBoxProject
      )

      handle.connectionId = connectionId

      // Wait for connection to be ready
      const connectionStatus = this.devBoxConnector.getStatus(connectionId)
      if (!connectionStatus || connectionStatus.state !== 'ready') {
        throw new Error('Dev Box connection failed to reach ready state')
      }

      // Step 2: Check provisioning state (skip provisioning if setup script was already run)
      console.log(`[Tangent 2] RemoteSessionManager: Checking provisioning...`)

      const isProvisioned = await this.devBoxProvisioner.isProvisioned(
        agentProfile.remote.devBoxName
      )

      if (!isProvisioned) {
        console.log(`[Tangent 2] RemoteSessionManager: Dev Box not yet provisioned, marking as provisioned (setup script should have been run)`)
        // Mark as provisioned — the setup script handles actual provisioning
        await this.devBoxProvisioner.markProvisioned(
          agentProfile.remote.devBoxName,
          ['Setup script completed externally']
        )
      }

      // Step 3: Sync workspace outbound (optional — skip if rsync not configured)
      this._updateState(handle, 'syncing-out')
      this.sessionStore.updateActivity(sessionId, 'Syncing workspace to Dev Box...')

      console.log(`[Tangent 2] RemoteSessionManager: Syncing workspace outbound...`)

      // Build remote workspace path: {root}\{agent-name}\{leaf-folder}
      const connInfo = connectionStatus.connectionInfo
      const remoteWorkspacePath = agentProfile.remote.repoPath
        || buildRemoteWorkspacePath(agentProfile.name, localPath)
      console.log(`[Tangent 2] RemoteSessionManager: Remote cwd = ${remoteWorkspacePath}`)
      try {
        const syncResult = await this.devBoxConnector.syncWorkspaceOut(
          connectionId,
          localPath,
          remoteWorkspacePath
        )

        if (!syncResult.success) {
          console.warn(`[Tangent 2] RemoteSessionManager: Workspace sync skipped: ${syncResult.error}`)
          // Non-fatal — continue without sync
        } else {
          console.log(`[Tangent 2] RemoteSessionManager: Workspace synced successfully`)
        }
      } catch (syncErr) {
        const msg = syncErr instanceof Error ? syncErr.message : String(syncErr)
        console.warn(`[Tangent 2] RemoteSessionManager: Workspace sync error (non-fatal): ${msg}`)
      }

      // Step 4+5: Connect to bridge (PTY or ACP mode)
      const acpLocalPort = connectionStatus.acpLocalPort ?? REMOTE_PORTS.ACP_LOCAL

      if (handle.mode === 'pty') {
        // PTY mode: raw TCP socket to pty-bridge, full TUI
        this._updateState(handle, 'tunneling')
        this.sessionStore.updateActivity(sessionId, 'Connecting to PTY bridge...')

        console.log(`[Tangent 2] RemoteSessionManager: Connecting PTY via tunnel port ${acpLocalPort}...`)

        const { createConnection } = await import('net')
        const ptySocket = createConnection({ host: '127.0.0.1', port: acpLocalPort })

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            ptySocket.destroy()
            reject(new Error(`PTY bridge connection timeout (port ${acpLocalPort})`))
          }, 15000)

          ptySocket.on('connect', () => {
            clearTimeout(timeout)
            resolve()
          })
          ptySocket.on('error', (err) => {
            clearTimeout(timeout)
            reject(err)
          })
        })

        handle.ptySocket = ptySocket
        console.log(`[Tangent 2] RemoteSessionManager: PTY bridge connected`)

        // Create StatusEngine for remote PTY status detection (OSC progress signals)
        const engine = new StatusEngine(sessionId, '', this.sessionStore)
        this.statusEngines.set(sessionId, engine)
        const decoder = new StringDecoder('utf8')
        this.utf8Decoders.set(sessionId, decoder)

        // Forward PTY output → terminal + StatusEngine
        ptySocket.on('data', (data: Buffer) => {
          this.emit('remote:data', sessionId, data)
          // Decode safely (handles split multi-byte UTF-8 chars across chunks)
          const text = decoder.write(data)
          if (text) {
            engine.feedRemotePty(text)
          }
        })

        ptySocket.on('close', () => {
          console.log(`[Tangent 2] RemoteSessionManager: PTY socket closed for ${sessionId}`)
          this._disposeStatusEngine(sessionId)
        })

        ptySocket.on('error', (err: Error) => {
          console.warn(`[Tangent 2] RemoteSessionManager: PTY socket error: ${err.message}`)
        })

        // Send CWD control frame so bridge spawns Copilot in the right directory
        // Control frame: \x00\x00\x02 + length(2BE) + utf8_bytes
        const cwdBytes = Buffer.from(remoteWorkspacePath, 'utf8')
        const cwdFrame = Buffer.alloc(5 + cwdBytes.length)
        cwdFrame[0] = 0x00
        cwdFrame[1] = 0x00
        cwdFrame[2] = 0x02
        cwdFrame.writeUInt16BE(cwdBytes.length, 3)
        cwdBytes.copy(cwdFrame, 5)
        ptySocket.write(cwdFrame)
        console.log(`[Tangent 2] RemoteSessionManager: Sent CWD control frame: ${remoteWorkspacePath}`)

        // Don't send initial newline — wait for the renderer to send
        // a terminal:resize (with correct size) which triggers the bridge
        // to spawn Copilot at the right dimensions.

      } else {
        // ACP mode: ndjson protocol (headless, no TUI)
        this._updateState(handle, 'tunneling')
        this.sessionStore.updateActivity(sessionId, 'Establishing ACP tunnel...')

        console.log(`[Tangent 2] RemoteSessionManager: Connecting ACP via tunnel...`)
        console.log(`[Tangent 2] RemoteSessionManager: ACP local port = ${acpLocalPort}`)

        try {
          await this.acpClient.connect({
            host: '127.0.0.1',
            port: acpLocalPort,
            username: connInfo?.sshUser ?? 'azureuser',
            acpPort: acpLocalPort
          })
        } catch (acpErr) {
          const acpMsg = acpErr instanceof Error ? acpErr.message : String(acpErr)
          if (acpMsg.includes('ECONNREFUSED')) {
            throw new Error(
              `No ACP service on Dev Box (port ${acpLocalPort}). ` +
              `Run 'node acp-test-server.js' on the Dev Box or start the Copilot agent runtime.`
            )
          }
          throw acpErr
        }

        this._updateState(handle, 'verifying-acp')
        this.sessionStore.updateActivity(sessionId, 'Connecting to agent...')

        console.log(`[Tangent 2] RemoteSessionManager: Creating ACP session...`)

        const acpConfig: AcpSessionConfig = {
          sessionId,
          cwd: remoteWorkspacePath,
          env: agentProfile.env
        }

        const acpSession = await this.acpClient.newSession(acpConfig)
        handle.acpSessionId = acpSession.id

        console.log(
          `[Tangent 2] RemoteSessionManager: ACP session created: ${acpSession.id}`
        )

        const session = this.sessionStore.get(sessionId)
        if (session) {
          session.acpSessionId = acpSession.id
          session.updatedAt = Date.now()
        }
      }

      // Step 6: Session is running
      this._updateState(handle, 'running')
      this.sessionStore.updateStatus(sessionId, 'agent_ready')
      this.sessionStore.updateActivity(sessionId, 'Ready')

      handle.readyAt = Date.now()

      console.log(
        `[Tangent 2] RemoteSessionManager: Remote session ready (${handle.readyAt - handle.startedAt}ms)`
      )

      return sessionId
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[Tangent 2] RemoteSessionManager: Failed to create session:`, message)

      this._disposeStatusEngine(sessionId)
      this._updateState(handle, 'starting-devbox', message)
      this.sessionStore.updateStatus(sessionId, 'failed')
      this.sessionStore.updateActivity(sessionId, `Error: ${message}`)
      this.emit('remote:error', sessionId, message)

      throw error
    }
  }

  /**
   * Get current state of a remote session.
   */
  getRemoteSession(sessionId: string): RemoteSessionHandle | undefined {
    return this.remoteSessions.get(sessionId)
  }

  /**
   * Send a prompt to the remote agent via ACP.
   */
  async sendPrompt(sessionId: string, text: string): Promise<void> {
    const handle = this.remoteSessions.get(sessionId)
    if (!handle) {
      throw new Error(`Remote session ${sessionId} not found`)
    }

    if (!handle.acpSessionId) {
      throw new Error(`Remote session ${sessionId} has no ACP session`)
    }

    if (handle.state !== 'running') {
      throw new Error(
        `Remote session ${sessionId} is not running (state: ${handle.state})`
      )
    }

    try {
      await this.acpClient.sendPrompt(sessionId, text)
      this.sessionStore.updateStatus(sessionId, 'processing')
      this.sessionStore.updateActivity(sessionId, 'Processing...')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(
        `[Tangent 2] RemoteSessionManager: Failed to send prompt:`,
        message
      )
      this.emit('remote:error', sessionId, message)
      throw error
    }
  }

  /**
   * Write raw terminal data to a PTY-mode remote session.
   * Data is forwarded directly to the pty-bridge TCP socket.
   */
  writePty(sessionId: string, data: string): void {
    const handle = this.remoteSessions.get(sessionId)
    if (!handle || handle.mode !== 'pty' || !handle.ptySocket) return

    handle.ptySocket.write(data)
  }

  /**
   * Resize the PTY for a remote session.
   * Sends a control frame: \x00\x00\x01 + cols(2BE) + rows(2BE)
   */
  resizePty(sessionId: string, cols: number, rows: number): void {
    const handle = this.remoteSessions.get(sessionId)
    if (!handle || handle.mode !== 'pty' || !handle.ptySocket) return

    const buf = Buffer.alloc(7)
    buf[0] = 0x00
    buf[1] = 0x00
    buf[2] = 0x01
    buf.writeUInt16BE(cols, 3)
    buf.writeUInt16BE(rows, 5)
    handle.ptySocket.write(buf)
  }

  /**
   * Check if a remote session is in PTY mode.
   */
  isPtyMode(sessionId: string): boolean {
    const handle = this.remoteSessions.get(sessionId)
    return handle?.mode === 'pty'
  }

  /**
   * Close a remote session gracefully.
   * Syncs workspace back to local, disconnects ACP, and closes Dev Box connection.
   */
  async closeRemoteSession(
    sessionId: string,
    options?: { stopDevBox?: boolean }
  ): Promise<void> {
    const handle = this.remoteSessions.get(sessionId)
    if (!handle) {
      console.warn(
        `[Tangent 2] RemoteSessionManager: Session ${sessionId} not found`
      )
      return
    }

    // Clear any pending reconnection timer
    const reconnectTimer = this.reconnectionTimers.get(sessionId)
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      this.reconnectionTimers.delete(sessionId)
    }

    try {
      // Step 1: Sync workspace back to local
      if (handle.connectionId && handle.state === 'running') {
        this._updateState(handle, 'syncing-back')
        this.sessionStore.updateActivity(sessionId, 'Syncing workspace from Dev Box...')

        console.log(`[Tangent 2] RemoteSessionManager: Syncing workspace inbound...`)

        const connectionStatus = this.devBoxConnector.getStatus(handle.connectionId)
        if (connectionStatus?.connectionInfo) {
          const remoteWorkspacePath =
            handle.agentProfile.remote?.repoPath || '/home/workspace'

          const syncResult = await this.rsyncManager.syncInbound(
            remoteWorkspacePath,
            handle.localPath,
            connectionStatus.connectionInfo.sshHost,
            connectionStatus.connectionInfo.sshUser
          )

          if (!syncResult.success) {
            console.warn(
              `[Tangent 2] RemoteSessionManager: Inbound sync failed: ${syncResult.error}`
            )
          } else {
            console.log(`[Tangent 2] RemoteSessionManager: Workspace synced back successfully`)
          }
        }
      }

      // Step 2: Close ACP session
      if (handle.acpSessionId) {
        try {
          await this.acpClient.closeSession(sessionId)
          console.log(`[Tangent 2] RemoteSessionManager: ACP session closed`)
        } catch (error) {
          console.warn(`[Tangent 2] RemoteSessionManager: Failed to close ACP session:`, error)
        }
      }

      // Step 3: Disconnect from Dev Box
      if (handle.connectionId) {
        await this.devBoxConnector.disconnect(handle.connectionId, {
          stopDevBox: options?.stopDevBox
        })
        console.log(`[Tangent 2] RemoteSessionManager: Dev Box disconnected`)
      }

      // Step 4: Clean up StatusEngine and decoder
      this._disposeStatusEngine(sessionId)

      // Step 5: Remove from SessionStore
      this.sessionStore.remove(sessionId)
      this.remoteSessions.delete(sessionId)

      console.log(`[Tangent 2] RemoteSessionManager: Remote session closed: ${sessionId}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(
        `[Tangent 2] RemoteSessionManager: Error during session close:`,
        message
      )
      this.emit('remote:error', sessionId, message)
    }
  }

  /**
   * Find a remote session by its Tangent session ID (which is mapped to ACP session).
   */
  private findSessionByAcpId(tangentSessionId: string): RemoteSessionHandle | undefined {
    // The ACP message handler receives sessionId which is the Tangent session ID
    // because we map it in AcpClient
    return this.remoteSessions.get(tangentSessionId)
  }

  /**
   * P4.10: Handle connection failure and trigger reconnection.
   */
  private _handleConnectionFailure(connectionId: string): void {
    // Find the session with this connection
    const session = Array.from(this.remoteSessions.values()).find(
      s => s.connectionId === connectionId
    )

    if (!session) {
      console.warn(
        `[Tangent 2] RemoteSessionManager: No session found for failed connection ${connectionId}`
      )
      return
    }

    // Only auto-reconnect if we were in running state
    if (session.state !== 'running') {
      console.log(
        `[Tangent 2] RemoteSessionManager: Session ${session.sessionId} not in running state, skipping reconnect`
      )
      return
    }

    console.log(
      `[Tangent 2] RemoteSessionManager: Triggering reconnect for session ${session.sessionId}`
    )
    this._reconnect(session)
  }

  /**
   * P4.10: Reconnect a remote session after connection failure.
   * Flow: close stale tunnel → re-establish tunnel → verify ACP → resume ACP session
   * Max 3 retry attempts with exponential backoff (1s, 2s, 4s)
   */
  private async _reconnect(handle: RemoteSessionHandle): Promise<void> {
    const MAX_RECONNECT_ATTEMPTS = 3
    const BASE_DELAY_MS = 1000

    // Clear any existing reconnection timer
    const existingTimer = this.reconnectionTimers.get(handle.sessionId)
    if (existingTimer) {
      clearTimeout(existingTimer)
      this.reconnectionTimers.delete(handle.sessionId)
    }

    handle.reconnectionAttempts++

    if (handle.reconnectionAttempts > MAX_RECONNECT_ATTEMPTS) {
      console.warn(
        `[Tangent 2] RemoteSessionManager: Max reconnection attempts reached for ${handle.sessionId}`
      )
      this._updateState(handle, 'running', 'Max reconnection attempts reached')
      this.sessionStore.updateStatus(handle.sessionId, 'failed')
      this.sessionStore.updateActivity(
        handle.sessionId,
        'Connection lost - max reconnection attempts reached'
      )
      this.emit('remote:error', handle.sessionId, 'Max reconnection attempts reached')
      return
    }

    // Calculate exponential backoff delay
    const delay = BASE_DELAY_MS * Math.pow(2, handle.reconnectionAttempts - 1)

    console.log(
      `[Tangent 2] RemoteSessionManager: Reconnection attempt ${handle.reconnectionAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms for ${handle.sessionId}`
    )

    this.sessionStore.updateActivity(
      handle.sessionId,
      `Reconnecting (attempt ${handle.reconnectionAttempts}/${MAX_RECONNECT_ATTEMPTS})...`
    )

    // Schedule reconnection with exponential backoff
    const timer = setTimeout(async () => {
      this.reconnectionTimers.delete(handle.sessionId)

      try {
        console.log(
          `[Tangent 2] RemoteSessionManager: Starting reconnection for ${handle.sessionId}`
        )

        // Step 1: Close stale tunnel if exists
        if (handle.connectionId) {
          try {
            await this.devBoxConnector.disconnect(handle.connectionId, {
              stopDevBox: false // Keep Dev Box running
            })
            console.log(
              `[Tangent 2] RemoteSessionManager: Closed stale connection ${handle.connectionId}`
            )
          } catch (error) {
            console.warn(
              `[Tangent 2] RemoteSessionManager: Error closing stale connection:`,
              error
            )
          }
        }

        // Step 2: Re-establish connection
        this._updateState(handle, 'starting-devbox')
        this.sessionStore.updateActivity(handle.sessionId, 'Reconnecting to Dev Box...')

        // Auto-start Dev Box if stopped
        const connectionId = await this.devBoxConnector.connect(
          handle.agentProfile.remote!.devBoxName!,
          handle.agentProfile.remote!.devBoxProject!
        )

        handle.connectionId = connectionId

        // Wait for connection ready
        const connectionStatus = this.devBoxConnector.getStatus(connectionId)
        if (!connectionStatus || connectionStatus.state !== 'ready') {
          throw new Error('Dev Box connection failed to reach ready state')
        }

        console.log(
          `[Tangent 2] RemoteSessionManager: Dev Box connection re-established: ${connectionId}`
        )

        // Step 3: Re-sync workspace (in case local changes occurred during disconnect)
        this._updateState(handle, 'syncing-out')
        this.sessionStore.updateActivity(handle.sessionId, 'Re-syncing workspace...')

        const remoteWorkspacePath = handle.agentProfile.remote?.repoPath || '/home/workspace'
        const syncResult = await this.devBoxConnector.syncWorkspaceOut(
          connectionId,
          handle.localPath,
          remoteWorkspacePath
        )

        if (!syncResult.success) {
          throw new Error(`Workspace sync failed: ${syncResult.error}`)
        }

        console.log(`[Tangent 2] RemoteSessionManager: Workspace re-synced`)

        // Step 4: Verify ACP connection and resume session
        this._updateState(handle, 'verifying-acp')
        this.sessionStore.updateActivity(handle.sessionId, 'Resuming agent session...')

        if (!handle.acpSessionId) {
          throw new Error('No ACP session ID to resume')
        }

        // Try to resume the existing ACP session
        console.log(
          `[Tangent 2] RemoteSessionManager: Resuming ACP session ${handle.acpSessionId}`
        )

        await this.acpClient.resumeSession(handle.sessionId)

        // Step 5: Back to running state
        this._updateState(handle, 'running')
        this.sessionStore.updateStatus(handle.sessionId, 'agent_ready')
        this.sessionStore.updateActivity(handle.sessionId, 'Reconnected')

        // Reset reconnection attempts on success
        handle.reconnectionAttempts = 0

        console.log(
          `[Tangent 2] RemoteSessionManager: Reconnection successful for ${handle.sessionId}`
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(
          `[Tangent 2] RemoteSessionManager: Reconnection attempt ${handle.reconnectionAttempts} failed:`,
          message
        )

        // Retry recursively with next attempt
        this._reconnect(handle)
      }
    }, delay)

    this.reconnectionTimers.set(handle.sessionId, timer)
  }

  /**
   * Update remote session state and emit events.
   */
  private _updateState(
    handle: RemoteSessionHandle,
    state: RemoteSessionState,
    error?: string
  ): void {
    handle.state = state
    if (error) {
      handle.error = error
    }

    // Update SessionStore
    const session = this.sessionStore.get(handle.sessionId)
    if (session) {
      session.remoteState = state
      session.updatedAt = Date.now()
    }

    this.emit('remote:state-changed', handle.sessionId, state)
  }

  /**
   * P4.12: Switch Dev Box for a remote session.
   * Disconnects from current Dev Box, connects to new Dev Box,
   * syncs workspace, and resumes ACP session.
   */
  async switchDevBox(sessionId: string, newDevBoxName: string): Promise<void> {
    const handle = this.remoteSessions.get(sessionId)
    if (!handle) {
      throw new Error(`Remote session ${sessionId} not found`)
    }

    console.log(
      `[Tangent 2] RemoteSessionManager: Switching Dev Box from ${handle.agentProfile.remote?.devBoxName} to ${newDevBoxName}`
    )

    try {
      // Step 1: Disconnect from current Dev Box
      if (handle.connectionId) {
        this.sessionStore.updateActivity(sessionId, 'Disconnecting from current Dev Box...')
        await this.devBoxConnector.disconnect(handle.connectionId, {
          stopDevBox: false
        })
        console.log(`[Tangent 2] RemoteSessionManager: Disconnected from current Dev Box`)
      }

      // Step 2: Connect to new Dev Box
      this._updateState(handle, 'starting-devbox')
      this.sessionStore.updateActivity(sessionId, `Connecting to ${newDevBoxName}...`)

      const connectionId = await this.devBoxConnector.connect(
        newDevBoxName,
        handle.agentProfile.remote!.devBoxProject!
      )

      handle.connectionId = connectionId

      // Wait for connection ready
      const connectionStatus = this.devBoxConnector.getStatus(connectionId)
      if (!connectionStatus || connectionStatus.state !== 'ready') {
        throw new Error('Dev Box connection failed to reach ready state')
      }

      console.log(`[Tangent 2] RemoteSessionManager: Connected to ${newDevBoxName}`)

      // Step 3: Sync workspace out to new Dev Box
      this._updateState(handle, 'syncing-out')
      this.sessionStore.updateActivity(sessionId, 'Syncing workspace to new Dev Box...')

      const remoteWorkspacePath = handle.agentProfile.remote?.repoPath || '/home/workspace'
      const syncResult = await this.devBoxConnector.syncWorkspaceOut(
        connectionId,
        handle.localPath,
        remoteWorkspacePath
      )

      if (!syncResult.success) {
        throw new Error(`Workspace sync failed: ${syncResult.error}`)
      }

      console.log(`[Tangent 2] RemoteSessionManager: Workspace synced to new Dev Box`)

      // Step 4: Resume ACP session (cloud-synced session ID)
      this._updateState(handle, 'verifying-acp')
      this.sessionStore.updateActivity(sessionId, 'Resuming agent session...')

      if (!handle.acpSessionId) {
        throw new Error('No ACP session ID to resume')
      }

      await this.acpClient.resumeSession(sessionId)

      console.log(`[Tangent 2] RemoteSessionManager: ACP session resumed on new Dev Box`)

      // Step 5: Update agent profile's remote.devBoxName
      handle.agentProfile.remote!.devBoxName = newDevBoxName

      // If agentStore is available, persist the change
      if (this.agentStore) {
        const groups = this.agentStore.getGroups()
        for (const group of groups) {
          const profile = group.agents.find(a => a.id === handle.agentProfile.id)
          if (profile && profile.remote) {
            profile.remote.devBoxName = newDevBoxName
          }
        }
        this.agentStore.save()
      }

      // Step 6: Update session with new Dev Box name
      const session = this.sessionStore.get(sessionId)
      if (session) {
        session.devBoxName = newDevBoxName
        session.updatedAt = Date.now()
      }

      // Step 7: Back to running state
      this._updateState(handle, 'running')
      this.sessionStore.updateStatus(sessionId, 'agent_ready')
      this.sessionStore.updateActivity(sessionId, `Switched to ${newDevBoxName}`)

      console.log(`[Tangent 2] RemoteSessionManager: Successfully switched to ${newDevBoxName}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(
        `[Tangent 2] RemoteSessionManager: Failed to switch Dev Box:`,
        message
      )
      this.sessionStore.updateStatus(sessionId, 'failed')
      this.sessionStore.updateActivity(sessionId, `Error: ${message}`)
      this.emit('remote:error', sessionId, message)
      throw error
    }
  }

  /**
   * P4.13: Continue a remote session locally.
   * Syncs workspace one final time, disconnects from Dev Box,
   * and creates a local PTY session with the same cwd/agent.
   */
  async continueLocally(sessionId: string): Promise<void> {
    const handle = this.remoteSessions.get(sessionId)
    if (!handle) {
      throw new Error(`Remote session ${sessionId} not found`)
    }

    if (!this.ptyManager) {
      throw new Error('PtyManager not available for local session creation')
    }

    console.log(
      `[Tangent 2] RemoteSessionManager: Converting remote session ${sessionId} to local`
    )

    try {
      // Step 1: Sync workspace one final time (inbound)
      if (handle.connectionId && handle.state === 'running') {
        this._updateState(handle, 'syncing-back')
        this.sessionStore.updateActivity(sessionId, 'Syncing workspace from Dev Box...')

        const connectionStatus = this.devBoxConnector.getStatus(handle.connectionId)
        if (connectionStatus?.connectionInfo) {
          const remoteWorkspacePath = handle.agentProfile.remote?.repoPath || '/home/workspace'

          const syncResult = await this.rsyncManager.syncInbound(
            remoteWorkspacePath,
            handle.localPath,
            connectionStatus.connectionInfo.sshHost,
            connectionStatus.connectionInfo.sshUser
          )

          if (!syncResult.success) {
            console.warn(
              `[Tangent 2] RemoteSessionManager: Final sync failed: ${syncResult.error}`
            )
          } else {
            console.log(`[Tangent 2] RemoteSessionManager: Final sync completed`)
          }
        }
      }

      // Step 2: Disconnect from Dev Box
      if (handle.connectionId) {
        this.sessionStore.updateActivity(sessionId, 'Disconnecting from Dev Box...')
        await this.devBoxConnector.disconnect(handle.connectionId, {
          stopDevBox: false
        })
        console.log(`[Tangent 2] RemoteSessionManager: Dev Box disconnected`)
      }

      // Step 3: Close ACP session
      if (handle.acpSessionId) {
        try {
          await this.acpClient.closeSession(sessionId)
          console.log(`[Tangent 2] RemoteSessionManager: ACP session closed`)
        } catch (error) {
          console.warn(`[Tangent 2] RemoteSessionManager: Failed to close ACP session:`, error)
        }
      }

      // Step 4: Create local PTY session with same cwd/agent
      this.sessionStore.updateActivity(sessionId, 'Creating local session...')

      const ptyId = uuid()
      this.ptyManager.spawn(ptyId, handle.localPath)

      // Step 5: Get current session data
      const session = this.sessionStore.get(sessionId)
      if (!session) {
        throw new Error('Session not found in store')
      }

      // Step 6: Transition session from remote to local
      session.kind = 'pty-agent'
      session.ptyId = ptyId
      session.remoteState = undefined
      session.devBoxName = undefined
      session.devBoxProject = undefined
      session.remoteConnectionId = undefined
      session.remoteSyncState = undefined
      session.lastSyncTime = undefined
      session.acpSessionId = undefined
      session.remoteMetrics = undefined
      session.status = 'shell_ready'
      session.lastActivity = 'Ready'
      session.updatedAt = Date.now()

      // Update in store
      this.sessionStore.add(session) // add() will update if exists

      // Step 7: Clean up remote StatusEngine (local SessionManager will create its own)
      this._disposeStatusEngine(sessionId)

      // Step 8: Remove from remote sessions tracking
      this.remoteSessions.delete(sessionId)

      console.log(
        `[Tangent 2] RemoteSessionManager: Successfully converted to local session`
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(
        `[Tangent 2] RemoteSessionManager: Failed to continue locally:`,
        message
      )
      this.sessionStore.updateStatus(sessionId, 'failed')
      this.sessionStore.updateActivity(sessionId, `Error: ${message}`)
      this.emit('remote:error', sessionId, message)
      throw error
    }
  }

  /**
   * Dispose the StatusEngine and StringDecoder for a remote session.
   * Safe to call multiple times (idempotent).
   */
  private _disposeStatusEngine(sessionId: string): void {
    const engine = this.statusEngines.get(sessionId)
    if (engine) {
      engine.dispose()
      this.statusEngines.delete(sessionId)
    }
    // Flush any remaining bytes in the decoder
    const decoder = this.utf8Decoders.get(sessionId)
    if (decoder) {
      decoder.end()
      this.utf8Decoders.delete(sessionId)
    }
  }
}
