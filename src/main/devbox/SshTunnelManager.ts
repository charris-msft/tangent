import { EventEmitter } from 'events'
import { readFileSync } from 'fs'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - ssh2 has no type definitions
import { Client } from 'ssh2'
import { Socket, createConnection, createServer, Server } from 'net'
import type { DevBoxConnectionInfo } from '@shared/devbox-types'

interface TunnelConfig {
  host: string
  localPort: number
  remotePort: number
  sshUser: string
  sshPort: number
  sshKeyPath?: string
}

interface TunnelState {
  id: string
  config: TunnelConfig
  client: Client
  server?: Server
  status: 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error'
  error?: string
  reconnectAttempts: number
  reconnectTimer?: NodeJS.Timeout
  healthCheckTimer?: NodeJS.Timeout
  lastHealthCheck?: number
}

const HEALTH_CHECK_INTERVAL = 30000 // 30 seconds
const BASE_RECONNECT_DELAY = 1000 // 1 second
const MAX_RECONNECT_DELAY = 30000 // 30 seconds
const MAX_RECONNECT_ATTEMPTS = 5

export class SshTunnelManager extends EventEmitter {
  private tunnels = new Map<string, TunnelState>()
  private disposed = false

  createTunnel(
    connectionInfo: DevBoxConnectionInfo,
    localPort: number,
    remotePort: number,
    sshKeyPath?: string
  ): string {
    const id = `tunnel-${Date.now()}-${Math.random().toString(36).substring(7)}`
    const config: TunnelConfig = {
      host: connectionInfo.sshHost,
      localPort,
      remotePort,
      sshUser: connectionInfo.sshUser,
      sshPort: connectionInfo.sshPort,
      sshKeyPath
    }

    const client = new Client()
    const state: TunnelState = {
      id,
      config,
      client,
      status: 'connecting',
      reconnectAttempts: 0
    }

    this.tunnels.set(id, state)
    this._connect(state)

    return id
  }

  closeTunnel(id: string): void {
    const state = this.tunnels.get(id)
    if (!state) {
      return
    }

    this._cleanup(state)
    this.tunnels.delete(id)
    this.emit('tunnel:disconnected', { id })
  }

  getTunnelStatus(id: string): {
    status: string
    error?: string
    reconnectAttempts: number
    lastHealthCheck?: number
  } | undefined {
    const state = this.tunnels.get(id)
    if (!state) {
      return undefined
    }

    return {
      status: state.status,
      error: state.error,
      reconnectAttempts: state.reconnectAttempts,
      lastHealthCheck: state.lastHealthCheck
    }
  }

  dispose(): void {
    if (this.disposed) {
      return
    }

    this.disposed = true
    for (const state of this.tunnels.values()) {
      this._cleanup(state)
    }
    this.tunnels.clear()
  }

  private _connect(state: TunnelState): void {
    if (this.disposed) {
      return
    }

    const { client, config } = state

    client.on('ready', () => {
      if (this.disposed) {
        client.end()
        return
      }

      // Create a local TCP server that forwards connections through SSH
      const server = createServer((localSocket: Socket) => {
        client.forwardOut(
          '127.0.0.1',
          config.localPort,
          '127.0.0.1',
          config.remotePort,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (err: any, stream: any) => {
            if (err) {
              console.warn('[Tangent] SSH tunnel forwardOut error:', err.message)
              localSocket.destroy()
              return
            }
            localSocket.pipe(stream).pipe(localSocket)

            stream.on('close', () => localSocket.destroy())
            localSocket.on('close', () => stream.close())
          }
        )
      })

      server.on('error', (err: any) => {
        console.warn('[Tangent] SSH tunnel local server error:', err.message)
        state.status = 'error'
        state.error = err.message
        this.emit('tunnel:error', { id: state.id, error: err.message })
        this._scheduleReconnect(state)
      })

      server.listen(config.localPort, '127.0.0.1', () => {
        state.server = server
        state.status = 'connected'
        state.error = undefined
        state.reconnectAttempts = 0
        this.emit('tunnel:connected', { id: state.id })
        this._startHealthCheck(state)
      })
    })

    client.on('error', (err: any) => {
      console.warn('[Tangent] SSH client error:', err.message)
      state.status = 'error'
      state.error = err.message
      this.emit('tunnel:error', { id: state.id, error: err.message })
      this._scheduleReconnect(state)
    })

    client.on('close', () => {
      if (!this.disposed && this.tunnels.has(state.id)) {
        state.status = 'disconnected'
        this.emit('tunnel:disconnected', { id: state.id })
        this._scheduleReconnect(state)
      }
    })

    client.connect({
      host: config.host,
      port: config.sshPort,
      username: config.sshUser,
      privateKey: config.sshKeyPath ? readFileSync(config.sshKeyPath) : undefined,
      readyTimeout: 30000
    })
  }

  private _scheduleReconnect(state: TunnelState): void {
    if (this.disposed || !this.tunnels.has(state.id)) {
      return
    }

    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer)
      state.reconnectTimer = undefined
    }

    if (state.healthCheckTimer) {
      clearInterval(state.healthCheckTimer)
      state.healthCheckTimer = undefined
    }

    // Close local server before reconnecting
    if (state.server) {
      state.server.close()
      state.server = undefined
    }

    if (state.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.warn(
        '[Tangent] SSH tunnel max reconnect attempts reached for',
        state.id
      )
      state.status = 'error'
      state.error = 'Max reconnect attempts reached'
      this.emit('tunnel:error', { id: state.id, error: state.error })
      return
    }

    state.reconnectAttempts++
    const delay = Math.min(
      BASE_RECONNECT_DELAY * Math.pow(2, state.reconnectAttempts - 1),
      MAX_RECONNECT_DELAY
    )

    state.status = 'reconnecting'
    this.emit('tunnel:reconnecting', {
      id: state.id,
      attempt: state.reconnectAttempts,
      delay
    })

    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = undefined
      if (!this.disposed && this.tunnels.has(state.id)) {
        state.client.end()
        state.client = new Client()
        this._connect(state)
      }
    }, delay)
  }

  private _startHealthCheck(state: TunnelState): void {
    if (state.healthCheckTimer) {
      clearInterval(state.healthCheckTimer)
    }

    state.healthCheckTimer = setInterval(() => {
      this._checkHealth(state)
    }, HEALTH_CHECK_INTERVAL)

    this._checkHealth(state)
  }

  private _checkHealth(state: TunnelState): void {
    if (this.disposed || !this.tunnels.has(state.id)) {
      return
    }

    const socket: Socket = createConnection(state.config.localPort, '127.0.0.1')
    let didConnect = false

    socket.setTimeout(5000)

    socket.on('connect', () => {
      didConnect = true
      state.lastHealthCheck = Date.now()
      socket.destroy()
    })

    socket.on('error', () => {
      if (!didConnect) {
        console.warn('[Tangent] SSH tunnel health check failed for', state.id)
        state.status = 'error'
        state.error = 'Health check failed'
        this.emit('tunnel:error', { id: state.id, error: state.error })
        socket.destroy()
        this._scheduleReconnect(state)
      }
    })

    socket.on('timeout', () => {
      console.warn('[Tangent] SSH tunnel health check timeout for', state.id)
      state.status = 'error'
      state.error = 'Health check timeout'
      this.emit('tunnel:error', { id: state.id, error: state.error })
      socket.destroy()
      this._scheduleReconnect(state)
    })
  }

  private _cleanup(state: TunnelState): void {
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer)
      state.reconnectTimer = undefined
    }

    if (state.healthCheckTimer) {
      clearInterval(state.healthCheckTimer)
      state.healthCheckTimer = undefined
    }

    if (state.server) {
      try {
        state.server.close()
      } catch (err) {
        // Silent fail — already cleaning up
      }
      state.server = undefined
    }

    try {
      state.client.end()
    } catch (err) {
      // Silent fail — already cleaning up
    }
  }
}
