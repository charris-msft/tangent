import { CopilotClient } from '@github/copilot-sdk'
import type { ConnectionStateChange, SessionEvent } from '@github/copilot-sdk'
import path from 'path'
import { execSync } from 'child_process'
import { existsSync, appendFileSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { SessionStore } from './SessionStore'
import type { PtyManager } from '../pty/PtyManager'

function sdkLog(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  try { appendFileSync(path.join(homedir(), '.tangent', 'sdk-debug.log'), line) } catch { /* */ }
}

/** Extract plugin name from skill path (e.g., ~/.copilot/installed-plugins/my-plugin/skills/foo/) */
function extractPluginName(skillPath: string): string | undefined {
  const match = skillPath.match(/installed-plugins[\\/]([^\\/]+)[\\/]/)
    || skillPath.match(/plugins[\\/]_direct[\\/]([^\\/]+)[\\/]/)
  return match?.[1]
}

/** Try to read plugin version from <pluginName>.config.json in the plugin directory */
function extractPluginVersion(skillPath: string): string | undefined {
  try {
    const pluginName = extractPluginName(skillPath)
    if (!pluginName) return undefined
    // Find the plugin root directory (path up to plugin name)
    const match = skillPath.match(/(.*installed-plugins[\\/](?:_direct[\\/])?[^\\/]+)[\\/]/)
    if (!match) return undefined
    const pluginDir = match[1]
    const configFile = path.join(pluginDir, `${pluginName}.config.json`)
    if (existsSync(configFile)) {
      const content = JSON.parse(readFileSync(configFile, 'utf-8'))
      return content.version
    }
  } catch { /* */ }
  return undefined
}

/**
 * SdkSessionManager — Hybrid PTY+SDK mode for Copilot sessions.
 *
 * Copilot runs in a real PTY with `--ui-server --port 0` so the user sees
 * the full TUI. This manager watches the PTY output for the port announcement,
 * then connects the SDK to the embedded JSON-RPC server for deterministic
 * status detection, metrics, and structured events.
 */
export class SdkSessionManager {
  private clients = new Map<string, CopilotClient>()
  private watching = new Set<string>()
  private lastInputQuestion = new Map<string, string>()
  private onNeedsInputCleared?: (sessionId: string) => void

  constructor(
    private store: SessionStore,
    private ptyManager: PtyManager
  ) {}

  /** Register a callback for when SDK clears needs_input (tells SystemB to cooldown). */
  setNeedsInputClearedCallback(cb: (sessionId: string) => void): void {
    this.onNeedsInputCleared = cb
  }

  attachToSession(sessionId: string, ptyId: string): void {
    // Prevent duplicate connections
    if (this.clients.has(sessionId) || this.watching.has(sessionId)) {
      sdkLog(`Already watching/connected session ${sessionId}, skipping duplicate attach`)
      return
    }
    this.watching.add(sessionId)

    sdkLog(`Watching PTY ${ptyId} for ui-server port (session ${sessionId})`)

    let stdout = ''
    const PORT_PATTERN = /(?:listening on port|server started on port)\s+(\d+)/i
    const TIMEOUT_MS = 30_000

    const onData = (_emittedPtyId: string, data: string): void => {
      if (_emittedPtyId !== ptyId) return
      stdout += data
      const match = stdout.match(PORT_PATTERN)
      if (match) {
        cleanup()
        const port = parseInt(match[1], 10)
        sdkLog(`Found ui-server port ${port} for session ${sessionId}`)
        this.connectToPort(sessionId, port)
      }
    }

    const timer = setTimeout(() => {
      cleanup()
      sdkLog(`Timeout waiting for ui-server port (session ${sessionId}) — PTY fallback active`)
    }, TIMEOUT_MS)

    const cleanup = (): void => {
      clearTimeout(timer)
      this.ptyManager.removeListener('data', onData)
    }

    this.ptyManager.on('data', onData)
  }

  private async connectToPort(sessionId: string, port: number): Promise<void> {
    try {
      const client = new CopilotClient({
        cliUrl: `localhost:${port}`
      })

      client.onConnectionStateChange((change: ConnectionStateChange) => {
        sdkLog(`SDK connection: ${change.previousState} → ${change.currentState} (${change.reason ?? ''})`)
      })

      // Detect when the agent asks the user a question → needs_input
      // SDK may fire this callback twice for the same question — deduplicate
      client.onUserInputRequested((info) => {
        const lastQ = this.lastInputQuestion.get(sessionId)
        if (lastQ === info.question) return // duplicate
        this.lastInputQuestion.set(sessionId, info.question)
        sdkLog(`User input requested for session ${sessionId}: ${info.question}`)
        this.store.updateStatus(sessionId, 'needs_input')
        this.store.updateActivity(sessionId, info.question)
      })

      // Detect when the user answers → processing (agent resumes)
      client.onUserInputCompleted((info) => {
        sdkLog(`User input completed for session ${sessionId}: ${JSON.stringify(info.answer)}`)
        this.lastInputQuestion.delete(sessionId) // reset for next question
        this.onNeedsInputCleared?.(sessionId)
        this.store.updateStatus(sessionId, 'processing')
      })

      // Wire ALL session events at the CLIENT level — bypasses session ID mismatch.
      // The CLI may broadcast events with a different session ID than what
      // resumeSession returns, causing session-level .on() handlers to miss events.
      this.wireClientEvents(sessionId, client)

      this.clients.set(sessionId, client)

      // Establish TCP connection to the embedded server
      await client.start()
      sdkLog(`SDK connected to port ${port} for session ${sessionId}`)

      // Try to subscribe for session resume (nice-to-have for context, not required for events)
      try {
        const fgSessionId = await client.getForegroundSessionId()
        if (fgSessionId) {
          const session = this.store.get(sessionId)
          if (session) {
            session.sdkSessionId = fgSessionId
            session.updatedAt = Date.now()
          }
          sdkLog(`Foreground session: ${fgSessionId} for Tangent session ${sessionId}`)
        }
      } catch (err) {
        sdkLog(`getForegroundSessionId failed (non-fatal): ${(err as Error).message}`)
      }
    } catch (err) {
      sdkLog(`Failed to connect to port ${port}: ${(err as Error).message}`)
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    this.watching.delete(sessionId)
    this.lastInputQuestion.delete(sessionId)
    const client = this.clients.get(sessionId)
    if (client) {
      try { await client.stop() } catch { /* */ }
      this.clients.delete(sessionId)
    }
  }

  hasSession(sessionId: string): boolean {
    return this.clients.has(sessionId)
  }

  async dispose(): Promise<void> {
    for (const [id] of this.clients) await this.closeSession(id)
  }

  /**
   * Wire ALL session events at the CLIENT level using onSessionEvent().
   * This fires for every event regardless of session ID matching — eliminates
   * the bug where session.resume returns a different ID than what the CLI
   * uses for event notifications, causing session-level .on() to miss events.
   */
  private wireClientEvents(sessionId: string, client: CopilotClient): void {
    client.onSessionEvent((_sdkSessionId: string, event: SessionEvent) => {
      const type = event.type
      const data = event.data as Record<string, unknown>

      // Log status-relevant events for debugging
      if (['assistant.turn_start', 'session.idle', 'session.error', 'session.shutdown',
           'tool.execution_start', 'tool.execution_complete', 'skill.invoked',
           'subagent.started', 'subagent.completed', 'subagent.failed'].includes(type)) {
        sdkLog(`[event] ${type} for session ${sessionId} (sdk: ${_sdkSessionId})`)
      }

      switch (type) {
        case 'assistant.turn_start':
          this.store.updateStatus(sessionId, 'processing')
          break
        case 'assistant.intent':
          if (data?.intent) this.store.updateActivity(sessionId, data.intent as string)
          break
        case 'session.idle':
          this.store.updateStatus(sessionId, 'agent_ready')
          break
        case 'session.error':
          this.store.updateStatus(sessionId, 'failed')
          if (data?.message) this.store.updateActivity(sessionId, data.message as string)
          break
        case 'session.shutdown':
          if (data?.totalPremiumRequests != null) {
            this.store.updateMetrics(sessionId, { totalPremiumRequests: data.totalPremiumRequests as number })
          }
          this.store.updateStatus(sessionId, 'exited')
          break
        case 'tool.execution_start': {
          const toolName = data?.toolName as string
          // Skip ask_user — handled by onUserInputRequested
          if (toolName === 'ask_user') break
          this.store.updateStatus(sessionId, 'tool_executing')
          this.store.updateActivity(sessionId, toolName)
          const isMcp = !!data?.mcpServerName
          this.store.addToolUse({
            id: data?.toolCallId as string,
            sessionId,
            kind: 'tool',
            name: (data?.mcpToolName as string) ?? toolName,
            source: isMcp ? 'mcp' : 'built-in',
            status: 'running',
            startedAt: Date.now(),
            mcpServerName: data?.mcpServerName as string | undefined,
            mcpToolName: data?.mcpToolName as string | undefined,
            args: data?.arguments,
            parentToolCallId: data?.parentToolCallId as string | undefined,
          })
          break
        }
        case 'tool.execution_progress': {
          const msg = data?.progressMessage as string | undefined
          if (msg) {
            this.store.updateActivity(sessionId, msg)
            this.store.updateToolUse(sessionId, data?.toolCallId as string, { progressMessage: msg })
          }
          break
        }
        case 'tool.execution_complete': {
          const toolCallId = data?.toolCallId as string
          const success = data?.success as boolean
          this.store.updateStatus(sessionId, 'processing')
          const result = data?.result as { content?: string } | undefined
          const error = data?.error as { message?: string } | undefined
          this.store.updateToolUse(sessionId, toolCallId, {
            status: success ? 'success' : 'error',
            completedAt: Date.now(),
            result: result?.content,
            error: error?.message,
          })
          break
        }
        case 'skill.invoked': {
          const skillPath = data?.path as string ?? ''
          const pluginName = extractPluginName(skillPath)
          const pluginVersion = extractPluginVersion(skillPath)
          this.store.addToolUse({
            id: `skill-${Date.now()}`,
            sessionId,
            kind: 'skill',
            name: data?.name as string,
            source: 'skill',
            status: 'success',
            startedAt: Date.now(),
            completedAt: Date.now(),
            pluginName,
            pluginVersion,
          })
          break
        }
        case 'subagent.started':
          this.store.addToolUse({
            id: data?.toolCallId as string,
            sessionId,
            kind: 'subagent',
            name: (data?.agentDisplayName as string) || (data?.agentName as string),
            source: 'built-in',
            status: 'running',
            startedAt: Date.now(),
          })
          break
        case 'subagent.completed':
          this.store.updateToolUse(sessionId, data?.toolCallId as string, {
            status: 'success',
            completedAt: Date.now(),
          })
          break
        case 'subagent.failed':
          this.store.updateToolUse(sessionId, data?.toolCallId as string, {
            status: 'error',
            completedAt: Date.now(),
            error: data?.error as string,
          })
          break
        case 'assistant.usage': {
          this.store.updateMetrics(sessionId, {
            inputTokens: (data?.inputTokens as number) ?? 0,
            outputTokens: (data?.outputTokens as number) ?? 0,
            cacheReadTokens: (data?.cacheReadTokens as number) ?? 0,
            cacheWriteTokens: (data?.cacheWriteTokens as number) ?? 0,
            cost: (data?.cost as number) ?? 0
          })
          break
        }
        case 'session.context_changed': {
          const cwd = data?.cwd as string
          if (cwd) {
            const folderName = path.basename(cwd)
            this.store.updateCwd(sessionId, cwd, folderName)
          }
          break
        }
        case 'session.title_changed': {
          const title = data?.title as string
          if (title) this.store.updateActivity(sessionId, title)
          break
        }
      }
    })
    sdkLog(`Client-level events wired for session ${sessionId}`)
  }

  findCliPath(): string | undefined {
    try {
      const which = process.platform === 'win32' ? 'where.exe copilot' : 'which copilot'
      const result = execSync(which, { encoding: 'utf-8', timeout: 5000 }).trim()
      const firstLine = result.split(/\r?\n/)[0]
      if (firstLine && existsSync(firstLine)) return firstLine
    } catch { /* */ }
    return undefined
  }
}
