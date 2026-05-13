import { EventEmitter } from 'events'
import { spawn, ChildProcess, execFile } from 'child_process'
import { REMOTE_PORTS } from '@shared/constants'

interface DevTunnelConnection {
  tunnelId: string
  process: ChildProcess
  localPorts: Map<number, number> // remote port → local port
  status: 'connecting' | 'connected' | 'disconnected' | 'error'
  error?: string
  /** Whether this tunnel should auto-reconnect on unexpected exit */
  autoReconnect: boolean
  /** Current backoff delay for reconnection attempts */
  reconnectDelay: number
  /** Number of consecutive reconnection attempts */
  reconnectAttempts: number
  /** Timer for scheduled reconnection */
  reconnectTimer?: ReturnType<typeof setTimeout>
  /** Last successful port mappings (used during reconnect) */
  lastPorts?: DevTunnelPorts
}

export interface DevTunnelPorts {
  sshPort?: number      // local port mapped to remote:22
  acpPort?: number      // local port mapped to remote:7333
  allPorts: Map<number, number>  // remote → local
}

// Reconnection constants
const RECONNECT_BASE_DELAY = 2000     // 2s initial
const RECONNECT_MAX_DELAY = 60000     // 60s max
const RECONNECT_MAX_ATTEMPTS = 20     // give up after 20 tries (~10 min total)
const TOKEN_REFRESH_TIMEOUT = 25000   // 25s for silent GitHub refresh (cached creds); hangs longer means browser interaction is required

/**
 * Manages `devtunnel connect` child processes for authenticated tunnel access.
 *
 * Dev tunnels require the same identity on both sides. Since Tangent users
 * are Copilot users, we standardize on GitHub auth (`devtunnel user login -g`).
 *
 * `devtunnel connect <tunnelId>` maps remote ports to local ports:
 *   Remote port 22 → localhost:<assigned-port>   (SSH, optional)
 *   Remote port 7333 → localhost:<assigned-port> (ACP direct)
 *
 * Primary connectivity is via the direct ACP port. SSH is available for
 * optional workspace sync (rsync) but not required for agent execution.
 *
 * AUTO-RECONNECT: When a tunnel process exits unexpectedly, the manager
 * automatically re-authenticates (if token expired) and reconnects with
 * exponential backoff. This handles:
 *   - Token expiry (silent failure after hours of idle)
 *   - Host-side drops (Dev Box sleep/restart kills `devtunnel host`)
 *   - Network interruptions (Wi-Fi drops, VPN reconnects)
 */
export class DevTunnelManager extends EventEmitter {
  private connections = new Map<string, DevTunnelConnection>()
  private disposed = false

  /**
   * Connect to a dev tunnel by ID. Spawns `devtunnel connect` and parses
   * all local port mappings from its output.
   *
   * @returns Promise resolving to all port mappings (SSH and ACP)
   */
  async connect(tunnelId: string): Promise<DevTunnelPorts> {
    if (this.disposed) throw new Error('DevTunnelManager is disposed')

    const existing = this.connections.get(tunnelId)
    if (existing?.status === 'connected' && existing.localPorts.size > 0) {
      return {
        sshPort: existing.localPorts.get(22),
        acpPort: existing.localPorts.get(REMOTE_PORTS.ACP_REMOTE),
        allPorts: new Map(existing.localPorts)
      }
    }

    try {
      return await this._attemptConnect(tunnelId)
    } catch (err) {
      // If the failure looks like an expired/missing auth token, refresh once and retry.
      // This prevents users from having to manually run `devtunnel user login -g` before
      // launching a remote agent for the first time of the day.
      const conn = this.connections.get(tunnelId)
      const msg = err instanceof Error ? err.message : String(err)
      const looksLikeAuth =
        conn?.error === 'token_expired' ||
        /login token expired|token.*expired|github login required|login required|not logged in|unauthorized|please.*log[\s-]?in/i.test(msg)

      if (!looksLikeAuth) throw err

      console.log('[Tangent] DevTunnel: initial connect failed due to expired/missing token — refreshing and retrying')
      // Clean up the failed connection so the retry starts fresh
      this.connections.delete(tunnelId)

      try {
        await this._refreshToken()
      } catch (refreshErr) {
        const rMsg = refreshErr instanceof Error ? refreshErr.message : String(refreshErr)
        // Signal to UI that the user needs to sign in manually
        this.emit('auth:required', {
          tunnelId,
          reason: rMsg,
          message: 'Dev tunnel sign-in required. Click "Sign in" to open GitHub authentication.'
        })
        throw new Error(
          `DevTunnel sign-in required: ${rMsg}. ` +
          `Click the "Sign in to dev tunnels" banner in Tangent, or run 'devtunnel user login -g' manually.`
        )
      }

      return await this._attemptConnect(tunnelId)
    }
  }

  /**
   * Quickly check whether the user is signed in to devtunnels.
   * Runs `devtunnel user show` with a short timeout. Returns structured
   * info that the UI can use for preflight diagnostics.
   */
  async checkAuth(timeoutMs = 5000): Promise<{ signedIn: boolean; identity?: string; message?: string }> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      let settled = false
      const finish = (r: { signedIn: boolean; identity?: string; message?: string }) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        resolve(r)
      }
      const child = execFile('devtunnel', ['user', 'show'], { windowsHide: true }, (err, stdout, stderr) => {
        const combined = `${stdout ?? ''}\n${stderr ?? ''}`.trim()
        if (err) {
          if (/not.*log.*in|login required|not authenticated|unauthorized/i.test(combined)) {
            finish({ signedIn: false, message: 'Not signed in to dev tunnels.' })
          } else {
            finish({ signedIn: false, message: combined || err.message })
          }
          return
        }
        const match = combined.match(/Logged in as\s+(\S+)/i)
        finish({ signedIn: true, identity: match?.[1], message: combined })
      })
      timer = setTimeout(() => {
        try { child?.kill() } catch { /* ignore */ }
        finish({ signedIn: false, message: 'Timed out checking devtunnel sign-in status.' })
      }, timeoutMs)
    })
  }

  /**
   * Run `devtunnel user login -g` as a user-facing sign-in. Unlike the
   * internal silent `_refreshToken`, this uses a long timeout because it
   * expects the user to complete browser-based OAuth.
   *
   * Emits `auth:signin-started` and `auth:signin-complete` / `auth:signin-failed`.
   */
  async signIn(timeoutMs = 300_000): Promise<{ ok: boolean; message: string }> {
    this.emit('auth:signin-started', {})
    console.log('[Tangent] DevTunnel: launching interactive sign-in (`devtunnel user login -g`)...')
    return new Promise((resolve) => {
      const child = spawn('devtunnel', ['user', 'login', '-g'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
      let stdout = ''
      let stderr = ''
      child.stdout?.on('data', (d: Buffer) => {
        const t = d.toString()
        stdout += t
        console.log(`[Tangent] DevTunnel signIn stdout: ${t.trim()}`)
      })
      child.stderr?.on('data', (d: Buffer) => {
        const t = d.toString()
        stderr += t
        console.warn(`[Tangent] DevTunnel signIn stderr: ${t.trim()}`)
      })
      const timeout = setTimeout(() => {
        try { child.kill() } catch { /* ignore */ }
        const msg = 'Sign-in timed out. Please try again.'
        this.emit('auth:signin-failed', { message: msg })
        resolve({ ok: false, message: msg })
      }, timeoutMs)
      child.on('close', (code) => {
        clearTimeout(timeout)
        if (code === 0) {
          const msg = stdout.trim() || 'Signed in to dev tunnels.'
          this.emit('auth:signin-complete', { message: msg })
          resolve({ ok: true, message: msg })
        } else {
          const msg = (stderr || stdout).trim() || `devtunnel exited with code ${code}`
          this.emit('auth:signin-failed', { message: msg })
          resolve({ ok: false, message: msg })
        }
      })
      child.on('error', (err) => {
        clearTimeout(timeout)
        const msg = `Failed to launch devtunnel: ${err.message}`
        this.emit('auth:signin-failed', { message: msg })
        resolve({ ok: false, message: msg })
      })
    })
  }

  /**
   * Single attempt to spawn `devtunnel connect` and wait for port forwarding.
   * The outer `connect()` wraps this with one-shot token-refresh retry logic.
   */
  private _attemptConnect(tunnelId: string): Promise<DevTunnelPorts> {
    return new Promise<DevTunnelPorts>((resolve, reject) => {
      const timeoutMs = 30000
      let resolved = false

      console.log(`[Tangent] DevTunnel: connecting to ${tunnelId}...`)

      const proc = spawn('devtunnel', ['connect', tunnelId], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })

      // Inherit reconnect state from previous connection (if reconnecting)
      const prev = this.connections.get(tunnelId)
      const conn: DevTunnelConnection = {
        tunnelId,
        process: proc,
        localPorts: new Map(),
        status: 'connecting',
        autoReconnect: prev?.autoReconnect ?? true,
        reconnectDelay: prev?.reconnectDelay ?? RECONNECT_BASE_DELAY,
        reconnectAttempts: prev?.reconnectAttempts ?? 0
      }
      this.connections.set(tunnelId, conn)

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true
          conn.status = 'error'
          conn.error = 'Connection timeout'
          proc.kill()
          reject(new Error(`DevTunnel connect timeout for ${tunnelId} (${timeoutMs}ms)`))
        }
      }, timeoutMs)

      let outputBuffer = ''
      const portsNeeded = new Set([22, REMOTE_PORTS.ACP_REMOTE])
      const portsFound = new Set<number>()

      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString()
        outputBuffer += text
        console.log(`[Tangent] DevTunnel stdout: ${text.trim()}`)

        // Parse all port mappings from output
        // Actual devtunnel connect output format:
        // "SSH: Forwarding from 127.0.0.1:22 to host port 22."
        // "SSH: Forwarding from 127.0.0.1:7333 to host port 7333."
        const forwardingRegex = /Forwarding from [\d.:[\]]+:(\d+) to host port (\d+)/gi
        let fwdMatch
        while ((fwdMatch = forwardingRegex.exec(text)) !== null) {
          const localPort = parseInt(fwdMatch[1], 10)
          const remotePort = parseInt(fwdMatch[2], 10)
          if (portsNeeded.has(remotePort)) {
            conn.localPorts.set(remotePort, localPort)
            portsFound.add(remotePort)
            console.log(`[Tangent] DevTunnel: port ${remotePort} → localhost:${localPort}`)
          }
        }

        // Fallback: "port REMOTE ... localhost:LOCAL" or table format
        if (portsFound.size === 0) {
          const fallbackRegex = /port\s+(\d+)\s+.*?localhost:(\d+)/gi
          let fbMatch
          while ((fbMatch = fallbackRegex.exec(text)) !== null) {
            const remotePort = parseInt(fbMatch[1], 10)
            const localPort = parseInt(fbMatch[2], 10)
            if (portsNeeded.has(remotePort)) {
              conn.localPorts.set(remotePort, localPort)
              portsFound.add(remotePort)
              console.log(`[Tangent] DevTunnel: port ${remotePort} → localhost:${localPort}`)
            }
          }
        }

        // If we have at least the ACP port, we're good to resolve
        if (!resolved && conn.localPorts.has(REMOTE_PORTS.ACP_REMOTE)) {
          conn.status = 'connected'
          // Reset reconnect counters on successful connection
          conn.reconnectAttempts = 0
          conn.reconnectDelay = RECONNECT_BASE_DELAY
          resolved = true
          clearTimeout(timeout)
          const result: DevTunnelPorts = {
            sshPort: conn.localPorts.get(22),
            acpPort: conn.localPorts.get(REMOTE_PORTS.ACP_REMOTE),
            allPorts: new Map(conn.localPorts)
          }
          conn.lastPorts = result
          console.log(`[Tangent] DevTunnel: Connected with ${conn.localPorts.size} port(s)`)
          this.emit('tunnel:connected', { tunnelId, ports: result })
          resolve(result)
        }
      })

      proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString()
        console.warn(`[Tangent] DevTunnel stderr: ${text.trim()}`)

        // Detect token expiry / missing auth — triggers re-auth on reconnect
        if (text.match(/login token expired|token.*expired|github login required|login required|not logged in|unauthorized/i)) {
          conn.error = 'token_expired'
        }

        if (text.match(/not found|error|failed|unauthorized|expired|login required/i) && !resolved) {
          resolved = true
          clearTimeout(timeout)
          conn.status = 'error'
          conn.error = conn.error || text.trim()
          proc.kill()
          reject(new Error(`DevTunnel error: ${text.trim()}`))
        }
      })

      proc.on('close', (code) => {
        console.log(`[Tangent] DevTunnel process exited with code ${code}`)

        // If the tunnel was connected and exited unexpectedly, try auto-reconnect
        const wasConnected = conn.status === 'connected'
        const shouldReconnect = wasConnected && conn.autoReconnect && !this.disposed

        conn.status = 'disconnected'
        this.emit('tunnel:disconnected', { tunnelId, willReconnect: shouldReconnect })

        if (shouldReconnect) {
          this._scheduleReconnect(conn)
        } else {
          this.connections.delete(tunnelId)
        }

        if (!resolved) {
          resolved = true
          clearTimeout(timeout)
          reject(new Error(`DevTunnel process exited with code ${code}. Output: ${outputBuffer.slice(0, 500)}`))
        }
      })

      proc.on('error', (err) => {
        console.warn(`[Tangent] DevTunnel spawn error:`, err.message)
        if (!resolved) {
          resolved = true
          clearTimeout(timeout)
          conn.status = 'error'
          conn.error = err.message
          reject(new Error(`Failed to spawn devtunnel: ${err.message}. Is devtunnel CLI installed?`))
        }
      })
    })
  }

  /**
   * Disconnect a tunnel by killing the `devtunnel connect` process.
   * Explicit disconnect disables auto-reconnect.
   */
  disconnect(tunnelId: string): void {
    const conn = this.connections.get(tunnelId)
    if (!conn) return

    // Disable auto-reconnect on explicit disconnect
    conn.autoReconnect = false
    if (conn.reconnectTimer) {
      clearTimeout(conn.reconnectTimer)
      conn.reconnectTimer = undefined
    }

    try {
      conn.process.kill()
    } catch {
      // Already dead
    }
    conn.status = 'disconnected'
    this.connections.delete(tunnelId)
    this.emit('tunnel:disconnected', { tunnelId, willReconnect: false })
    console.log(`[Tangent] DevTunnel: disconnected ${tunnelId}`)
  }

  /**
   * Get the local SSH port for a connected tunnel.
   */
  getLocalSshPort(tunnelId: string): number | undefined {
    return this.connections.get(tunnelId)?.localPorts.get(22)
  }

  /**
   * Get the local ACP port for a connected tunnel.
   */
  getLocalAcpPort(tunnelId: string): number | undefined {
    return this.connections.get(tunnelId)?.localPorts.get(REMOTE_PORTS.ACP_REMOTE)
  }

  /**
   * Check if devtunnel CLI is available and logged in with GitHub.
   */
  static async checkPrerequisites(): Promise<{ available: boolean; loggedIn: boolean; isGitHub: boolean; error?: string }> {
    return new Promise((resolve) => {
      const proc = spawn('devtunnel', ['user', 'show'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })

      let output = ''
      proc.stdout?.on('data', (d: Buffer) => { output += d.toString() })
      proc.stderr?.on('data', (d: Buffer) => { output += d.toString() })

      proc.on('close', (code) => {
        if (code !== 0) {
          resolve({ available: true, loggedIn: false, isGitHub: false, error: output.trim() })
        } else {
          const isGitHub = /github/i.test(output)
          resolve({ available: true, loggedIn: true, isGitHub })
        }
      })

      proc.on('error', () => {
        resolve({ available: false, loggedIn: false, isGitHub: false, error: 'devtunnel CLI not found' })
      })
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const [, conn] of this.connections) {
      conn.autoReconnect = false
      if (conn.reconnectTimer) {
        clearTimeout(conn.reconnectTimer)
      }
    }
    for (const [id] of this.connections) {
      this.disconnect(id)
    }
  }

  /**
   * Schedule a reconnection attempt with exponential backoff.
   */
  private _scheduleReconnect(conn: DevTunnelConnection): void {
    if (this.disposed || !conn.autoReconnect) return

    conn.reconnectAttempts++
    if (conn.reconnectAttempts > RECONNECT_MAX_ATTEMPTS) {
      console.warn(
        `[Tangent] DevTunnel: giving up on ${conn.tunnelId} after ${RECONNECT_MAX_ATTEMPTS} attempts`
      )
      conn.autoReconnect = false
      this.connections.delete(conn.tunnelId)
      this.emit('tunnel:reconnect-failed', {
        tunnelId: conn.tunnelId,
        attempts: conn.reconnectAttempts,
        reason: 'max_attempts_exceeded'
      })
      return
    }

    const delay = conn.reconnectDelay
    conn.reconnectDelay = Math.min(conn.reconnectDelay * 2, RECONNECT_MAX_DELAY)

    console.log(
      `[Tangent] DevTunnel: reconnecting ${conn.tunnelId} in ${delay}ms ` +
      `(attempt ${conn.reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS})`
    )

    this.emit('tunnel:reconnecting', {
      tunnelId: conn.tunnelId,
      attempt: conn.reconnectAttempts,
      delayMs: delay
    })

    conn.reconnectTimer = setTimeout(async () => {
      conn.reconnectTimer = undefined
      if (this.disposed || !conn.autoReconnect) return

      try {
        // If the last error was token expiry, re-authenticate first
        if (conn.error === 'token_expired') {
          console.log(`[Tangent] DevTunnel: refreshing token before reconnect...`)
          await this._refreshToken()
          conn.error = undefined
        }

        // Reconnect — this creates a new process and updates the connection
        const ports = await this.connect(conn.tunnelId)
        console.log(
          `[Tangent] DevTunnel: reconnected ${conn.tunnelId} ` +
          `(ACP→${ports.acpPort}, SSH→${ports.sshPort})`
        )
        this.emit('tunnel:reconnected', { tunnelId: conn.tunnelId, ports })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[Tangent] DevTunnel: reconnect attempt ${conn.reconnectAttempts} failed: ${msg}`)

        // Check if the error is token-related and mark for next attempt
        if (msg.match(/token.*expired|login token|unauthorized/i)) {
          conn.error = 'token_expired'
        }

        // If connection object still exists (connect() may have replaced it), schedule next attempt
        const current = this.connections.get(conn.tunnelId)
        if (current && current.autoReconnect) {
          this._scheduleReconnect(current)
        }
      }
    }, delay)
  }

  /**
   * Re-authenticate with GitHub. Called when token expiry is detected.
   *
   * Note: this only succeeds silently when refresh creds are still cached.
   * If the user has fully logged out / never logged in, `devtunnel user login -g`
   * will open a browser and wait for interaction, and we'll hit the timeout below.
   * The caller should surface a clear "please sign in" error to the user in that case.
   */
  private async _refreshToken(): Promise<void> {
    console.log('[Tangent] DevTunnel: attempting silent token refresh via `devtunnel user login -g`...')
    return new Promise<void>((resolve, reject) => {
      const child = execFile('devtunnel', ['user', 'login', '-g'], { windowsHide: true }, (err, stdout, stderr) => {
        clearTimeout(timeout)
        if (err) {
          console.warn(`[Tangent] DevTunnel: token refresh failed: ${stderr || err.message}`)
          reject(new Error(`Token refresh failed: ${stderr || err.message}`))
        } else {
          console.log(`[Tangent] DevTunnel: token refreshed — ${stdout.trim()}`)
          resolve()
        }
      })

      const timeout = setTimeout(() => {
        // Kill the stuck login process so it doesn't linger
        try { child.kill() } catch { /* ignore */ }
        reject(new Error(
          'Token refresh timed out — browser sign-in likely required. ' +
          'Open a terminal and run `devtunnel user login -g` to sign in, then retry.'
        ))
      }, TOKEN_REFRESH_TIMEOUT)
    })
  }
}
