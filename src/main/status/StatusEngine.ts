import { OscParser } from './OscParser'
import { SystemB } from './SystemB'
import { SystemA } from './SystemA'
import { CwdTracker } from './CwdTracker'
import type { SessionStore } from '../session/SessionStore'
import type { SessionStatus } from '@shared/types'

/**
 * StatusEngine — One instance per session.
 *
 * Receives PTY output and coordinates all detection systems:
 *   - OscParser: extracts OSC escape sequences (title, progress, cwd, shell-integration)
 *   - System B: output-pattern-based status detection
 *   - System A: file-watcher-based status detection (higher priority)
 *
 * Priority: System A (when active) overrides System B for status.
 * System B always runs for lastActivity extraction.
 * OSC progress signals are high-priority hints within System B detection.
 */
export class StatusEngine {
  private oscParser: OscParser
  private systemB: SystemB
  private systemA: SystemA
  private cwdTracker: CwdTracker
  private systemAActive = false
  private disposed = false

  constructor(
    private sessionId: string,
    private ptyId: string,
    private store: SessionStore
  ) {
    this.oscParser = new OscParser()
    this.systemB = new SystemB()
    this.systemA = new SystemA(ptyId)
    this.cwdTracker = new CwdTracker(sessionId, store)

    this.wireOscParser()
    this.wireSystemB()
    this.wireSystemA()
  }

  /**
   * Main entry point for PTY output.
   * Feeds data through OscParser first, then SystemB.
   */
  feed(data: string): void {
    if (this.disposed) return
    this.oscParser.feed(data)
    this.systemB.feed(data)
    this.cwdTracker.handleOutput(data)
  }

  /**
   * Handle PTY process exit. Immediately set status to 'exited'.
   */
  handlePtyExit(exitCode: number): void {
    if (this.disposed) return
    const session = this.store.get(this.sessionId)
    if (session) {
      session.exitCode = exitCode
      this.store.updateStatus(this.sessionId, 'exited')
    }
  }

  /**
   * Clean up all sub-systems.
   */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.oscParser.removeAllListeners()
    this.systemB.dispose()
    this.systemA.dispose()
  }

  private wireOscParser(): void {
    // OSC title changes -> update lastActivity only for agent sessions
    // Shell sessions use command extraction instead (more useful than process title)
    this.oscParser.on('title', (title: string) => {
      const session = this.store.get(this.sessionId)
      if (!session || session.agentType === 'shell') return
      const clean = title.trim()
      if (clean && clean.length < 100 && !clean.includes('\x1b') && !clean.includes('\x07')) {
        this.store.updateActivity(this.sessionId, clean)
      }
    })

    // OSC progress signals: high-priority status hints
    this.oscParser.on('progress', (state: number) => {
      let status: SessionStatus | null = null
      switch (state) {
        case 1: // indeterminate -> processing
        case 2: // normal -> processing
          status = 'processing'
          break
        case 0: // hidden -> agent_ready
          status = 'agent_ready'
          break
        case 3: {
          // OSC 9;4;3 = error progress. Only trust this for shell sessions.
          // During agent sessions, PowerShell shell integration emits spurious
          // error progress signals that don't reflect actual agent failure.
          const session = this.store.get(this.sessionId)
          if (session && session.agentType === 'shell') {
            status = 'failed'
          }
          break
        }
      }

      if (status) {
        this.store.updateStatus(this.sessionId, status)
      }
    })

    // OSC CWD changes -> route through CwdTracker for dedup
    this.oscParser.on('cwd', (cwdPath: string) => {
      this.cwdTracker.handleOscCwd(cwdPath)
    })

    // BEL events are informational — no status change
    // Shell integration marks — no status change needed here
  }

  private wireSystemB(): void {
    // System B status: only use if System A is not active
    this.systemB.on('status', (status: SessionStatus) => {
      if (!this.systemAActive) {
        this.store.updateStatus(this.sessionId, status)
      }
    })

    // System B activity: always forward regardless of System A state
    this.systemB.on('activity', (activity: string) => {
      this.store.updateActivity(this.sessionId, activity)
    })

    // Shell command extraction -> update lastActivity with last typed command
    this.systemB.on('command', (command: string) => {
      this.store.updateActivity(this.sessionId, command)
    })

    // Agent detected from output — promote the session
    this.systemB.on('agent-detected', (agentType: 'copilot-cli' | 'claude-code') => {
      const session = this.store.get(this.sessionId)
      if (session && session.agentType === 'shell') {
        this.store.promoteToAgent(this.sessionId, agentType)
      }
    })

  }

  private wireSystemA(): void {
    // System A activated: take over status from System B
    this.systemA.on('activate', () => {
      this.systemAActive = true
    })

    // System A status: always applied when active (higher priority)
    this.systemA.on('status', (status: SessionStatus) => {
      if (this.systemAActive) {
        this.store.updateStatus(this.sessionId, status)
      }
    })

    // System A activity: forward detail strings
    this.systemA.on('activity', (activity: string) => {
      this.store.updateActivity(this.sessionId, activity)
    })

    // System A deactivated: fall back to System B
    this.systemA.on('deactivate', () => {
      this.systemAActive = false
    })
  }
}
