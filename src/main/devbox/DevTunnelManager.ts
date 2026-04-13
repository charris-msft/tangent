import { EventEmitter } from 'events'
import { spawn, ChildProcess } from 'child_process'

interface DevTunnelConnection {
  tunnelId: string
  process: ChildProcess
  localPorts: Map<number, number> // remote port → local port
  status: 'connecting' | 'connected' | 'disconnected' | 'error'
  error?: string
}

/**
 * Manages `devtunnel connect` child processes for authenticated tunnel access.
 * 
 * Dev tunnels require the same identity on both sides. Since Tangent users
 * are Copilot users, we standardize on GitHub auth (`devtunnel user login -g`).
 * 
 * `devtunnel connect <tunnelId>` maps remote ports to local ports:
 *   Remote port 22 → localhost:<assigned-port>
 * 
 * After connecting, SSH to localhost:<assigned-port> instead of the tunnel hostname.
 */
export class DevTunnelManager extends EventEmitter {
  private connections = new Map<string, DevTunnelConnection>()
  private disposed = false

  /**
   * Connect to a dev tunnel by ID. Spawns `devtunnel connect` and parses
   * the local port mapping from its output.
   * 
   * @returns Promise resolving to the local port mapped to remote port 22 (SSH)
   */
  async connect(tunnelId: string): Promise<number> {
    if (this.disposed) throw new Error('DevTunnelManager is disposed')

    const existing = this.connections.get(tunnelId)
    if (existing?.status === 'connected') {
      const sshPort = existing.localPorts.get(22)
      if (sshPort) return sshPort
    }

    return new Promise<number>((resolve, reject) => {
      const timeoutMs = 30000
      let resolved = false

      console.log(`[Tangent 2] DevTunnel: connecting to ${tunnelId}...`)

      const proc = spawn('devtunnel', ['connect', tunnelId], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })

      const conn: DevTunnelConnection = {
        tunnelId,
        process: proc,
        localPorts: new Map(),
        status: 'connecting'
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

      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString()
        outputBuffer += text
        console.log(`[Tangent 2] DevTunnel stdout: ${text.trim()}`)

        // Parse port mappings from output
        // Format varies but typically: "Port 22 is available at localhost:12345"
        // or "Forwarding port 22 to localhost:12345"
        // or table format with local port assignments
        const portMatch = text.match(/(?:port\s+)?22\s+.*?localhost:(\d+)/i)
          || text.match(/localhost:(\d+)\s+.*?(?:port\s+)?22/i)
          || text.match(/(\d{4,5}).*?→.*?22/i)
          || text.match(/22\s*→\s*.*?:(\d+)/i)

        if (portMatch && !resolved) {
          const localPort = parseInt(portMatch[1], 10)
          conn.localPorts.set(22, localPort)
          conn.status = 'connected'
          resolved = true
          clearTimeout(timeout)
          console.log(`[Tangent 2] DevTunnel: SSH port 22 mapped to localhost:${localPort}`)
          this.emit('tunnel:connected', { tunnelId, localPort })
          resolve(localPort)
        }

        // Also check for "Connected" or "ready" signals without explicit port mapping
        if (!resolved && (text.match(/connected/i) || text.match(/ready/i))) {
          // If we see connected but no port mapping, the port is likely the same number
          // devtunnel typically maps remote:22 → localhost:22 if available
          if (!conn.localPorts.has(22)) {
            // Try to find any port number in the accumulated output
            const anyPort = outputBuffer.match(/localhost:(\d+)/i)
            if (anyPort) {
              const localPort = parseInt(anyPort[1], 10)
              conn.localPorts.set(22, localPort)
              conn.status = 'connected'
              resolved = true
              clearTimeout(timeout)
              console.log(`[Tangent 2] DevTunnel: SSH mapped to localhost:${localPort} (inferred)`)
              this.emit('tunnel:connected', { tunnelId, localPort })
              resolve(localPort)
            }
          }
        }
      })

      proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString()
        console.warn(`[Tangent 2] DevTunnel stderr: ${text.trim()}`)

        if (text.match(/not found|error|failed|unauthorized/i) && !resolved) {
          resolved = true
          clearTimeout(timeout)
          conn.status = 'error'
          conn.error = text.trim()
          proc.kill()
          reject(new Error(`DevTunnel error: ${text.trim()}`))
        }
      })

      proc.on('close', (code) => {
        console.log(`[Tangent 2] DevTunnel process exited with code ${code}`)
        conn.status = 'disconnected'
        this.connections.delete(tunnelId)
        this.emit('tunnel:disconnected', { tunnelId })

        if (!resolved) {
          resolved = true
          clearTimeout(timeout)
          reject(new Error(`DevTunnel process exited with code ${code}. Output: ${outputBuffer.slice(0, 500)}`))
        }
      })

      proc.on('error', (err) => {
        console.warn(`[Tangent 2] DevTunnel spawn error:`, err.message)
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
   */
  disconnect(tunnelId: string): void {
    const conn = this.connections.get(tunnelId)
    if (!conn) return

    try {
      conn.process.kill()
    } catch {
      // Already dead
    }
    conn.status = 'disconnected'
    this.connections.delete(tunnelId)
    this.emit('tunnel:disconnected', { tunnelId })
    console.log(`[Tangent 2] DevTunnel: disconnected ${tunnelId}`)
  }

  /**
   * Get the local SSH port for a connected tunnel.
   */
  getLocalSshPort(tunnelId: string): number | undefined {
    return this.connections.get(tunnelId)?.localPorts.get(22)
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
    for (const [id] of this.connections) {
      this.disconnect(id)
    }
  }
}
