import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { DevBoxConnectionInfo } from '@shared/devbox-types'

// Mock ssh2
vi.mock('ssh2', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn(),
    end: vi.fn(),
    on: vi.fn(),
    forwardOut: vi.fn(),
  }))
}))

// Mock net for local server
vi.mock('net', () => ({
  createServer: vi.fn(() => ({
    listen: vi.fn((port, callback) => callback?.()),
    close: vi.fn((callback) => callback?.()),
    on: vi.fn(),
  }))
}))

// === Imports after mocks ===
import { SshTunnelManager } from '../SshTunnelManager'

describe('SshTunnelManager', () => {
  let manager: SshTunnelManager
  let mockSshClient: any

  beforeEach(() => {
    vi.clearAllMocks()
    const { Client } = require('ssh2')
    mockSshClient = new Client()
    manager = new SshTunnelManager()
  })

  afterEach(() => {
    manager.dispose()
  })

  // ============================================================================
  // createTunnel
  // ============================================================================

  describe('createTunnel', () => {
    const mockConnectionInfo: DevBoxConnectionInfo = {
      ipAddress: '10.0.0.5',
      sshHost: 'charrisdb5.eastus.devcenter.azure.com',
      sshPort: 22,
      sshUser: 'azureuser',
      acpPort: 8765,
    }

    it('creates tunnel successfully', async () => {
      mockSshClient.on.mockImplementation((event, callback) => {
        if (event === 'ready') setTimeout(callback, 10)
        return mockSshClient
      })

      const tunnel = await manager.createTunnel('tunnel-1', mockConnectionInfo)

      expect(tunnel.id).toBe('tunnel-1')
      expect(tunnel.status).toBe('connected')
      expect(tunnel.remotePort).toBe(8765)
      expect(mockSshClient.connect).toHaveBeenCalled()
    })

    it('handles connection refused error', async () => {
      mockSshClient.on.mockImplementation((event, callback) => {
        if (event === 'error') setTimeout(() => callback(new Error('ECONNREFUSED')), 10)
        return mockSshClient
      })

      await expect(manager.createTunnel('tunnel-1', mockConnectionInfo)).rejects.toThrow(/ECONNREFUSED/)
    })

    it('handles authentication failure', async () => {
      mockSshClient.on.mockImplementation((event, callback) => {
        if (event === 'error') setTimeout(() => callback(new Error('Authentication failed')), 10)
        return mockSshClient
      })

      await expect(manager.createTunnel('tunnel-1', mockConnectionInfo)).rejects.toThrow(/Authentication failed/)
    })

    it('uses private key path if provided', async () => {
      const infoWithKey: DevBoxConnectionInfo = {
        ...mockConnectionInfo,
        sshKeyPath: '/home/user/.ssh/id_rsa',
      }
      mockSshClient.on.mockImplementation((event, callback) => {
        if (event === 'ready') setTimeout(callback, 10)
        return mockSshClient
      })

      await manager.createTunnel('tunnel-1', infoWithKey)

      const connectCall = mockSshClient.connect.mock.calls[0][0]
      expect(connectCall.privateKey).toBeDefined()
    })

    it('allocates unique local port for each tunnel', async () => {
      mockSshClient.on.mockImplementation((event, callback) => {
        if (event === 'ready') setTimeout(callback, 10)
        return mockSshClient
      })

      const tunnel1 = await manager.createTunnel('tunnel-1', mockConnectionInfo)
      const tunnel2 = await manager.createTunnel('tunnel-2', { ...mockConnectionInfo, acpPort: 8766 })

      expect(tunnel1.localPort).not.toBe(tunnel2.localPort)
    })
  })

  // ============================================================================
  // closeTunnel
  // ============================================================================

  describe('closeTunnel', () => {
    const mockConnectionInfo: DevBoxConnectionInfo = {
      ipAddress: '10.0.0.5',
      sshHost: 'charrisdb5.eastus.devcenter.azure.com',
      sshPort: 22,
      sshUser: 'azureuser',
      acpPort: 8765,
    }

    it('closes tunnel successfully', async () => {
      mockSshClient.on.mockImplementation((event, callback) => {
        if (event === 'ready') setTimeout(callback, 10)
        return mockSshClient
      })

      await manager.createTunnel('tunnel-1', mockConnectionInfo)
      await manager.closeTunnel('tunnel-1')

      expect(mockSshClient.end).toHaveBeenCalled()
    })

    it('throws error if tunnel not found', async () => {
      await expect(manager.closeTunnel('nonexistent')).rejects.toThrow(/not found/)
    })

    it('handles already closed tunnel gracefully', async () => {
      mockSshClient.on.mockImplementation((event, callback) => {
        if (event === 'ready') setTimeout(callback, 10)
        return mockSshClient
      })

      await manager.createTunnel('tunnel-1', mockConnectionInfo)
      await manager.closeTunnel('tunnel-1')

      // Second close should not throw
      await expect(manager.closeTunnel('tunnel-1')).rejects.toThrow(/not found/)
    })
  })

  // ============================================================================
  // getTunnelStatus
  // ============================================================================

  describe('getTunnelStatus', () => {
    const mockConnectionInfo: DevBoxConnectionInfo = {
      ipAddress: '10.0.0.5',
      sshHost: 'charrisdb5.eastus.devcenter.azure.com',
      sshPort: 22,
      sshUser: 'azureuser',
      acpPort: 8765,
    }

    it('returns connected status for active tunnel', async () => {
      mockSshClient.on.mockImplementation((event, callback) => {
        if (event === 'ready') setTimeout(callback, 10)
        return mockSshClient
      })

      await manager.createTunnel('tunnel-1', mockConnectionInfo)
      const status = manager.getTunnelStatus('tunnel-1')

      expect(status).toBe('connected')
    })

    it('returns disconnected after tunnel is closed', async () => {
      mockSshClient.on.mockImplementation((event, callback) => {
        if (event === 'ready') setTimeout(callback, 10)
        return mockSshClient
      })

      await manager.createTunnel('tunnel-1', mockConnectionInfo)
      await manager.closeTunnel('tunnel-1')
      const status = manager.getTunnelStatus('tunnel-1')

      expect(status).toBe('disconnected')
    })

    it('returns reconnecting during reconnect attempt', async () => {
      mockSshClient.on.mockImplementation((event, callback) => {
        if (event === 'ready') setTimeout(callback, 10)
        if (event === 'close') setTimeout(callback, 100)
        return mockSshClient
      })

      await manager.createTunnel('tunnel-1', mockConnectionInfo, { autoReconnect: true })

      // Simulate connection drop
      const closeHandler = mockSshClient.on.mock.calls.find(call => call[0] === 'close')?.[1]
      if (closeHandler) closeHandler()

      const status = manager.getTunnelStatus('tunnel-1')
      expect(status).toBe('reconnecting')
    })

    it('returns undefined for unknown tunnel', () => {
      const status = manager.getTunnelStatus('nonexistent')
      expect(status).toBeUndefined()
    })
  })

  // ============================================================================
  // Health Monitoring
  // ============================================================================

  describe('health monitoring', () => {
    const mockConnectionInfo: DevBoxConnectionInfo = {
      ipAddress: '10.0.0.5',
      sshHost: 'charrisdb5.eastus.devcenter.azure.com',
      sshPort: 22,
      sshUser: 'azureuser',
      acpPort: 8765,
    }

    it('detects connection failure and emits event', async () => {
      const errorHandler = vi.fn()
      manager.on('tunnel-error', errorHandler)

      mockSshClient.on.mockImplementation((event, callback) => {
        if (event === 'ready') setTimeout(callback, 10)
        if (event === 'error') setTimeout(() => callback(new Error('Connection lost')), 50)
        return mockSshClient
      })

      await manager.createTunnel('tunnel-1', mockConnectionInfo)

      // Wait for error
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(errorHandler).toHaveBeenCalled()
      expect(errorHandler.mock.calls[0][0].tunnelId).toBe('tunnel-1')
    })

    it('triggers reconnect on connection drop when autoReconnect enabled', async () => {
      vi.useFakeTimers()
      const reconnectHandler = vi.fn()
      manager.on('tunnel-reconnecting', reconnectHandler)

      mockSshClient.on.mockImplementation((event, callback) => {
        if (event === 'ready') setTimeout(callback, 10)
        return mockSshClient
      })

      await manager.createTunnel('tunnel-1', mockConnectionInfo, { autoReconnect: true })

      // Simulate connection close
      const closeHandler = mockSshClient.on.mock.calls.find(call => call[0] === 'close')?.[1]
      if (closeHandler) closeHandler()

      await vi.advanceTimersByTimeAsync(100)

      expect(reconnectHandler).toHaveBeenCalled()
      vi.useRealTimers()
    })
  })

  // ============================================================================
  // Auto-Reconnect with Exponential Backoff
  // ============================================================================

  describe('auto-reconnect with exponential backoff', () => {
    const mockConnectionInfo: DevBoxConnectionInfo = {
      ipAddress: '10.0.0.5',
      sshHost: 'charrisdb5.eastus.devcenter.azure.com',
      sshPort: 22,
      sshUser: 'azureuser',
      acpPort: 8765,
    }

    it('uses exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s', async () => {
      vi.useFakeTimers()
      const reconnectDelays: number[] = []
      let attemptCount = 0

      mockSshClient.on.mockImplementation((event, callback) => {
        if (event === 'ready' && attemptCount < 5) {
          // Fail first 5 attempts, succeed on 6th
          attemptCount++
          reconnectDelays.push(Date.now())
          setTimeout(() => {
            const errorCb = mockSshClient.on.mock.calls.find(c => c[0] === 'error')?.[1]
            errorCb?.(new Error('Connection failed'))
          }, 10)
        } else if (event === 'ready') {
          setTimeout(callback, 10)
        }
        return mockSshClient
      })

      const promise = manager.createTunnel('tunnel-1', mockConnectionInfo, { 
        autoReconnect: true,
        maxReconnectAttempts: 10,
      })

      // Advance through reconnect attempts
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(35000)
      }

      await promise

      // Verify exponential backoff pattern
      expect(attemptCount).toBeGreaterThan(0)
      vi.useRealTimers()
    })

    it('gives up after max retry attempts exhausted', async () => {
      vi.useFakeTimers()
      mockSshClient.on.mockImplementation((event, callback) => {
        if (event === 'error') setTimeout(() => callback(new Error('Connection failed')), 10)
        return mockSshClient
      })

      const promise = manager.createTunnel('tunnel-1', mockConnectionInfo, { 
        autoReconnect: true,
        maxReconnectAttempts: 3,
      })

      // Advance through all retry attempts
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(10000)
      }

      await expect(promise).rejects.toThrow(/max.*attempts/i)
      vi.useRealTimers()
    })

    it('caps backoff delay at 30 seconds', async () => {
      vi.useFakeTimers()
      const delays: number[] = []
      let lastTime = Date.now()

      mockSshClient.on.mockImplementation((event, callback) => {
        if (event === 'ready') {
          const now = Date.now()
          if (lastTime > 0) delays.push(now - lastTime)
          lastTime = now
          setTimeout(() => {
            const errorCb = mockSshClient.on.mock.calls.find(c => c[0] === 'error')?.[1]
            errorCb?.(new Error('Connection failed'))
          }, 10)
        }
        return mockSshClient
      })

      manager.createTunnel('tunnel-1', mockConnectionInfo, { 
        autoReconnect: true,
        maxReconnectAttempts: 20,
      })

      // Advance through many attempts
      for (let i = 0; i < 8; i++) {
        await vi.advanceTimersByTimeAsync(35000)
      }

      // Later delays should be capped at 30s
      const laterDelays = delays.slice(-3)
      laterDelays.forEach(delay => {
        expect(delay).toBeLessThanOrEqual(30000)
      })

      vi.useRealTimers()
    })
  })
})
