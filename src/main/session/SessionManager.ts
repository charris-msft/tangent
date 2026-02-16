import { v4 as uuid } from 'uuid'
import path from 'path'
import { SessionStore } from './SessionStore'
import { SdkSessionManager } from './SdkSessionManager'
import { PtyManager } from '../pty/PtyManager'
import { StatusEngine } from '../status/StatusEngine'
import { ExternalScanner } from './ExternalScanner'
import type { Session } from '@shared/types'

export class SessionManager {
  private activeSessionId: string | null = null
  private engines = new Map<string, StatusEngine>()
  private externalScanner = new ExternalScanner()
  private _sdkManager: SdkSessionManager | null = null

  constructor(
    private store: SessionStore,
    private ptyManager: PtyManager
  ) {
    // Wire PTY data events to the corresponding StatusEngine
    this.ptyManager.on('data', (ptyId: string, data: string) => {
      const session = this.findByPtyId(ptyId)
      if (session && session.kind !== 'copilot-sdk') {
        const engine = this.engines.get(session.id)
        engine?.feed(data)
      }
    })

    // Wire PTY exit events to the corresponding StatusEngine
    this.ptyManager.on('exit', (ptyId: string, exitCode: number) => {
      const session = this.findByPtyId(ptyId)
      if (session && session.kind !== 'copilot-sdk') {
        const engine = this.engines.get(session.id)
        engine?.handlePtyExit(exitCode)
      }
    })
  }

  /** Set the SDK session manager (injected after construction to avoid circular deps). */
  setSdkManager(sdkManager: SdkSessionManager): void {
    this._sdkManager = sdkManager
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
    const engine = new StatusEngine(sessionId, ptyId, this.store)
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

    if (session.ptyId) {
      this.ptyManager.kill(session.ptyId)
    }

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
