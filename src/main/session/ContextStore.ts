import { EventEmitter } from 'events'
import type {
  Session,
  SessionStatus,
  SessionMetrics,
  AgentType,
  PromptEntry,
  ResumeSuggestion,
  HumanContext,
  ToolUseEntry,
} from '@shared/types'
import type { SessionStore } from './SessionStore'

const MAX_PROMPTS = 10
const DEBOUNCE_MS = 150

/**
 * ContextStore — Maintains per-session human context for quick re-orientation.
 *
 * Stores a ring buffer of recent prompts/commands per session and computes
 * resume suggestions based on current session state. Data is in-memory only
 * (not persisted to disk) and cleared when a session closes.
 */
export class ContextStore extends EventEmitter {
  private prompts = new Map<string, PromptEntry[]>()
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(private store: SessionStore) {
    super()

    // Clean up prompt buffer when sessions are removed
    store.on('closed', (sessionId: string) => {
      this.prompts.delete(sessionId)
      this.clearDebounce(sessionId)
    })
  }

  /**
   * Record a user prompt/command for a session.
   * Deduplicates consecutive identical entries.
   */
  addPrompt(sessionId: string, text: string, source: 'terminal' | 'sdk'): void {
    const trimmed = text.trim()
    if (!trimmed || trimmed.length < 2) return

    const list = this.prompts.get(sessionId) ?? []

    // Deduplicate: skip if identical to most recent entry
    if (list.length > 0 && list[list.length - 1].text === trimmed) return

    list.push({ text: trimmed, timestamp: Date.now(), source })

    // Ring buffer: keep only the last MAX_PROMPTS entries
    while (list.length > MAX_PROMPTS) {
      list.shift()
    }

    this.prompts.set(sessionId, list)
    this.scheduleUpdate(sessionId)
  }

  /**
   * Get the full HumanContext for a session.
   */
  getContext(sessionId: string): HumanContext | null {
    const session = this.store.get(sessionId)
    if (!session) return null

    const prompts = this.prompts.get(sessionId) ?? []
    // Return most recent 2 prompts, oldest first (chronological order)
    const recentPrompts = prompts.slice(-2)

    return {
      sessionId,
      prompts: recentPrompts,
      resumeSuggestion: this.computeResumeSuggestion(session, prompts),
      snapshot: {
        agentType: session.agentType,
        status: session.status,
        folderPath: session.folderPath,
        lastActiveAgo: Date.now() - session.updatedAt,
        metrics: session.metrics,
      },
    }
  }

  /**
   * Compute a contextual resume suggestion based on session state.
   */
  private computeResumeSuggestion(session: Session, prompts: PromptEntry[]): ResumeSuggestion {
    const lastPrompt = prompts.length > 0 ? prompts[prompts.length - 1].text : undefined
    const truncated = lastPrompt && lastPrompt.length > 60
      ? lastPrompt.slice(0, 57) + '...'
      : lastPrompt

    switch (session.status) {
      case 'needs_input':
        return {
          icon: '⚡',
          text: 'Agent is waiting for your response',
          action: 'respond',
        }

      case 'processing':
      case 'tool_executing':
        return {
          icon: '⏳',
          text: truncated
            ? `Agent is working — last asked: "${truncated}"`
            : 'Agent is working...',
        }

      case 'failed':
        return {
          icon: '❌',
          text: session.exitCode != null
            ? `Session failed (exit code ${session.exitCode}) — restart or review output`
            : 'Session failed — review output for errors',
          action: 'review',
        }

      case 'exited':
        return {
          icon: '🏁',
          text: 'Session ended — start a new session to continue',
          action: 'new-session',
        }

      case 'agent_ready': {
        const idleMs = Date.now() - session.updatedAt
        if (idleMs > 5 * 60 * 1000) {
          return {
            icon: '💤',
            text: 'Agent is idle — pick up where you left off',
            action: 'resume',
          }
        }
        return {
          icon: '✅',
          text: 'Agent is ready for your next prompt',
          action: 'prompt',
        }
      }

      case 'agent_launching':
        return {
          icon: '🚀',
          text: 'Agent is launching...',
        }

      case 'shell_ready':
        return {
          icon: '🐚',
          text: truncated
            ? `Shell is ready — last command: ${truncated}`
            : 'Shell is ready',
          action: 'prompt',
        }

      default:
        return { icon: '📋', text: 'Session active' }
    }
  }

  /**
   * Debounce context-updated events to avoid re-render storms.
   */
  private scheduleUpdate(sessionId: string): void {
    this.clearDebounce(sessionId)
    const timer = setTimeout(() => {
      this.debounceTimers.delete(sessionId)
      const ctx = this.getContext(sessionId)
      if (ctx) {
        this.emit('context-updated', ctx)
      }
    }, DEBOUNCE_MS)
    this.debounceTimers.set(sessionId, timer)
  }

  private clearDebounce(sessionId: string): void {
    const existing = this.debounceTimers.get(sessionId)
    if (existing) {
      clearTimeout(existing)
      this.debounceTimers.delete(sessionId)
    }
  }

  dispose(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer)
    }
    this.debounceTimers.clear()
    this.prompts.clear()
    this.removeAllListeners()
  }
}
