import { v4 as uuid } from 'uuid'
import path from 'path'
import { SessionStore } from './SessionStore'
import { SdkSessionManager } from './SdkSessionManager'
import { ContextStore } from './ContextStore'
import { TaskTimelineStore } from './TaskTimelineStore'
import { PtyManager } from '../pty/PtyManager'
import { StatusEngine } from '../status/StatusEngine'
import { ExternalScanner } from './ExternalScanner'
import type { Session } from '@shared/types'

export class SessionManager {
  private activeSessionId: string | null = null
  private engines = new Map<string, StatusEngine>()
  private externalScanner = new ExternalScanner()
  private _sdkManager: SdkSessionManager | null = null
  private _contextStore: ContextStore | null = null
  private _timelineStore: TaskTimelineStore | null = null

  constructor(
    private store: SessionStore,
    private ptyManager: PtyManager
  ) {
    // Wire PTY data events to the corresponding StatusEngine
    this.ptyManager.on('data', (ptyId: string, data: string) => {
      const session = this.findByPtyId(ptyId)
      if (session) {
        const engine = this.engines.get(session.id)
        engine?.feed(data)

        // Append output to timeline store for non-shell sessions
        if (this._timelineStore && session.agentType !== 'shell') {
          this._timelineStore.appendOutput(session.id, data)
        }
      }
    })

    // Wire PTY exit events to the corresponding StatusEngine
    this.ptyManager.on('exit', (ptyId: string, exitCode: number) => {
      const session = this.findByPtyId(ptyId)
      if (session) {
        const engine = this.engines.get(session.id)
        engine?.handlePtyExit(exitCode)
      }
    })

    // Wire status transitions for timeline completion
    this.store.on('updated', (session: Session) => {
      const prevStatus = this.statusHistory.get(session.id)

      // Track status changes for timeline completion logic
      if (prevStatus !== session.status) {
        // Complete timeline item when transitioning from processing/tool_executing/needs_input to agent_ready
        if (
          this._timelineStore &&
          session.agentType !== 'shell' &&
          (prevStatus === 'processing' || prevStatus === 'tool_executing' || prevStatus === 'needs_input') &&
          session.status === 'agent_ready'
        ) {
          this._timelineStore.completeLatest(session.id, 'success')
        }

        // Mark as error/interrupted on failed/exited
        if (this._timelineStore && session.agentType !== 'shell') {
          if (session.status === 'failed') {
            this._timelineStore.failInProgress(session.id, 'Task failed')
          } else if (session.status === 'exited') {
            this._timelineStore.failInProgress(session.id, 'Session exited')
          }
        }

        // Update status history
        this.statusHistory.set(session.id, session.status)
      }
    })
  }

  private statusHistory = new Map<string, string>() // sessionId -> previous status

  setContextStore(contextStore: ContextStore): void {
    this._contextStore = contextStore
  }

  get contextStore(): ContextStore | null {
    return this._contextStore
  }

  setTimelineStore(timelineStore: TaskTimelineStore): void {
    this._timelineStore = timelineStore
  }

  get timelineStore(): TaskTimelineStore | null {
    return this._timelineStore
  }

  setSdkManager(sdkManager: SdkSessionManager): void {
    this._sdkManager = sdkManager
    // When SDK clears needs_input, tell the StatusEngine to suppress stale redraws
    sdkManager.setNeedsInputClearedCallback((sessionId) => {
      const engine = this.engines.get(sessionId)
      engine?.clearNeedsInput()
    })
  }

  get sdkManager(): SdkSessionManager | null {
    return this._sdkManager
  }

  create(cwd?: string): Session {
    const workingDir = cwd || process.env.USERPROFILE || 'C:\\'
    const folderName = path.basename(workingDir)
    const sessionId = uuid()
    const ptyId = uuid()

    const proc = this.ptyManager.spawn(ptyId, workingDir)

    const session: Session = {
      id: sessionId,
      kind: 'shell',
      agentType: 'shell',
      name: folderName,
      folderName,
      folderPath: workingDir,
      isRenamed: false,
      status: 'shell_ready',
      lastActivity: '',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      ptyId,
      isExternal: false
    }

    this.store.add(session)

    // Create a StatusEngine for the session after adding to store
    const engine = new StatusEngine(sessionId, ptyId, this.store, this._contextStore ?? undefined)
    this.engines.set(sessionId, engine)

    this.activeSessionId = sessionId
    return session
  }

  close(sessionId: string): void {
    const session = this.store.get(sessionId)
    if (!session) return

    // Clean up SDK connection if attached
    this._sdkManager?.closeSession(sessionId)

    // Dispose the StatusEngine before killing the PTY
    const engine = this.engines.get(sessionId)
    if (engine) {
      engine.dispose()
      this.engines.delete(sessionId)
    }

    this.ptyManager.kill(session.ptyId)
    this.store.remove(sessionId)

    if (this.activeSessionId === sessionId) {
      const remaining = this.store.getAll()
      this.activeSessionId = remaining.length > 0 ? remaining[0].id : null
    }
  }

  select(sessionId: string): void {
    this.activeSessionId = sessionId
  }

  getActiveSessionId(): string | null {
    return this.activeSessionId
  }

  getActiveSession(): Session | undefined {
    return this.activeSessionId
      ? this.store.get(this.activeSessionId)
      : undefined
  }

  /**
   * Scan for externally-launched agent sessions (Claude Code, Copilot CLI).
   * Returns newly discovered sessions that were added to the store.
   */
  scanExternal(): Session[] {
    const knownPaths = new Set(
      this.store.getAll().map(s => s.folderPath)
    )
    const discovered = this.externalScanner.scan(knownPaths)
    for (const session of discovered) {
      this.store.add(session)
    }
    return discovered
  }

  private findByPtyId(ptyId: string): Session | undefined {
    return this.store.getAll().find(s => s.ptyId === ptyId)
  }
}
