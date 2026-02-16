import { EventEmitter } from 'events'
import type { SessionStatus } from '@shared/types'
import { STATUS_TIMING } from '@shared/constants'

interface DetectionRule {
  pattern: RegExp
  status: SessionStatus
  priority: number
}

const RULES: DetectionRule[] = [
  { priority: 1, pattern: /PS\s+[A-Za-z]:\\[^>]*>\s*$/, status: 'shell_ready' },
  { priority: 2, pattern: /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏•]/, status: 'processing' },
  { priority: 3, pattern: /[Tt]hinking/, status: 'processing' },
  { priority: 4, pattern: /running tool:|executing command:|Reading file|Writing file/i, status: 'tool_executing' },
  { priority: 5, pattern: /(y\/n)|continue\?|allow\?|permit\?|approve\?|Enter to confirm|Other \(type your answer\)/i, status: 'needs_input' },
  { priority: 6, pattern: /^❯\s*/m, status: 'agent_ready' },
  { priority: 7, pattern: /^›\s*/m, status: 'agent_ready' },
  { priority: 8, pattern: /^Error:|^FATAL:|command not found$|ENOENT|CommandNotFoundException/m, status: 'failed' },
]

/** Strip ANSI escape sequences from text for clean pattern matching. */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text
    .replace(/\x1b\[[?!>]?[0-9;]*[a-zA-Z]/g, '')   // CSI sequences (including ?25h, ?25l, etc.)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC sequences
    .replace(/\x1b[()][AB012]/g, '')                  // Character set sequences
    .replace(/\x1b[78DEHM]/g, '')                     // Single-character escape sequences
}

// Agent detection patterns for output-based agent promotion
const AGENT_DETECT_PATTERNS: { pattern: RegExp; agentType: 'copilot-cli' | 'claude-code' }[] = [
  { pattern: /GitHub Copilot|copilot-cli/i, agentType: 'copilot-cli' },
  { pattern: /Claude Code|claude-code|anthropic/i, agentType: 'claude-code' },
]

// Activity extraction — only match when preceded by a clear action indicator
const ACTIVITY_PATTERN = /(?:Reading|Writing|Editing|Creating|Deleting)\s+(?:file\s+)?(\S+)/i

// Shell command extraction — captures text typed after the PS prompt
const SHELL_COMMAND_PATTERN = /PS\s+[A-Za-z]:\\[^>]*>\s*(.+\S)/

export class SystemB extends EventEmitter {
  private buffer: string[] = []
  private currentStatus: SessionStatus | null = null
  private lastTransitionTime = 0
  private silenceTimer: ReturnType<typeof setTimeout> | null = null
  private pendingReady = false
  private failedMatchCount = 0
  private failedFirstMatchTime = 0
  private agentDetected = false

  feed(data: string): void {
    // Update rolling buffer
    const lines = data.split('\n')
    this.buffer.push(...lines)
    while (this.buffer.length > STATUS_TIMING.OUTPUT_BUFFER_LINES) {
      this.buffer.shift()
    }

    // Strip ANSI escape sequences for all pattern matching
    const clean = stripAnsi(data)

    // Cancel pending agent_ready only if new VISIBLE output arrives.
    // ANSI/OSC-only data (title updates, cursor control) should not
    // interrupt the silence timer — agents often emit these right after
    // showing their prompt, which would otherwise prevent agent_ready.
    if (this.pendingReady && this.silenceTimer && clean.trim().length > 0) {
      clearTimeout(this.silenceTimer)
      this.silenceTimer = null
      this.pendingReady = false
    }

    // Extract lastActivity from clean text
    const activityMatch = clean.match(ACTIVITY_PATTERN)
    if (activityMatch) {
      const activity = activityMatch[1].trim()
      if (activity.length > 0 && activity.length < 200) {
        this.emit('activity', activity)
      }
    }

    // Detect agent type from output (once per session)
    if (!this.agentDetected) {
      for (const { pattern, agentType } of AGENT_DETECT_PATTERNS) {
        if (pattern.test(clean)) {
          this.agentDetected = true
          this.emit('agent-detected', agentType)
          break
        }
      }
    }

    // Extract shell commands from PS prompt lines (e.g., "PS C:\git> cd foo")
    const cmdMatch = clean.match(SHELL_COMMAND_PATTERN)
    if (cmdMatch) {
      this.emit('command', cmdMatch[1].trim())
    }

    // Run detection rules in priority order
    for (const rule of RULES) {
      if (!rule.pattern.test(clean)) continue

      // agent_ready needs 300ms silence confirmation
      if (rule.status === 'agent_ready') {
        this.pendingReady = true
        this.silenceTimer = setTimeout(() => {
          this.pendingReady = false
          this.silenceTimer = null
          this.tryTransition('agent_ready')
        }, STATUS_TIMING.PROMPT_SILENCE_MS)
        return
      }

      // failed requires 2 matches within 3s window (no single-match persist)
      // Only trigger failed from output patterns in shell/launch states.
      // During any agent state (agent_ready, processing, tool_executing, needs_input),
      // error-like text is agent content, not a terminal failure.
      // Also skip when currentStatus is null (startup) — too early to declare failure.
      if (rule.status === 'failed') {
        if (this.currentStatus === null
            || (this.currentStatus !== 'shell_ready'
                && this.currentStatus !== 'agent_launching')) {
          return // Ignore error patterns during startup and agent session states
        }
        const now = Date.now()
        if (this.failedMatchCount === 0) {
          this.failedMatchCount = 1
          this.failedFirstMatchTime = now
        } else if (now - this.failedFirstMatchTime <= STATUS_TIMING.FAILED_WINDOW_MS) {
          // 2nd match within 3s window — now transition
          this.failedMatchCount = 0
          this.tryTransition('failed')
        } else {
          // Outside window, restart count
          this.failedMatchCount = 1
          this.failedFirstMatchTime = now
        }
        return
      }

      // processing is eager (no extra delay beyond 500ms hold)
      if (rule.status === 'processing') {
        // Clear any pending failed count
        this.failedMatchCount = 0
        this.tryTransition('processing')
        return
      }

      // All other statuses: apply with hold check
      this.tryTransition(rule.status)
      return // First matching rule wins
    }
  }

  private tryTransition(newStatus: SessionStatus): void {
    const now = Date.now()
    if (now - this.lastTransitionTime < STATUS_TIMING.MIN_HOLD_MS && this.currentStatus !== null) {
      return // Within hold period
    }

    if (newStatus !== this.currentStatus) {
      this.currentStatus = newStatus
      this.lastTransitionTime = now
      this.emit('status', newStatus)
    }
  }

  /** Returns the current rolling buffer contents. */
  getBuffer(): string[] {
    return [...this.buffer]
  }

  dispose(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer)
      this.silenceTimer = null
    }
    this.removeAllListeners()
  }
}
