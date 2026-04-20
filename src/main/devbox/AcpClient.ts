import { EventEmitter } from 'events'
import { Readable } from 'stream'
import { ClientSideConnection, type Client, type Stream, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import type * as schema from '@agentclientprotocol/sdk'
import type {
  AcpConnectionOptions,
  AcpSessionConfig,
  AcpSession,
  AcpPermissionRequest,
  AcpPermissionResponse,
  AcpAgentResponse,
  AcpConnectionState
} from '@shared/acp-types'

/**
 * Events emitted by AcpClient:
 * - 'acp:connected' - Successfully connected to ACP agent
 * - 'acp:disconnected' - Disconnected from ACP agent
 * - 'acp:session-created' - New ACP session created (session: AcpSession)
 * - 'acp:message' - Message received from agent (response: AcpAgentResponse)
 * - 'acp:permission-request' - Agent requests permission (request: AcpPermissionRequest)
 * - 'acp:error' - Error occurred (error: Error)
 */
export class AcpClient extends EventEmitter {
  private connection: ClientSideConnection | null = null
  private state: AcpConnectionState = 'disconnected'
  private sessions = new Map<string, AcpSession>()
  private tangentToAcpSessionMap = new Map<string, string>()
  private acpToTangentSessionMap = new Map<string, string>()
  private pendingPermissionRequests = new Map<string, (response: AcpPermissionResponse) => void>()
  private lastConnectOptions: AcpConnectionOptions | null = null
  private lastSessionConfigs = new Map<string, AcpSessionConfig>()

  /**
   * Connect to an ACP agent via TCP (through the SSH-tunneled local port).
   * The SshTunnelManager must be forwarding the remote ACP port to a local port first.
   */
  async connect(options: AcpConnectionOptions): Promise<void> {
    if (this.connection) {
      console.warn('[Tangent 2] AcpClient: Already connected')
      return
    }

    this.lastConnectOptions = options

    try {
      this.state = 'connecting'

      // Connect to the local port that SshTunnelManager is forwarding to the remote ACP port
      const { createConnection } = await import('net')
      const socket = createConnection({ host: '127.0.0.1', port: options.acpPort })

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          socket.destroy()
          reject(new Error(`ACP connection timeout (port ${options.acpPort})`))
        }, 10000)

        socket.on('connect', () => {
          clearTimeout(timeout)
          resolve()
        })

        socket.on('error', (err) => {
          clearTimeout(timeout)
          reject(err)
        })
      })

      // Convert Node.js socket to Web Streams for the ACP SDK's ndJsonStream
      const webReadable = Readable.toWeb(socket) as ReadableStream<Uint8Array>
      const webWritable = new WritableStream<Uint8Array>({
        write(chunk) {
          return new Promise<void>((resolve, reject) => {
            const ok = socket.write(chunk, (err) => err ? reject(err) : undefined)
            if (ok) resolve()
            else socket.once('drain', resolve)
          })
        },
        close() { socket.end() },
        abort(reason) { socket.destroy(reason instanceof Error ? reason : new Error(String(reason))) }
      })

      const stream = ndJsonStream(webWritable, webReadable)
      await this.connectWithStream(stream)
    } catch (err) {
      this.state = 'failed'
      const error = err instanceof Error ? err : new Error(String(err))
      console.warn('[Tangent 2] AcpClient: Connection failed:', error.message)
      this.emit('acp:error', error)
      throw error
    }
  }

  /**
   * Connect with a pre-configured stream (for testing or when DevBoxManager provides the stream).
   */
  async connectWithStream(stream: Stream): Promise<void> {
    if (this.connection) {
      console.warn('[Tangent 2] AcpClient: Already connected')
      return
    }

    try {
      this.state = 'connecting'

      // Create Client handler for incoming agent requests
      const client: Client = {
        requestPermission: async (params: schema.RequestPermissionRequest) => {
          return this.handlePermissionRequest(params)
        },
        sessionUpdate: async (notification: schema.SessionNotification) => {
          await this.handleSessionUpdate(notification)
        }
      }

      // Create the connection
      this.connection = new ClientSideConnection(() => client, stream)

      // Initialize the connection
      const initResponse = await this.connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: {
          name: 'Tangent',
          version: '2.0.0'
        },
        capabilities: {
          experimental: {}
        }
      })

      this.state = 'connected'
      this.emit('acp:connected')

      // Set up connection closed handler (with defensive null check)
      const conn = this.connection
      if (conn?.closed) {
        conn.closed
          .then(() => {
            // Only clear if this is still the active connection
            if (this.connection === conn) {
              this.state = 'disconnected'
              this.emit('acp:disconnected')
              this.connection = null
            }
          })
          .catch((err) => {
            if (this.connection === conn) {
              this.state = 'failed'
              const error = err instanceof Error ? err : new Error(String(err))
              console.warn('[Tangent 2] AcpClient: Connection closed with error:', error.message)
              this.emit('acp:error', error)
              this.connection = null
            }
          })
      }
    } catch (err) {
      this.state = 'failed'
      const error = err instanceof Error ? err : new Error(String(err))
      // Log full error details for debugging ACP protocol issues
      console.warn('[Tangent 2] AcpClient: Connection failed:', error.message)
      if (err && typeof err === 'object' && 'code' in err) {
        console.warn('[Tangent 2] AcpClient: Error code:', (err as any).code, 'data:', JSON.stringify((err as any).data))
      }
      this.emit('acp:error', error)
      throw error
    }
  }

  /**
   * Create a new ACP session with workspace context.
   * Maps a Tangent session ID to an ACP session ID.
   */
  async newSession(config: AcpSessionConfig): Promise<AcpSession> {
    if (!this.connection) {
      throw new Error('Not connected to ACP agent')
    }

    try {
      console.log('[Tangent 2] AcpClient: Sending session/new with cwd:', config.cwd)
      const response = await this.connection.newSession({
        cwd: config.cwd,
        mcpServers: config.mcpServers ?? [],
        env: config.env ?? {}
      })

      const acpSessionId = response.sessionId
      const tangentSessionId = config.sessionId || acpSessionId

      const session: AcpSession = {
        id: acpSessionId,
        state: 'connected',
        config,
        createdAt: Date.now(),
        lastActiveAt: Date.now()
      }

      this.sessions.set(acpSessionId, session)
      this.tangentToAcpSessionMap.set(tangentSessionId, acpSessionId)
      this.acpToTangentSessionMap.set(acpSessionId, tangentSessionId)
      this.lastSessionConfigs.set(tangentSessionId, config)

      this.emit('acp:session-created', session)

      return session
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      console.warn('[Tangent 2] AcpClient: Failed to create session:', error.message)
      if (err && typeof err === 'object' && 'code' in err) {
        console.warn('[Tangent 2] AcpClient: Session error code:', (err as any).code, 'data:', JSON.stringify((err as any).data))
      }
      this.emit('acp:error', error)
      throw error
    }
  }

  /**
   * Resume an existing ACP session by session ID.
   * Uses unstable_resumeSession if available, otherwise falls back to loadSession.
   * Leverages Copilot CLI cloud sync for session state persistence.
   */
  async resumeSession(sessionId: string): Promise<AcpSession> {
    if (!this.connection) {
      throw new Error('Not connected to ACP agent')
    }

    try {
      // Try unstable_resumeSession first (no history replay)
      if (this.connection.unstable_resumeSession) {
        const response = await this.connection.unstable_resumeSession({ sessionId })
        
        // Check if we already have this session mapped
        let tangentSessionId = this.acpToTangentSessionMap.get(sessionId)
        if (!tangentSessionId) {
          // New session from cloud sync, create mapping
          tangentSessionId = sessionId
          this.tangentToAcpSessionMap.set(tangentSessionId, sessionId)
          this.acpToTangentSessionMap.set(sessionId, tangentSessionId)
        }

        const session: AcpSession = {
          id: sessionId,
          state: 'connected',
          config: { cwd: '' }, // Will be updated from session updates
          createdAt: Date.now(),
          lastActiveAt: Date.now()
        }

        this.sessions.set(sessionId, session)
        return session
      } else if (this.connection.loadSession) {
        // Fall back to loadSession which replays history
        const response = await this.connection.loadSession({ sessionId })
        
        let tangentSessionId = this.acpToTangentSessionMap.get(sessionId)
        if (!tangentSessionId) {
          tangentSessionId = sessionId
          this.tangentToAcpSessionMap.set(tangentSessionId, sessionId)
          this.acpToTangentSessionMap.set(sessionId, tangentSessionId)
        }

        const session: AcpSession = {
          id: sessionId,
          state: 'connected',
          config: { cwd: '' },
          createdAt: Date.now(),
          lastActiveAt: Date.now()
        }

        this.sessions.set(sessionId, session)
        return session
      } else {
        throw new Error('Agent does not support session resumption')
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      console.warn('[Tangent 2] AcpClient: Failed to resume session:', error.message)
      this.emit('acp:error', error)
      throw error
    }
  }

  /**
   * Reconnect to ACP agent and re-create sessions.
   * Used when tunnel drops and reconnects.
   */
  async reconnect(): Promise<void> {
    if (!this.lastConnectOptions) {
      throw new Error('No previous connection options — cannot reconnect')
    }

    console.log('[Tangent 2] AcpClient: Reconnecting...')

    // Tear down old connection
    await this.disconnect()

    // Clear old session mappings (will be re-created)
    const oldMappings = new Map(this.tangentToAcpSessionMap)
    this.sessions.clear()
    this.tangentToAcpSessionMap.clear()
    this.acpToTangentSessionMap.clear()

    // Reconnect
    await this.connect(this.lastConnectOptions)

    // Re-create sessions using saved configs
    for (const [tangentSessionId] of oldMappings) {
      const config = this.lastSessionConfigs.get(tangentSessionId)
      if (config) {
        try {
          console.log(`[Tangent 2] AcpClient: Re-creating session for ${tangentSessionId}`)
          await this.newSession(config)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.warn(`[Tangent 2] AcpClient: Failed to re-create session ${tangentSessionId}:`, msg)
        }
      }
    }

    console.log('[Tangent 2] AcpClient: Reconnection complete')
  }

  /**
   * Send a prompt to an ACP session.
   * Auto-reconnects and retries once if the prompt fails with an internal error.
   */
  async sendPrompt(tangentSessionId: string, text: string): Promise<void> {
    const doSend = async (): Promise<void> => {
      if (!this.connection) {
        throw new Error('Not connected to ACP agent')
      }

      const acpSessionId = this.tangentToAcpSessionMap.get(tangentSessionId)
      if (!acpSessionId) {
        throw new Error(`No ACP session mapped to Tangent session ${tangentSessionId}`)
      }

      await this.connection.prompt({
        sessionId: acpSessionId,
        prompt: [{ type: 'text', text }]
      })

      // Update last active time
      const session = this.sessions.get(acpSessionId)
      if (session) {
        session.lastActiveAt = Date.now()
      }
    }

    try {
      await doSend()
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      // Log full error details including JSON-RPC code
      const code = (err as any)?.code
      const data = (err as any)?.data
      console.warn('[Tangent 2] AcpClient: Prompt failed:', error.message,
        code ? `(code: ${code})` : '',
        data ? `data: ${JSON.stringify(data)}` : '',
        '— attempting reconnect')

      // Try reconnecting and retrying once
      try {
        await this.reconnect()
        await doSend()
        console.log('[Tangent 2] AcpClient: Prompt succeeded after reconnect')
      } catch (retryErr) {
        const retryError = retryErr instanceof Error ? retryErr : new Error(String(retryErr))
        console.warn('[Tangent 2] AcpClient: Prompt failed after reconnect:', retryError.message)
        this.emit('acp:error', retryError)
        throw retryError
      }
    }
  }

  /**
   * Close a specific ACP session gracefully.
   * Removes session from local cache and mapping.
   */
  async closeSession(sessionId: string): Promise<void> {
    if (!this.connection) {
      throw new Error('Not connected to ACP agent')
    }

    const acpSessionId = this.tangentToAcpSessionMap.get(sessionId) || sessionId

    try {
      // Close session if agent supports it
      if (this.connection.unstable_closeSession) {
        await this.connection.unstable_closeSession({ sessionId: acpSessionId })
      }

      // Remove from local cache and mappings
      this.sessions.delete(acpSessionId)
      const tangentId = this.acpToTangentSessionMap.get(acpSessionId)
      if (tangentId) {
        this.tangentToAcpSessionMap.delete(tangentId)
      }
      this.acpToTangentSessionMap.delete(acpSessionId)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      console.warn('[Tangent 2] AcpClient: Failed to close session:', error.message)
      this.emit('acp:error', error)
      throw error
    }
  }

  /**
   * Disconnect from ACP agent and clean up connection state.
   * Session mappings are preserved for reconnection.
   */
  async disconnect(): Promise<void> {
    if (!this.connection) {
      return
    }

    try {
      // Clear session maps (will be re-created on reconnect if needed)
      this.sessions.clear()
      this.tangentToAcpSessionMap.clear()
      this.acpToTangentSessionMap.clear()

      this.connection = null
      this.state = 'disconnected'
      this.emit('acp:disconnected')
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      console.warn('[Tangent 2] AcpClient: Error during disconnect:', error.message)
      this.connection = null
      this.state = 'disconnected'
    }
  }

  /**
   * Handle permission requests from the agent.
   * Emits 'acp:permission-request' event and waits for UI response.
   */
  private async handlePermissionRequest(
    params: schema.RequestPermissionRequest
  ): Promise<schema.RequestPermissionResponse> {
    const tangentSessionId = this.acpToTangentSessionMap.get(params.sessionId)
    if (!tangentSessionId) {
      // Session not found, deny by default
      return { outcome: 'deny' }
    }

    const request: AcpPermissionRequest = {
      id: `perm-${Date.now()}`,
      sessionId: tangentSessionId,
      action: params.action || 'unknown',
      resource: params.resource || 'unknown',
      toolName: params.toolName,
      toolArgs: params.args,
      timestamp: Date.now()
    }

    // Emit event and wait for response
    return new Promise<schema.RequestPermissionResponse>((resolve) => {
      this.pendingPermissionRequests.set(request.id, (response: AcpPermissionResponse) => {
        this.pendingPermissionRequests.delete(request.id)
        if (response.approved) {
          resolve({
            outcome: response.rememberChoice ? 'allow_always' : 'allow'
          })
        } else {
          resolve({
            outcome: response.rememberChoice ? 'deny_always' : 'deny'
          })
        }
      })

      this.emit('acp:permission-request', request)

      // Timeout after 60 seconds with deny
      setTimeout(() => {
        if (this.pendingPermissionRequests.has(request.id)) {
          this.pendingPermissionRequests.delete(request.id)
          resolve({ outcome: 'deny' })
        }
      }, 60000)
    })
  }

  /**
   * Respond to a pending permission request.
   * Called by the UI after user makes a decision.
   */
  respondToPermission(response: AcpPermissionResponse): void {
    const callback = this.pendingPermissionRequests.get(response.requestId)
    if (callback) {
      callback(response)
    }
  }

  /**
   * Handle session update notifications from the agent.
   */
  private async handleSessionUpdate(notification: schema.SessionNotification): Promise<void> {
    const tangentSessionId = this.acpToTangentSessionMap.get(notification.sessionId)
    if (!tangentSessionId) {
      console.warn('[Tangent 2] AcpClient: Received update for unknown session:', notification.sessionId)
      return
    }

    const updateType = (notification.update as any)?.sessionUpdate || 'unknown'
    console.log(`[Tangent 2] AcpClient: Session update type="${updateType}" for ${tangentSessionId}`)

    // Convert ACP notification to Tangent response format
    const response: AcpAgentResponse = {
      sessionId: tangentSessionId,
      timestamp: Date.now()
    }

    const update = notification.update as any

    // Extract text from various update types
    // ACP sends: sessionUpdate type + content blocks
    if (update?.content) {
      // Single content block (agent_thought_chunk, text_delta, etc.)
      const content = update.content
      if (content.type === 'text' && content.text) {
        response.text = content.text
      }
    }

    // Also check for messages array (some ACP implementations use this)
    if (!response.text && update?.messages) {
      const textChunks = update.messages
        .filter((msg: any) => msg.role === 'assistant')
        .flatMap((msg: any) => {
          if (Array.isArray(msg.content)) {
            return msg.content.filter((c: any) => c.type === 'text')
          }
          return []
        })
        .map((c: any) => c.text)

      if (textChunks.length > 0) {
        response.text = textChunks.join('')
      }
    }

    // Extract tool executions
    if (update?.toolCalls) {
      response.toolExecutions = update.toolCalls.map((toolCall: any) => ({
        id: toolCall.id || `tool-${Date.now()}`,
        name: toolCall.name || 'unknown',
        source: 'built-in' as const,
        status: toolCall.status === 'completed' ? ('success' as const) : ('running' as const),
        startedAt: Date.now(),
        args: toolCall.input
      }))
    }

    // Map stop reason to status
    if (update?.stopReason) {
      switch (update.stopReason) {
        case 'end_turn':
        case 'max_tokens':
          response.status = 'completed'
          break
        case 'cancelled':
        case 'error':
          response.status = 'error'
          break
        default:
          response.status = 'processing'
      }
    }

    // Update session last active time
    const session = this.sessions.get(notification.sessionId)
    if (session) {
      session.lastActiveAt = Date.now()

      // Update metrics if available
      if (update?.usage) {
        session.metrics = {
          inputTokens: update.usage.inputTokens || 0,
          outputTokens: update.usage.outputTokens || 0,
          cacheReadTokens: update.usage.cacheReadTokens || 0,
          cacheWriteTokens: update.usage.cacheWriteTokens || 0,
          cost: 0,
          totalPremiumRequests: 0
        }
      }
    }

    this.emit('acp:message', response)
  }

  /**
   * Get current connection state.
   */
  getState(): AcpConnectionState {
    return this.state
  }

  /**
   * Get all active sessions.
   */
  getSessions(): AcpSession[] {
    return Array.from(this.sessions.values())
  }

  /**
   * Get a specific session by Tangent session ID.
   */
  getSession(tangentSessionId: string): AcpSession | undefined {
    const acpSessionId = this.tangentToAcpSessionMap.get(tangentSessionId)
    return acpSessionId ? this.sessions.get(acpSessionId) : undefined
  }
}
