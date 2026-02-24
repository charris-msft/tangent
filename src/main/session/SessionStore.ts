import { EventEmitter } from 'events'
import { canTransition } from '@shared/transitions'
import type { Session, SessionMetrics, SessionStatus, ToolUseEntry } from '@shared/types'

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
}
