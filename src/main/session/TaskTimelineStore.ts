import { EventEmitter } from 'events'
import { v4 as uuid } from 'uuid'
import type { TaskTimelineItem, TaskTimelineSource, AgentType, TaskOutcome } from '@shared/types'

const MAX_FULL_RESPONSE_CHARS = 10 * 1024  // 10KB
const MAX_SUMMARY_CHARS = 240
const MAX_OUTPUT_BUFFER_CHARS = 50 * 1024  // Keep 50KB rolling buffer while in-progress
const PREVIEW_UPDATE_INTERVAL_MS = 750

/**
 * TaskTimelineStore — In-memory prompt/task timeline per session.
 *
 * Tracks user prompts and their outcomes without intervening processing/tool noise.
 * Items progress through states: in-progress → success/partial/error/interrupted.
 *
 * Emits:
 *  - 'item-added' (item: TaskTimelineItem)
 *  - 'item-updated' (item: TaskTimelineItem)
 */
export class TaskTimelineStore extends EventEmitter {
  private items = new Map<string, TaskTimelineItem[]>() // sessionId → items
  private outputBuffers = new Map<string, string>() // sessionId → rolling output for in-progress item
  private lastPreviewUpdateAt = new Map<string, number>() // sessionId → timestamp

  /**
   * Record a new prompt/task for a session.
   * Automatically marks it as in-progress.
   */
  recordPrompt(
    sessionId: string,
    promptText: string,
    source: TaskTimelineSource,
    agentType: AgentType
  ): TaskTimelineItem {
    const cleanedPrompt = this.stripAnsiAndControl(promptText).replace(/\s+/g, ' ').trim()
    const item: TaskTimelineItem = {
      id: uuid(),
      sessionId,
      promptText: cleanedPrompt,
      promptTimestamp: Date.now(),
      source,
      agentType,
      status: 'in-progress',
      startedAt: Date.now(),
      toolsUsed: [],
      interrupted: false
    }

    const list = this.items.get(sessionId) ?? []
    list.push(item)
    this.items.set(sessionId, list)

    // Clear output buffer for new item
    this.outputBuffers.set(sessionId, '')
    this.lastPreviewUpdateAt.delete(sessionId)

    this.emit('item-added', item)
    return item
  }

  /**
   * Append output data to the in-progress item's rolling buffer.
   * Keeps bounded buffer (around 50KB) while item is in-progress.
   */
  appendOutput(sessionId: string, data: string): void {
    const list = this.items.get(sessionId)
    if (!list || list.length === 0) return

    const latest = list[list.length - 1]
    if (latest.status !== 'in-progress') return

    let buffer = this.outputBuffers.get(sessionId) ?? ''
    buffer += data

    // Keep bounded buffer
    if (buffer.length > MAX_OUTPUT_BUFFER_CHARS) {
      buffer = buffer.slice(-MAX_OUTPUT_BUFFER_CHARS)
    }

    this.outputBuffers.set(sessionId, buffer)
    this.updatePreview(sessionId, latest, buffer)
  }

  /**
   * Complete the latest in-progress item for a session.
   * Extracts response summary/full response from buffered output.
   */
  completeLatest(
    sessionId: string,
    status?: TaskOutcome,
    errorMessage?: string
  ): TaskTimelineItem | undefined {
    const list = this.items.get(sessionId)
    if (!list || list.length === 0) return undefined

    const latest = list[list.length - 1]
    if (latest.status !== 'in-progress') return undefined

    latest.status = status ?? 'success'
    latest.completedAt = Date.now()
    if (errorMessage) {
      latest.errorMessage = errorMessage
    }

    // Extract response from buffered output
    const buffer = this.outputBuffers.get(sessionId) ?? ''
    if (buffer) {
      const cleaned = this.stripAnsiAndControl(buffer)
      latest.fullResponse = this.truncate(cleaned, MAX_FULL_RESPONSE_CHARS)
      latest.responseSummary = this.extractSummary(cleaned)
    }

    // Clear output buffer
    this.outputBuffers.delete(sessionId)
    this.lastPreviewUpdateAt.delete(sessionId)

    this.emit('item-updated', latest)
    return latest
  }

  /**
   * Mark all in-progress items for a session as failed/interrupted.
   */
  failInProgress(sessionId: string, errorMessage: string): void {
    const list = this.items.get(sessionId)
    if (!list) return

    let updated = false
    for (const item of list) {
      if (item.status === 'in-progress') {
        item.status = 'error'
        item.completedAt = Date.now()
        item.errorMessage = errorMessage
        item.interrupted = true
        this.emit('item-updated', item)
        updated = true
      }
    }

    if (updated) {
      this.outputBuffers.delete(sessionId)
      this.lastPreviewUpdateAt.delete(sessionId)
    }
  }

  /**
   * Get timeline items for a session with optional pagination.
   */
  getTimeline(
    sessionId: string,
    opts?: { limit?: number; offset?: number }
  ): TaskTimelineItem[] {
    const list = this.items.get(sessionId) ?? []
    const { limit, offset = 0 } = opts ?? {}

    // Return newest first
    const reversed = [...list].reverse()

    if (limit !== undefined) {
      return reversed.slice(offset, offset + limit)
    }

    return reversed.slice(offset)
  }

  /**
   * Clear all timeline items for a session.
   */
  clearSession(sessionId: string): void {
    this.items.delete(sessionId)
    this.outputBuffers.delete(sessionId)
    this.lastPreviewUpdateAt.delete(sessionId)
  }

  /**
   * Strip ANSI escape sequences and control characters from terminal output.
   */
  private stripAnsiAndControl(text: string): string {
    return text
      // Remove CSI, OSC, and VT100/xterm control sequences.
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
      .replace(/\x1b[P^_][^\x1b]*(?:\x1b\\|\x07)/g, '')
      .replace(/\x1b[()][0-9A-Za-z]/g, '')
      .replace(/\x1b[@-Z\\-_]/g, '')
      // Remove other control chars except \n, \r, \t
      .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '')
      // Normalize line endings
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
  }

  private updatePreview(sessionId: string, item: TaskTimelineItem, buffer: string): void {
    const now = Date.now()
    const lastUpdate = this.lastPreviewUpdateAt.get(sessionId) ?? 0
    if (now - lastUpdate < PREVIEW_UPDATE_INTERVAL_MS) return

    const cleaned = this.stripAnsiAndControl(buffer)
    item.fullResponse = this.truncate(cleaned, MAX_FULL_RESPONSE_CHARS)
    item.responseSummary = this.extractSummary(cleaned)
    this.lastPreviewUpdateAt.set(sessionId, now)
    this.emit('item-updated', item)
  }

  /**
   * Truncate text to max length, adding ellipsis if needed.
   */
  private truncate(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text
    return text.slice(0, maxChars - 3) + '...'
  }

  /**
   * Extract a short summary from response text.
   * Takes first meaningful line or first 240 chars.
   */
  private extractSummary(text: string): string {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0)

    if (lines.length === 0) return ''

    // Find first substantial line (> 10 chars)
    const firstLine = lines.find(l => l.length > 10) ?? lines[0]

    return this.truncate(firstLine, MAX_SUMMARY_CHARS)
  }
}
