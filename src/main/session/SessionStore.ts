import { EventEmitter } from 'events'
import { canTransition } from '@shared/transitions'
import type { Session, SessionMetrics, SessionStatus, ToolUseEntry, RemoteSessionState, RemoteSessionMetrics } from '@shared/types'

export class SessionStore extends EventEmitter {
  private sessions = new Map<string, Session>()
  private toolUseEntries = new Map<string, ToolUseEntry[]>() // sessionId → entries

  getAll(): Session[] {
    return Array.from(this.sessions.values())
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id)
  }

  add(session: Session): void {
    this.sessions.set(session.id, session)
    this.emit('created', session)
  }

  remove(id: string): void {
    this.sessions.delete(id)
    this.emit('closed', id)
  }

  /**
   * Atomic update for CWD-related fields.
   * folderPath, folderName, and name update together per Naming Rule 6.
   */
  updateCwd(id: string, newPath: string, newFolderName: string): void {
    const session = this.sessions.get(id)
    if (!session) return

    session.folderPath = newPath
    session.folderName = newFolderName
    if (!session.isRenamed) {
      session.name = newFolderName
    }
    session.updatedAt = Date.now()
    this.emit('updated', session)
  }

  /**
   * Status update with transition validation.
   * Invalid transitions are logged and ignored (never thrown).
   */
  updateStatus(id: string, newStatus: SessionStatus): void {
    const session = this.sessions.get(id)
    if (!session) return

    if (session.status === newStatus) return

    if (!canTransition(session.status, newStatus)) {
      console.warn(
        `[SessionStore] Invalid transition: ${session.status} -> ${newStatus} (session ${id})`
      )
      return
    }

    console.log(`[SessionStore] Status: ${session.status} -> ${newStatus} (session ${id.slice(0,8)})`)
    session.status = newStatus
    session.updatedAt = Date.now()
    this.emit('updated', session)
  }

  /**
   * Promote shell session to agent type.
   * Naming Rule 3: name is NOT changed during agent detection.
   */
  promoteToAgent(id: string, agentType: 'copilot-cli' | 'claude-code'): void {
    const session = this.sessions.get(id)
    if (!session) return

    session.agentType = agentType

    if (canTransition(session.status, 'agent_launching')) {
      session.status = 'agent_launching'
      session.updatedAt = Date.now()
      this.emit('updated', session)
    } else {
      session.updatedAt = Date.now()
      this.emit('updated', session)
    }

    this.emit('agent-promoted', { id, agentType, ptyId: session.ptyId })
  }

  /**
   * Manual rename. Naming Rule 4: sticky.
   */
  rename(id: string, newName: string): void {
    const session = this.sessions.get(id)
    if (!session) return

    session.name = newName
    session.isRenamed = true
    session.updatedAt = Date.now()
    this.emit('updated', session)
  }

  /**
   * Auto-set session name (non-sticky). Skipped if user has manually renamed.
   */
  setAutoName(id: string, name: string): void {
    const session = this.sessions.get(id)
    if (!session || session.isRenamed) return

    session.name = name
    session.updatedAt = Date.now()
    this.emit('updated', session)
  }

  /**
   * Store the agent command/args/env used to launch an agent in a session.
   */
  setAgentLaunchInfo(id: string, command: string, args: string[], env?: Record<string, string>): void {
    const session = this.sessions.get(id)
    if (!session) return

    session.agentCommand = command
    session.agentArgs = args
    if (env && Object.keys(env).length > 0) {
      session.agentEnv = env
    }
    session.updatedAt = Date.now()
    this.emit('updated', session)
  }

  updateActivity(id: string, activity: string): void {
    const session = this.sessions.get(id)
    if (!session) return

    session.lastActivity = activity
    session.updatedAt = Date.now()
    this.emit('updated', session)
  }

  /**
   * Update session metrics (token usage, cost, quota).
   * Token counts are accumulated per-request; quota fields are snapshots.
   */
  updateMetrics(id: string, partial: Partial<SessionMetrics>): void {
    const session = this.sessions.get(id)
    if (!session) return

    if (!session.metrics) {
      session.metrics = {
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
        cacheWriteTokens: 0, cost: 0, totalPremiumRequests: 0
      }
    }

    if (partial.inputTokens !== undefined) session.metrics.inputTokens += partial.inputTokens
    if (partial.outputTokens !== undefined) session.metrics.outputTokens += partial.outputTokens
    if (partial.cacheReadTokens !== undefined) session.metrics.cacheReadTokens += partial.cacheReadTokens
    if (partial.cacheWriteTokens !== undefined) session.metrics.cacheWriteTokens += partial.cacheWriteTokens
    if (partial.cost !== undefined) session.metrics.cost += partial.cost
    if (partial.totalPremiumRequests !== undefined) session.metrics.totalPremiumRequests = partial.totalPremiumRequests
    if (partial.contextTokens !== undefined) session.metrics.contextTokens = partial.contextTokens
    if (partial.contextLimit !== undefined) session.metrics.contextLimit = partial.contextLimit

    session.updatedAt = Date.now()
    this.emit('updated', session)
    this.emit('metrics', session)
  }

  // === Tool Use Tracking ===

  addToolUse(entry: ToolUseEntry): void {
    const list = this.toolUseEntries.get(entry.sessionId) ?? []
    list.push(entry)
    this.toolUseEntries.set(entry.sessionId, list)
    this.emit('tool-use', entry)
  }

  updateToolUse(sessionId: string, toolCallId: string, update: Partial<ToolUseEntry>): void {
    const list = this.toolUseEntries.get(sessionId)
    if (!list) return
    const entry = list.find(e => e.id === toolCallId)
    if (!entry) return
    Object.assign(entry, update)
    this.emit('tool-use', entry)
  }

  getToolUse(sessionId: string): ToolUseEntry[] {
    return this.toolUseEntries.get(sessionId) ?? []
  }

  // === Remote Session State Management ===

  /**
   * Update remote session state (for kind = 'remote-agent').
   * Does NOT override session.status — remote state tracks Dev Box/sync/ACP lifecycle separately.
   */
  setRemoteState(sessionId: string, state: RemoteSessionState): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    if (session.kind !== 'remote-agent') {
      console.warn(`[SessionStore] setRemoteState called on non-remote session ${sessionId}`)
      return
    }

    if (session.remoteState === state) return

    console.log(`[SessionStore] Remote state: ${session.remoteState || 'none'} -> ${state} (session ${sessionId.slice(0,8)})`)
    session.remoteState = state
    session.updatedAt = Date.now()
    this.emit('updated', session)
    this.emit('session:remote-state-changed', { sessionId, state })
  }

  /**
   * Update last sync timestamp and optional sync state.
   */
  updateLastSyncTime(sessionId: string, timestamp: number, syncState?: 'idle' | 'syncing-out' | 'syncing-in'): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    session.lastSyncTime = timestamp
    if (syncState !== undefined) {
      session.remoteSyncState = syncState
    }
    session.updatedAt = Date.now()
    this.emit('updated', session)
  }

  /**
   * Set ACP session ID for remote agent sessions.
   */
  setAcpSessionId(sessionId: string, acpSessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    session.acpSessionId = acpSessionId
    session.updatedAt = Date.now()
    this.emit('updated', session)
  }

  /**
   * Set remote connection info (Dev Box name, project, connection ID).
   */
  setRemoteConnectionInfo(sessionId: string, devBoxName: string, devBoxProject: string, remoteConnectionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    session.devBoxName = devBoxName
    session.devBoxProject = devBoxProject
    session.remoteConnectionId = remoteConnectionId
    session.updatedAt = Date.now()
    this.emit('updated', session)
  }

  /**
   * Update remote session metrics (sync counts, tunnel uptime, etc).
   */
  updateRemoteMetrics(sessionId: string, metrics: Partial<RemoteSessionMetrics>): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    if (session.kind !== 'remote-agent') {
      console.warn(`[SessionStore] updateRemoteMetrics called on non-remote session ${sessionId}`)
      return
    }

    if (!session.remoteMetrics) {
      session.remoteMetrics = {
        syncOutCount: 0,
        syncInCount: 0,
        totalBytesSynced: 0,
        tunnelUptime: 0,
        reconnectionCount: 0,
        avgSyncDurationMs: 0
      }
    }

    // Update only provided fields
    if (metrics.syncOutCount !== undefined) session.remoteMetrics.syncOutCount = metrics.syncOutCount
    if (metrics.syncInCount !== undefined) session.remoteMetrics.syncInCount = metrics.syncInCount
    if (metrics.totalBytesSynced !== undefined) session.remoteMetrics.totalBytesSynced = metrics.totalBytesSynced
    if (metrics.tunnelUptime !== undefined) session.remoteMetrics.tunnelUptime = metrics.tunnelUptime
    if (metrics.reconnectionCount !== undefined) session.remoteMetrics.reconnectionCount = metrics.reconnectionCount
    if (metrics.avgSyncDurationMs !== undefined) session.remoteMetrics.avgSyncDurationMs = metrics.avgSyncDurationMs

    session.updatedAt = Date.now()
    this.emit('updated', session)
    this.emit('session:metrics-updated', { sessionId, metrics: session.remoteMetrics })
  }

  /**
   * Get remote session metrics.
   */
  getRemoteMetrics(sessionId: string): RemoteSessionMetrics | undefined {
    const session = this.sessions.get(sessionId)
    if (!session || session.kind !== 'remote-agent') return undefined
    return session.remoteMetrics
  }
}
