import { CopilotClient, CopilotSession } from '@github/copilot-sdk'
import type { ConnectionStateChange } from '@github/copilot-sdk'
import path from 'path'
import { execSync } from 'child_process'
import { existsSync, appendFileSync } from 'fs'
import { homedir } from 'os'
import { SessionStore } from './SessionStore'
import type { PtyManager } from '../pty/PtyManager'

function sdkLog(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  try { appendFileSync(path.join(homedir(), '.tangent', 'sdk-debug.log'), line) } catch { /* */ }
}

/**
 * SdkSessionManager — Hybrid PTY+SDK mode for Copilot sessions.
 *
 * Copilot runs in a real PTY with `--ui-server --port 0` so the user sees
 * the full TUI. This manager watches the PTY output for the port announcement,
 * then connects the SDK to the embedded JSON-RPC server for deterministic
 * status detection, metrics, and structured events.
 */
const MAX_SUBSCRIBE_RETRIES = 5

export class SdkSessionManager {
  private clients = new Map<string, CopilotClient>()
  private sessions = new Map<string, CopilotSession>()
  private watching = new Set<string>()
  private retryCounts = new Map<string, number>()
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

      this.clients.set(sessionId, client)

      // Establish TCP connection to the embedded server
      await client.start()
      sdkLog(`SDK connected to port ${port} for session ${sessionId}`)

      const fgSessionId = await client.getForegroundSessionId()
      if (fgSessionId) {
        await this.subscribeToSession(sessionId, client, fgSessionId)
      } else {
        const sessions = await client.listSessions()
        if (sessions.length > 0) {
          await this.subscribeToSession(sessionId, client, sessions[0].sessionId)
        } else {
          setTimeout(() => this.retrySubscribe(sessionId, client), 3000)
        }
      }
    } catch (err) {
      sdkLog(`Failed to connect to port ${port}: ${(err as Error).message}`)
    }
  }

  private async retrySubscribe(sessionId: string, client: CopilotClient): Promise<void> {
    const count = (this.retryCounts.get(sessionId) ?? 0) + 1
    this.retryCounts.set(sessionId, count)
    if (count > MAX_SUBSCRIBE_RETRIES) {
      sdkLog(`Max retries (${MAX_SUBSCRIBE_RETRIES}) reached for ${sessionId} — falling back to OSC+SystemB`)
      this.retryCounts.delete(sessionId)
      return
    }
    try {
      // Always try a fresh foreground session ID — the previous one may have been stale
      const fgId = await client.getForegroundSessionId()
      if (fgId) { await this.subscribeToSession(sessionId, client, fgId); return }
      const sessions = await client.listSessions()
      if (sessions.length > 0) await this.subscribeToSession(sessionId, client, sessions[0].sessionId)
      else sdkLog(`Retry ${count}/${MAX_SUBSCRIBE_RETRIES}: no sessions found for ${sessionId}`)
    } catch (err) {
      sdkLog(`Retry ${count}/${MAX_SUBSCRIBE_RETRIES} failed: ${(err as Error).message}`)
    }
  }

  private async subscribeToSession(tangentSessionId: string, client: CopilotClient, sdkSessionId: string): Promise<void> {
    try {
      sdkLog(`Subscribing to SDK session ${sdkSessionId} for Tangent session ${tangentSessionId}`)
      const sdkSession = await client.resumeSession(sdkSessionId, { streaming: true })
      this.sessions.set(tangentSessionId, sdkSession)

      const session = this.store.get(tangentSessionId)
      if (session) {
        session.sdkSessionId = sdkSessionId
        session.updatedAt = Date.now()
      }

      this.wireSessionEvents(tangentSessionId, sdkSession)
      this.retryCounts.delete(tangentSessionId) // success — reset retry counter
      sdkLog(`SDK events wired for ${tangentSessionId}`)
    } catch (err) {
      const msg = (err as Error).message
      sdkLog(`Failed to subscribe: ${msg}`)

      // If session not found, retry after a delay — the TUI session may not
      // be registered with the server yet (race between TUI init and SDK connect)
      if (msg.includes('Session not found')) {
        sdkLog(`Will retry subscribe in 3s for ${tangentSessionId}`)
        setTimeout(() => this.retrySubscribe(tangentSessionId, client), 3000)
      }
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    this.watching.delete(sessionId)
    this.sessions.delete(sessionId)
    this.retryCounts.delete(sessionId)
    this.lastInputQuestion.delete(sessionId)
    const client = this.clients.get(sessionId)
    if (client) {
      try { await client.stop() } catch { /* */ }
      this.clients.delete(sessionId)
    }
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId) || this.clients.has(sessionId)
  }

  async dispose(): Promise<void> {
    for (const [id] of this.clients) await this.closeSession(id)
  }

  private wireSessionEvents(sessionId: string, sdkSession: CopilotSession): void {
    sdkSession.on('assistant.turn_start', () => {
      this.store.updateStatus(sessionId, 'processing')
    })
    sdkSession.on('assistant.intent', (event) => {
      this.store.updateActivity(sessionId, event.data.intent)
    })
    sdkSession.on('session.idle', () => {
      this.store.updateStatus(sessionId, 'agent_ready')
    })
    sdkSession.on('session.error', (event) => {
      this.store.updateStatus(sessionId, 'failed')
      this.store.updateActivity(sessionId, event.data.message)
    })
    sdkSession.on('session.shutdown', (event) => {
      this.store.updateMetrics(sessionId, { totalPremiumRequests: event.data.totalPremiumRequests })
      this.store.updateStatus(sessionId, 'exited')
    })
    sdkSession.on('tool.execution_start', (event) => {
      this.store.updateStatus(sessionId, 'tool_executing')
      this.store.updateActivity(sessionId, event.data.toolName)
    })
    sdkSession.on('tool.execution_progress', (event) => {
      this.store.updateActivity(sessionId, event.data.progressMessage)
    })
    sdkSession.on('tool.execution_complete', () => {
      this.store.updateStatus(sessionId, 'processing')
    })
    sdkSession.on('assistant.usage', (event) => {
      this.store.updateMetrics(sessionId, {
        inputTokens: event.data.inputTokens ?? 0,
        outputTokens: event.data.outputTokens ?? 0,
        cacheReadTokens: event.data.cacheReadTokens ?? 0,
        cacheWriteTokens: event.data.cacheWriteTokens ?? 0,
        cost: event.data.cost ?? 0
      })
    })
    sdkSession.on('session.context_changed', (event) => {
      const folderName = path.basename(event.data.cwd)
      this.store.updateCwd(sessionId, event.data.cwd, folderName)
    })
    sdkSession.on('session.title_changed', (event) => {
      this.store.updateActivity(sessionId, event.data.title)
    })
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
