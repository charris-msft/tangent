import { CopilotClient, CopilotSession } from '@github/copilot-sdk'
import type { ConnectionStateChange } from '@github/copilot-sdk'
import type { BrowserWindow } from 'electron'
import path from 'path'
import { execSync } from 'child_process'
import { existsSync, appendFileSync } from 'fs'
import { homedir } from 'os'
import { SessionStore } from './SessionStore'
import type { PtyManager } from '../pty/PtyManager'

function sdkLog(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  try { appendFileSync(path.join(homedir(), '.tangent', 'sdk-debug.log'), line) } catch { /* */ }
  console.log(`[SdkSessionManager] ${msg}`)
}

/**
 * SdkSessionManager — Hybrid PTY+SDK mode for Copilot sessions.
 *
 * Launches `copilot --ui-server --port 0` in a real PTY so the user sees
 * the full Copilot TUI (identical to running copilot natively). Then connects
 * the SDK to the embedded JSON-RPC server for deterministic status detection,
 * metrics, and structured events — eliminating the need for SystemB regex scraping.
 *
 * Architecture:
 *   PTY (node-pty) → xterm.js  (user sees the real TUI — prompt, markdown, colors)
 *   SDK (CopilotClient) → SessionStore  (status, metrics, activity — no regex)
 */
export class SdkSessionManager {
  private clients = new Map<string, CopilotClient>()
  private sessions = new Map<string, CopilotSession>()
  private getWindow: () => BrowserWindow | null

  constructor(
    private store: SessionStore,
    private ptyManager: PtyManager,
    getWindow: () => BrowserWindow | null
  ) {
    this.getWindow = getWindow
  }

  /**
   * Attach the SDK to a Copilot session that was launched in a PTY.
   *
   * The PTY is already running `copilot --ui-server --port 0`.
   * This method watches the PTY output for the port announcement,
   * then connects the SDK to that port for structured events.
   */
  attachToSession(sessionId: string, ptyId: string): void {
    sdkLog(`Watching PTY ${ptyId} for ui-server port (session ${sessionId})`)

    let stdout = ''
    const PORT_PATTERN = /listening on port (\d+)/i
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
      sdkLog(`Timeout waiting for ui-server port (session ${sessionId})`)
      // Not fatal — the PTY session still works, just without SDK events
    }, TIMEOUT_MS)

    const cleanup = (): void => {
      clearTimeout(timer)
      this.ptyManager.removeListener('data', onData)
    }

    this.ptyManager.on('data', onData)
  }

  /**
   * Connect the SDK client to the Copilot CLI's embedded JSON-RPC server.
   */
  private async connectToPort(sessionId: string, port: number): Promise<void> {
    try {
      const client = new CopilotClient({
        cliUrl: `localhost:${port}`,
        useLoggedInUser: true
      })

      client.onConnectionStateChange((change: ConnectionStateChange) => {
        sdkLog(`Connection state: ${change.previousState} → ${change.currentState} (session ${sessionId})`)
        if (change.currentState === 'error') {
          this.store.updateActivity(sessionId, change.error?.message ?? 'SDK connection error')
        }
      })

      this.clients.set(sessionId, client)

      // Get the foreground session from the TUI
      const fgSessionId = await client.getForegroundSessionId()
      if (fgSessionId) {
        sdkLog(`Connected to foreground session: ${fgSessionId}`)
        this.subscribeToSession(sessionId, client, fgSessionId)
      } else {
        // List sessions and pick the first one
        const sessions = await client.listSessions()
        if (sessions.length > 0) {
          sdkLog(`Connected, found ${sessions.length} session(s), attaching to first`)
          this.subscribeToSession(sessionId, client, sessions[0].sessionId)
        } else {
          sdkLog(`Connected but no sessions found yet, will retry`)
          // Retry after a short delay — the TUI might still be starting
          setTimeout(() => this.retrySubscribe(sessionId, client), 3000)
        }
      }
    } catch (err) {
      sdkLog(`Failed to connect SDK to port ${port}: ${(err as Error).message}`)
      // Not fatal — PTY session continues without SDK events
    }
  }

  private async retrySubscribe(sessionId: string, client: CopilotClient): Promise<void> {
    try {
      const fgSessionId = await client.getForegroundSessionId()
      if (fgSessionId) {
        this.subscribeToSession(sessionId, client, fgSessionId)
        return
      }
      const sessions = await client.listSessions()
      if (sessions.length > 0) {
        this.subscribeToSession(sessionId, client, sessions[0].sessionId)
      } else {
        sdkLog(`Retry: still no sessions for ${sessionId}`)
      }
    } catch (err) {
      sdkLog(`Retry subscribe failed: ${(err as Error).message}`)
    }
  }

  /**
   * Subscribe to SDK events for a specific CLI session.
   */
  private async subscribeToSession(tangentSessionId: string, client: CopilotClient, sdkSessionId: string): Promise<void> {
    try {
      // Resume the session to get event subscriptions without creating a new one
      const sdkSession = await client.resumeSession(sdkSessionId, {
        streaming: true
      })

      this.sessions.set(tangentSessionId, sdkSession)

      // Update the Tangent session with the SDK session ID
      const session = this.store.get(tangentSessionId)
      if (session) {
        session.sdkSessionId = sdkSessionId
        session.updatedAt = Date.now()
      }

      this.wireSessionEvents(tangentSessionId, sdkSession)
      sdkLog(`SDK events wired for session ${tangentSessionId} (SDK: ${sdkSessionId})`)
    } catch (err) {
      sdkLog(`Failed to subscribe to session ${sdkSessionId}: ${(err as Error).message}`)
    }
  }

  /**
   * Clean up SDK connection for a session.
   */
  async closeSession(sessionId: string): Promise<void> {
    const sdkSession = this.sessions.get(sessionId)
    if (sdkSession) {
      this.sessions.delete(sessionId)
    }
    const client = this.clients.get(sessionId)
    if (client) {
      try {
        await client.stop()
      } catch { /* */ }
      this.clients.delete(sessionId)
    }
  }

  /**
   * Check if a session has an SDK connection.
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId) || this.clients.has(sessionId)
  }

  /**
   * Stop all SDK connections.
   */
  async dispose(): Promise<void> {
    for (const [sessionId] of this.clients) {
      await this.closeSession(sessionId)
    }
  }

  /**
   * Wire SDK session events to SessionStore for status/metrics/activity.
   * These events OVERRIDE SystemB detection — they're deterministic.
   */
  private wireSessionEvents(sessionId: string, sdkSession: CopilotSession): void {
    // === Status Events ===

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
      const data = event.data
      this.store.updateMetrics(sessionId, {
        totalPremiumRequests: data.totalPremiumRequests
      })
      this.store.updateStatus(sessionId, 'exited')
    })

    // === Tool Events ===

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

    // === Metrics ===

    sdkSession.on('assistant.usage', (event) => {
      this.store.updateMetrics(sessionId, {
        inputTokens: event.data.inputTokens ?? 0,
        outputTokens: event.data.outputTokens ?? 0,
        cacheReadTokens: event.data.cacheReadTokens ?? 0,
        cacheWriteTokens: event.data.cacheWriteTokens ?? 0,
        cost: event.data.cost ?? 0
      })
    })

    // === Context Changes ===

    sdkSession.on('session.context_changed', (event) => {
      const folderName = path.basename(event.data.cwd)
      this.store.updateCwd(sessionId, event.data.cwd, folderName)
    })

    // === Title Changes ===

    sdkSession.on('session.title_changed', (event) => {
      this.store.updateActivity(sessionId, event.data.title)
    })
  }

  /**
   * Find the copilot CLI executable path.
   */
  findCliPath(): string | undefined {
    try {
      const which = process.platform === 'win32' ? 'where.exe copilot' : 'which copilot'
      const result = execSync(which, { encoding: 'utf-8', timeout: 5000 }).trim()
      const firstLine = result.split(/\r?\n/)[0]
      if (firstLine && existsSync(firstLine)) {
        return firstLine
      }
    } catch { /* */ }

    const candidates = [
      path.join(__dirname, '..', '..', 'node_modules', '@github', 'copilot', 'index.js'),
      path.join(process.cwd(), 'node_modules', '@github', 'copilot', 'index.js'),
    ]
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate
    }

    return undefined
  }
}
