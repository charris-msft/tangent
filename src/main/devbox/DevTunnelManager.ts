import { EventEmitter } from 'events'
import { spawn, ChildProcess } from 'child_process'
import { REMOTE_PORTS } from '@shared/constants'

interface DevTunnelConnection {
  tunnelId: string
  process: ChildProcess
  localPorts: Map<number, number> // remote port → local port
  status: 'connecting' | 'connected' | 'disconnected' | 'error'
  error?: string
}

export interface DevTunnelPorts {
  sshPort?: number      // local port mapped to remote:22
  acpPort?: number      // local port mapped to remote:7333
  allPorts: Map<number, number>  // remote → local
}

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

    return new Promise<DevTunnelPorts>((resolve, reject) => {
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
      const portsNeeded = new Set([22, REMOTE_PORTS.ACP_REMOTE])
      const portsFound = new Set<number>()

      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString()
        outputBuffer += text
        console.log(`[Tangent 2] DevTunnel stdout: ${text.trim()}`)

        // Parse all port mappings from output
        // Format varies but typically: "Port 22 is available at localhost:12345"
        // or "Forwarding port 22 to localhost:12345"
        // or table format with local port assignments
        // Match pattern: remote port → localhost:local port
        const portPatterns = [
          /(?:port\s+)?(\d+)\s+.*?localhost:(\d+)/gi,
          /localhost:(\d+)\s+.*?(?:port\s+)?(\d+)/gi,
          /(\d{4,5})\s*→\s*(\d+)/gi,
          /(\d+)\s*→\s*.*?:(\d+)/gi
        ]

        for (const pattern of portPatterns) {
          let match
          while ((match = pattern.exec(text)) !== null) {
            const remotePort = parseInt(match[1], 10)
            const localPort = parseInt(match[2], 10)
            
            // Check if this is a port we care about
            if (portsNeeded.has(remotePort)) {
              conn.localPorts.set(remotePort, localPort)
              portsFound.add(remotePort)
              console.log(`[Tangent 2] DevTunnel: port ${remotePort} → localhost:${localPort}`)
            }
          }
        }

        // Also try inverse pattern (local:remote)
        const inverseMatch = text.match(/localhost:(\d+)\s+.*?(?:port\s+)?(\d+)/i)
        if (inverseMatch) {
          const localPort = parseInt(inverseMatch[1], 10)
          const remotePort = parseInt(inverseMatch[2], 10)
          if (portsNeeded.has(remotePort) && !conn.localPorts.has(remotePort)) {
            conn.localPorts.set(remotePort, localPort)
            portsFound.add(remotePort)
            console.log(`[Tangent 2] DevTunnel: port ${remotePort} → localhost:${localPort}`)
          }
        }

        // If we have at least the ACP port, we're good to resolve
        if (!resolved && conn.localPorts.has(REMOTE_PORTS.ACP_REMOTE)) {
          conn.status = 'connected'
          resolved = true
          clearTimeout(timeout)
          const result: DevTunnelPorts = {
            sshPort: conn.localPorts.get(22),
            acpPort: conn.localPorts.get(REMOTE_PORTS.ACP_REMOTE),
            allPorts: new Map(conn.localPorts)
          }
          console.log(`[Tangent 2] DevTunnel: Connected with ${conn.localPorts.size} port(s)`)
          this.emit('tunnel:connected', { tunnelId, ports: result })
          resolve(result)
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
    for (const [id] of this.connections) {
      this.disconnect(id)
    }
  }
}
