import { OscParser } from './OscParser'
import { SystemB } from './SystemB'
import { SystemA } from './SystemA'
import { CwdTracker } from './CwdTracker'
import type { SessionStore } from '../session/SessionStore'
import type { ContextStore } from '../session/ContextStore'
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
  private systemA: SystemA | null = null
  private cwdTracker: CwdTracker
  private systemAActive = false
  private disposed = false
  private oscIdleTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private sessionId: string,
    private ptyId: string,
    private store: SessionStore,
    private contextStore?: ContextStore
  ) {
    this.oscParser = new OscParser()
    this.systemB = new SystemB()

    // Skip SystemA file watching for remote sessions
    // Remote sessions get status from ACP events, not file watchers
    const session = this.store.get(sessionId)
    const isRemote = session && (session.kind === 'remote-agent' || session.remoteState !== undefined)

    if (!isRemote) {
      this.systemA = new SystemA(ptyId)
    }

    this.cwdTracker = new CwdTracker(sessionId, store)

    this.wireOscParser()
    this.wireSystemB()

    // Only wire SystemA for non-remote sessions
    if (this.systemA) {
      this.wireSystemA()
    }
  }

  /**
   * Main entry point for PTY output.
   * Feeds data through OscParser first, then SystemB.
   *
   * SKIP ALL STATUS DETECTION FOR REMOTE SESSIONS:
   * Remote sessions (kind = 'remote-agent' or remoteState set) get their
   * status from ACP events, not terminal output parsing. StatusEngine would
   * conflict with remote state transitions.
   */
  feed(data: string): void {
    if (this.disposed) return

    // Skip status detection for remote sessions
    const session = this.store.get(this.sessionId)
    if (session && (session.kind === 'remote-agent' || session.remoteState !== undefined)) {
      return
    }

    this.oscParser.feed(data)
    this.systemB.feed(data)
    this.cwdTracker.handleOutput(data)
  }

  /**
   * Called when an authoritative signal (SDK, external) clears needs_input.
   * Tells SystemB to suppress stale TUI redraws for a cooldown period.
   */
  clearNeedsInput(): void {
    this.systemB.clearNeedsInput()
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
    if (this.oscIdleTimer) {
      clearTimeout(this.oscIdleTimer)
      this.oscIdleTimer = null
    }
    this.oscParser.removeAllListeners()
    this.systemB.dispose()
    if (this.systemA) {
      this.systemA.dispose()
    }
  }

  private wireOscParser(): void {
    // OSC title changes -> update lastActivity only for agent sessions
    // Shell sessions use command extraction instead (more useful than process title)
    this.oscParser.on('title', (title: string) => {
      const session = this.store.get(this.sessionId)
      if (!session || session.agentType === 'shell') return
      let clean = title.trim()
      // Strip Copilot CLI's emoji prefix (🤖) from the title to get just the intent
      clean = clean.replace(/^🤖\s*/, '').replace(/^Copilot:\s*/i, '')
      if (clean && clean.length >= 3 && clean.length < 100 && !clean.includes('\x1b') && !clean.includes('\x07')) {
        // Don't overwrite activity with just the app name
        if (clean === 'GitHub Copilot' || clean === 'Copilot') return
        this.store.updateActivity(this.sessionId, clean)
      }
    })

    // OSC 9;4 progress signals — high-priority status hints.
    // Windows Terminal spec: 0=hidden, 1=normal, 2=error, 3=indeterminate, 4=warning
    // Copilot CLI emits: state 3 (indeterminate) when thinking, state 0 (hidden) when done.
    //
    // For agent sessions, state 0 is debounced (800ms) to avoid mid-turn flicker
    // when CLI clears progress between individual tool calls. If state 3 arrives
    // during the debounce window, the idle transition is cancelled.
    this.oscParser.on('progress', (state: number) => {
      switch (state) {
        case 3: // indeterminate -> processing (CLI sends this when thinking)
        case 1: // normal -> processing
          // Cancel any pending idle transition — agent is actively working
          if (this.oscIdleTimer) {
            clearTimeout(this.oscIdleTimer)
            this.oscIdleTimer = null
          }
          // OSC progress is authoritative — always transition to processing.
          // If leaving needs_input, tell SystemB to suppress stale TUI redraws.
          {
            const session = this.store.get(this.sessionId)
            if (session?.status === 'needs_input') {
              this.systemB.clearNeedsInput()
            }
          }
          this.store.updateStatus(this.sessionId, 'processing')
          break
        case 0: {
          // hidden — agent turn complete or idle
          const session = this.store.get(this.sessionId)
          if (!session) break
          if (session.agentType === 'shell') {
            // Shell sessions: immediate transition
            this.store.updateStatus(this.sessionId, 'agent_ready')
          } else {
            // Agent sessions: debounce to avoid mid-turn flicker when
            // CLI clears progress between individual tool calls.
            // If no new processing signal arrives within 800ms, commit idle.
            if (this.oscIdleTimer) clearTimeout(this.oscIdleTimer)
            this.oscIdleTimer = setTimeout(() => {
              this.oscIdleTimer = null
              const current = this.store.get(this.sessionId)
              if (!current) return
              if (current.status === 'needs_input') {
                this.systemB.clearNeedsInput()
              }
              this.store.updateStatus(this.sessionId, 'agent_ready')
            }, 800)
          }
          break
        }
        case 2: {
          // error — only trust for shell sessions (spurious during agent sessions)
          const session = this.store.get(this.sessionId)
          if (session && session.agentType === 'shell') {
            this.store.updateStatus(this.sessionId, 'failed')
          }
          break
        }
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
    // Only for shell sessions — agent sessions get activity from OSC titles/SDK
    this.systemB.on('command', (command: string) => {
      const session = this.store.get(this.sessionId)
      if (session && session.agentType === 'shell') {
        this.store.updateActivity(this.sessionId, command)
      }
      // Always capture commands into context store for human context panel
      this.contextStore?.addPrompt(this.sessionId, command, 'terminal')
    })

    // Agent detected from output — promote the session
    // Allowed from shell_ready (user typed command manually) or agent_launching (sidebar)
    this.systemB.on('agent-detected', (agentType: 'copilot-cli' | 'claude-code', shellCommand: string) => {
      const session = this.store.get(this.sessionId)
      if (!session || session.agentType !== 'shell') return
      if (session.status !== 'shell_ready' && session.status !== 'agent_launching') return

      this.store.promoteToAgent(this.sessionId, agentType)
      // If the TUI banner is visible, the agent is ready for input
      this.store.updateStatus(this.sessionId, 'agent_ready')

      // Set a default display name for manually-started agents (non-sticky)
      this.store.setAutoName(this.sessionId, agentType === 'copilot-cli' ? 'Copilot' : 'Claude Code')

      // Store the original command/args from the shell prompt for "Save as Agent"
      if (shellCommand) {
        const parts = shellCommand.split(/\s+/)
        const command = parts[0]
        const args = parts.slice(1)
        this.store.setAgentLaunchInfo(this.sessionId, command, args)
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
