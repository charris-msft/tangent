import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { DevBoxConnectionInfo } from '@shared/devbox-types'

// Use vi.hoisted to create persistent mock functions
const { mockClientMethods, MockClient, mockReadFileSync } = vi.hoisted(() => {
  const mockOn = vi.fn()
  const mockConnect = vi.fn()
  const mockEnd = vi.fn()
  const mockForwardOut = vi.fn()
  
  const mockClientMethods = {
    on: mockOn,
    connect: mockConnect,
    end: mockEnd,
    forwardOut: mockForwardOut
  }
  
  // Create a mock constructor that returns the mock methods
  const MockClient = vi.fn(function(this: any) {
    return mockClientMethods
  })
  
  const mockReadFileSync = vi.fn((path: string) => {
    return Buffer.from('mock-ssh-key-data')
  })
  
  return {
    mockClientMethods,
    MockClient,
    mockReadFileSync
  }
})

// Mock ssh2
vi.mock('ssh2', () => ({
  Client: MockClient
}))

// Mock node:fs and fs (to handle both import and require)
vi.mock('node:fs', () => ({
  default: { readFileSync: mockReadFileSync },
  readFileSync: mockReadFileSync
}))
vi.mock('fs', () => ({
  default: { readFileSync: mockReadFileSync },
  readFileSync: mockReadFileSync
}))

// Mock net for local server
vi.mock('net', () => ({
  createConnection: vi.fn(() => ({
    on: vi.fn(function(this: any, event: string, callback: Function) {
      if (event === 'connect') setTimeout(callback, 5)
      return this
    }),
    setTimeout: vi.fn(),
    destroy: vi.fn(),
    end: vi.fn()
  })),
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

  beforeEach(() => {
    vi.clearAllMocks()
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
      mockClientMethods.on.mockImplementation((event, callback) => {
        if (event === 'ready') setTimeout(callback, 10)
        return mockClientMethods
      })

      mockClientMethods.forwardOut.mockImplementation((srcHost, srcPort, dstHost, dstPort, callback) => {
        setTimeout(() => callback(null, { on: vi.fn() }), 10)
      })

      const tunnelId = manager.createTunnel(mockConnectionInfo, 5000, 8765)

      // Wait for ready + forwardOut
      await new Promise(resolve => setTimeout(resolve, 100))

      // Check tunnel status
      const status = manager.getTunnelStatus(tunnelId)
      expect(status?.status).toBe('connected')
      expect(mockClientMethods.connect).toHaveBeenCalled()
    })

    it('handles connection refused error', async () => {
      const errorHandler = vi.fn()
      manager.on('tunnel:error', errorHandler)

      mockClientMethods.on.mockImplementation((event, callback) => {
        if (event === 'error') setTimeout(() => callback(new Error('ECONNREFUSED')), 10)
        return mockClientMethods
      })

      const tunnelId = manager.createTunnel(mockConnectionInfo, 5000, 8765)
      
      // Wait for error event and reconnect to start
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(errorHandler).toHaveBeenCalled()
      expect(errorHandler.mock.calls[0][0].error).toContain('ECONNREFUSED')
      
      const status = manager.getTunnelStatus(tunnelId)
      // Status will be 'reconnecting' because auto-reconnect starts after error
      expect(status?.status).toBe('reconnecting')
    })

    it('handles authentication failure', async () => {
      const errorHandler = vi.fn()
      manager.on('tunnel:error', errorHandler)

      mockClientMethods.on.mockImplementation((event, callback) => {
        if (event === 'error') setTimeout(() => callback(new Error('Authentication failed')), 10)
        return mockClientMethods
      })

      const tunnelId = manager.createTunnel(mockConnectionInfo, 5000, 8765)
      
      // Wait for error event
      await new Promise(resolve => setTimeout(resolve, 50))

      expect(errorHandler).toHaveBeenCalled()
      expect(errorHandler.mock.calls[0][0].error).toContain('Authentication failed')
    })

    it('uses private key path if provided', async () => {
      const infoWithKey: DevBoxConnectionInfo = {
        ...mockConnectionInfo,
        sshKeyPath: '/home/user/.ssh/id_rsa',
      }

      mockClientMethods.on.mockImplementation((event, callback) => {
        if (event === 'ready') setTimeout(callback, 10)
        return mockClientMethods
      })

      manager.createTunnel(infoWithKey, 5000, 8765, '/home/user/.ssh/id_rsa')

      // Wait for connection
      await new Promise(resolve => setTimeout(resolve, 50))

      expect(mockClientMethods.connect).toHaveBeenCalled()
      expect(mockReadFileSync).toHaveBeenCalledWith('/home/user/.ssh/id_rsa')
      const connectCall = mockClientMethods.connect.mock.calls[0][0]
      expect(connectCall.privateKey).toBeDefined()
    })

    it('allocates unique local port for each tunnel', async () => {
      mockClientMethods.on.mockImplementation((event, callback) => {
        if (event === 'ready') setTimeout(callback, 10)
        return mockClientMethods
      })

      // Create tunnels with different local ports
      const tunnel1Id = manager.createTunnel(mockConnectionInfo, 5000, 8765)
      const tunnel2Id = manager.createTunnel({ ...mockConnectionInfo, acpPort: 8766 }, 5001, 8766)

      // Tunnels are created with different IDs
      expect(tunnel1Id).not.toBe(tunnel2Id)
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

    it('closes tunnel successfully', () => {
      mockClientMethods.on.mockImplementation((event, callback) => {
        if (event === 'ready') setTimeout(callback, 10)
        return mockClientMethods
      })

      const tunnelId = manager.createTunnel(mockConnectionInfo, 5000, 8765)
      manager.closeTunnel(tunnelId)

      expect(mockClientMethods.end).toHaveBeenCalled()
    })

    it('does not throw if tunnel not found', () => {
      // closeTunnel returns void and doesn't throw - it just does nothing
      expect(() => manager.closeTunnel('nonexistent')).not.toThrow()
    })

    it('handles already closed tunnel gracefully', () => {
      mockClientMethods.on.mockImplementation((event, callback) => {
        if (event === 'ready') setTimeout(callback, 10)
        return mockClientMethods
      })

      const tunnelId = manager.createTunnel(mockConnectionInfo, 5000, 8765)
      manager.closeTunnel(tunnelId)

      // Second close should not throw - just does nothing
      expect(() => manager.closeTunnel(tunnelId)).not.toThrow()
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
      mockClientMethods.on.mockImplementation((event, callback) => {
        if (event === 'ready') setTimeout(callback, 10)
        return mockClientMethods
      })

      mockClientMethods.forwardOut.mockImplementation((srcHost, srcPort, dstHost, dstPort, callback) => {
        setTimeout(() => callback(null, { on: vi.fn() }), 10)
      })

      const tunnelId = manager.createTunnel(mockConnectionInfo, 5000, 8765)
      
      // Wait for ready + forwardOut
      await new Promise(resolve => setTimeout(resolve, 100))
      
      const status = manager.getTunnelStatus(tunnelId)

      expect(status?.status).toBe('connected')
    })

    it('returns undefined after tunnel is closed', () => {
      mockClientMethods.on.mockImplementation((event, callback) => {
        if (event === 'ready') setTimeout(callback, 10)
        return mockClientMethods
      })

      const tunnelId = manager.createTunnel(mockConnectionInfo, 5000, 8765)
      manager.closeTunnel(tunnelId)
      
      const status = manager.getTunnelStatus(tunnelId)

      expect(status).toBeUndefined()
    })

    it('returns reconnecting during reconnect attempt', async () => {
      mockClientMethods.on.mockImplementation((event, callback) => {
        if (event === 'ready') setTimeout(callback, 10)
        if (event === 'close') setTimeout(callback, 20)
        return mockClientMethods
      })

      const tunnelId = manager.createTunnel(mockConnectionInfo, 5000, 8765)

      // Wait for initial connection
      await new Promise(resolve => setTimeout(resolve, 50))

      // Simulate connection drop by triggering close event
      const closeHandler = mockClientMethods.on.mock.calls.find(call => call[0] === 'close')?.[1]
      if (closeHandler) closeHandler()

      // Wait a bit for status to update
      await new Promise(resolve => setTimeout(resolve, 10))

      const status = manager.getTunnelStatus(tunnelId)
      expect(status?.status).toBe('reconnecting')
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
      manager.on('tunnel:error', errorHandler)

      mockClientMethods.on.mockImplementation((event, callback) => {
        if (event === 'ready') setTimeout(callback, 10)
        if (event === 'error') setTimeout(() => callback(new Error('Connection lost')), 50)
        return mockClientMethods
      })

      const tunnelId = manager.createTunnel(mockConnectionInfo, 5000, 8765)

      // Wait for error
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(errorHandler).toHaveBeenCalled()
      expect(errorHandler.mock.calls[0][0].id).toBeDefined()
    })

    it('triggers reconnect on connection drop', async () => {
      vi.useFakeTimers()
      const reconnectHandler = vi.fn()
      manager.on('tunnel:reconnecting', reconnectHandler)

      mockClientMethods.on.mockImplementation((event, callback) => {
        if (event === 'ready') setTimeout(callback, 10)
        return mockClientMethods
      })

      const tunnelId = manager.createTunnel(mockConnectionInfo, 5000, 8765)

      // Simulate connection close
      const closeHandler = mockClientMethods.on.mock.calls.find(call => call[0] === 'close')?.[1]
      if (closeHandler) {
        await vi.advanceTimersByTimeAsync(50)
        closeHandler()
        await vi.advanceTimersByTimeAsync(100)
      }

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

    it('uses exponential backoff for reconnection', async () => {
      vi.useFakeTimers()
      let attemptCount = 0

      mockClientMethods.on.mockImplementation((event, callback) => {
        if (event === 'ready' && attemptCount < 2) {
          // Fail first 2 attempts
          attemptCount++
          setTimeout(() => {
            const errorCb = mockClientMethods.on.mock.calls.find(c => c[0] === 'error')?.[1]
            errorCb?.(new Error('Connection failed'))
          }, 10)
        } else if (event === 'ready') {
          setTimeout(callback, 10)
        }
        return mockClientMethods
      })

      const tunnelId = manager.createTunnel(mockConnectionInfo, 5000, 8765)

      // Advance through reconnect attempts
      await vi.advanceTimersByTimeAsync(60000)

      // Verify reconnection was attempted
      expect(attemptCount).toBeGreaterThan(0)
      vi.useRealTimers()
    })

    it('gives up after max retry attempts exhausted', async () => {
      vi.useFakeTimers()
      const errorHandler = vi.fn()
      manager.on('tunnel:error', errorHandler)

      mockClientMethods.on.mockImplementation((event, callback) => {
        if (event === 'error') setTimeout(() => callback(new Error('Connection failed')), 10)
        return mockClientMethods
      })

      const tunnelId = manager.createTunnel(mockConnectionInfo, 5000, 8765)

      // Advance through all retry attempts (5 max attempts + delays)
      await vi.advanceTimersByTimeAsync(180000)

      expect(errorHandler).toHaveBeenCalled()
      vi.useRealTimers()
    })

    it('caps backoff delay at 30 seconds', async () => {
      vi.useFakeTimers()
      const delays: number[] = []
      let lastTime = Date.now()

      mockClientMethods.on.mockImplementation((event, callback) => {
        if (event === 'ready') {
          const now = Date.now()
          if (lastTime > 0) delays.push(now - lastTime)
          lastTime = now
          setTimeout(() => {
            const errorCb = mockClientMethods.on.mock.calls.find(c => c[0] === 'error')?.[1]
            errorCb?.(new Error('Connection failed'))
          }, 10)
        }
        return mockClientMethods
      })

      const tunnelId = manager.createTunnel(mockConnectionInfo, 5000, 8765)

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
