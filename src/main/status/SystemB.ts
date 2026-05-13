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
  { priority: 2, pattern: /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⊙◐◑◒◓]/, status: 'processing' },
  { priority: 3, pattern: /[Tt]hinking/, status: 'processing' },
  { priority: 4, pattern: /running tool:|executing command:|Reading file|Writing file/i, status: 'tool_executing' },
  { priority: 5, pattern: /Asking user|Other \(type your answer\)|Select a session(?: to resume)?|to select|Enter to confirm|(y\/n)|continue\?|allow\?|permit\?|approve\?/i, status: 'needs_input' },
  { priority: 6, pattern: /^❯\s*$/m, status: 'agent_ready' },
  { priority: 7, pattern: /^›\s*$/m, status: 'agent_ready' },
  { priority: 8, pattern: /^Error:|^FATAL:|command not found$|ENOENT|CommandNotFoundException/m, status: 'failed' },
]

// Spinner characters are real-time indicators — they only appear when
// Copilot is actively animating. These can override needs_input because
// they prove the agent is actually processing (not just stale text).
const SPINNER_PATTERN = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⊙◐◑◒◓]/
const IDLE_PROMPT_PATTERN = /^[❯›]\s*$/m
const INTERACTIVE_PICKER_PATTERN = /Select a session(?: to resume)?|Enter to select|↑↓\s+to (?:navigate|select)/i

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
// These patterns match the actual TUI banner output, not casual mentions in dir/ls
const AGENT_DETECT_PATTERNS: { pattern: RegExp; agentType: 'copilot-cli' | 'claude-code' }[] = [
  { pattern: /GitHub Copilot v\d|Describe a task to get started/i, agentType: 'copilot-cli' },
  { pattern: /Claude Code|claude-code.*v\d|anthropic/i, agentType: 'claude-code' },
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
  private needsInputCooldownUntil = 0
  private lastShellCommand = ''

  feed(data: string): void {
    // Update rolling buffer
    const lines = data.split('\n')
    this.buffer.push(...lines)
    while (this.buffer.length > STATUS_TIMING.OUTPUT_BUFFER_LINES) {
      this.buffer.shift()
    }

    // Strip ANSI escape sequences for all pattern matching
    const clean = stripAnsi(data)

    // Diagnostic: log status-relevant matches to debug alt-screen issues
    if (process.env.TANGENT_STATUS_DEBUG) {
      const needsInputMatch = RULES[4].pattern.test(clean)
      const promptMatch = IDLE_PROMPT_PATTERN.test(clean)
      const spinnerMatch = SPINNER_PATTERN.test(clean)
      if (needsInputMatch || spinnerMatch) {
        const snippet = clean.slice(0, 300).replace(/\n/g, '\\n')
        try {
          const fs = require('fs'), path = require('path'), os = require('os')
          fs.appendFileSync(path.join(os.homedir(), '.tangent', 'status-debug.log'),
            `[${new Date().toISOString()}] needs_input=${needsInputMatch} spinner=${spinnerMatch} prompt=${promptMatch} status=${this.currentStatus} cooldown=${Date.now() < this.needsInputCooldownUntil}\n  ${snippet}\n`)
        } catch { /* */ }
      }
    }

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
          this.emit('agent-detected', agentType, this.lastShellCommand)
          break
        }
      }
    }

    // Extract shell commands from PS prompt lines (e.g., "PS C:\git> cd foo")
    const cmdMatch = clean.match(SHELL_COMMAND_PATTERN)
    if (cmdMatch) {
      this.lastShellCommand = cmdMatch[1].trim()
      this.emit('command', this.lastShellCommand)
    }

    // Run detection rules in priority order
    for (const rule of RULES) {
      if (!rule.pattern.test(clean)) continue

      // agent_ready needs 300ms silence confirmation.
      // Skip if currently processing/tool_executing — the ❯ prompt is always
      // visible in the Copilot CLI TUI input area, even during active work.
      if (rule.status === 'agent_ready') {
        if (this.currentStatus === 'processing' || this.currentStatus === 'tool_executing') {
          return // Don't let the always-visible prompt override active work
        }
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
      // Spinner characters (rule 2) can override needs_input because they are
      // real-time indicators. Text-based matches like "Thinking" (rule 3) cannot
      // override needs_input because they persist in TUI redraws.
      if (rule.status === 'processing') {
        if (this.currentStatus === 'needs_input') {
          if (!SPINNER_PATTERN.test(clean)) return // Only spinners can override
          this.needsInputCooldownUntil = Date.now() + 3000
        }
        // Clear any pending failed count
        this.failedMatchCount = 0
        this.tryTransition('processing')
        return
      }

      // needs_input is urgent — override hold timer to draw attention immediately
      // But respect cooldown after OSC cleared needs_input (stale TUI redraws)
      // Also skip if a bare ❯ prompt is present — means the agent is idle and the
      // needs_input text is historical, unless the current screen is a picker.
      if (rule.status === 'needs_input') {
        if (Date.now() < this.needsInputCooldownUntil) return
        if (IDLE_PROMPT_PATTERN.test(clean) && !INTERACTIVE_PICKER_PATTERN.test(clean)) return // Agent prompt visible → stale text
        this.lastTransitionTime = 0 // Reset hold to force immediate transition
        this.tryTransition('needs_input')
        return
      }

      // All other statuses: apply with hold check
      this.tryTransition(rule.status)
      return // First matching rule wins
    }
  }

  /**
   * Called by StatusEngine when an authoritative signal (OSC progress) clears
   * needs_input. Prevents SystemB from re-entering needs_input due to stale
   * TUI redraws that still contain the question text.
   */
  clearNeedsInput(): void {
    this.needsInputCooldownUntil = Date.now() + 3000
    if (this.currentStatus === 'needs_input') {
      this.currentStatus = null // Allow next transition without same-status check
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
