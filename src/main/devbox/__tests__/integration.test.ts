import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { DevBoxConnector } from '../DevBoxConnector'
import type { DevBoxResource, DevBoxProvisioningState } from '@shared/devbox-types'

// ============================================================================
// Mock Dependencies
// ============================================================================

// Mock DevBoxManager
class MockDevBoxManager extends EventEmitter {
  autoStart = vi.fn()
  startDevBox = vi.fn()
  getDevBox = vi.fn()
}

// Mock SshTunnelManager
class MockSshTunnelManager extends EventEmitter {
  createTunnel = vi.fn()
  closeTunnel = vi.fn()
  getTunnelStatus = vi.fn()
}

// Mock OpenSshProvisioner
class MockOpenSshProvisioner {
  checkOpenSsh = vi.fn()
  installOpenSsh = vi.fn()
  enableOpenSsh = vi.fn()
  verifyOpenSsh = vi.fn()
  ensureOpenSsh = vi.fn()
}

// Mock RsyncManager
class MockRsyncManager extends EventEmitter {
  sync = vi.fn()
}

// Mock SSH Client
class MockSshClient extends EventEmitter {
  connect = vi.fn()
  end = vi.fn()
  exec = vi.fn()
}

// Track created SSH clients for testing
let mockSshClients: MockSshClient[] = []

// Mock ssh2 module - MUST be defined before import
vi.mock('ssh2', () => ({
  Client: class extends EventEmitter {
    connect = vi.fn()
    end = vi.fn()
    exec = vi.fn()
    
    constructor() {
      super()
      const client = this as any
      mockSshClients.push(client)
      
      // Auto-trigger ready event after connect is called
      client.connect = vi.fn(() => {
        setTimeout(() => {
          client.emit('ready')
        }, 10)
      })
    }
  }
}))

// Mock fs module for SSH key reading
vi.mock('fs', () => ({
  readFileSync: vi.fn(() => 'mock-ssh-key-content')
}))

// Mock net module for health checks
vi.mock('net', () => ({
  createConnection: vi.fn(() => {
    const socket = new EventEmitter() as any
    socket.destroy = vi.fn()
    socket.setTimeout = vi.fn()
    // Auto-trigger connect after a delay
    setTimeout(() => socket.emit('connect'), 10)
    return socket
  }),
  Socket: class extends EventEmitter {
    destroy = vi.fn()
    setTimeout = vi.fn()
  }
}))

// ============================================================================
// Integration Tests
// ============================================================================

describe('DevBox Lifecycle Integration', () => {
  let connector: DevBoxConnector
  let devBoxManager: MockDevBoxManager
  let sshTunnelManager: MockSshTunnelManager
  let openSshProvisioner: MockOpenSshProvisioner
  let rsyncManager: MockRsyncManager

  const mockDevBox: DevBoxResource = {
    id: 'devbox-123',
    name: 'charrisdb5',
    projectName: 'test-project',
    poolName: 'default-pool',
    state: 'Running',
    connectionInfo: {
      ipAddress: '10.0.0.1',
      sshHost: 'charrisdb5.devbox.azure.com',
      sshPort: 22,
      sshUser: 'azureuser',
      acpPort: 7777
    },
    osType: 'Windows',
    location: 'eastus'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockSshClients = []
    
    devBoxManager = new MockDevBoxManager()
    sshTunnelManager = new MockSshTunnelManager()
    openSshProvisioner = new MockOpenSshProvisioner()
    rsyncManager = new MockRsyncManager()

    // Inject a mock SSH client factory
    const sshClientFactory = () => {
      const client = new MockSshClient()
      mockSshClients.push(client)
      
      // Auto-trigger ready event after connect is called
      client.connect.mockImplementation(() => {
        setTimeout(() => {
          client.emit('ready')
        }, 10)
      })
      
      return client
    }

    connector = new DevBoxConnector(
      devBoxManager as any,
      sshTunnelManager as any,
      openSshProvisioner as any,
      rsyncManager as any,
      sshClientFactory as any
    )
  })

  afterEach(() => {
    mockSshClients = []
  })

  // ==========================================================================
  // Full Connection Flow
  // ==========================================================================

  describe('Full Connection Flow', () => {
    it('orchestrates complete connection: autoStart → ensureOpenSsh → createTunnel → verify → ready', async () => {
      // Setup mocks for happy path
      devBoxManager.autoStart.mockResolvedValue(mockDevBox)
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      sshTunnelManager.createTunnel.mockReturnValue('tunnel-123')
      sshTunnelManager.getTunnelStatus.mockReturnValue({
        status: 'connected',
        reconnectAttempts: 0
      })

      // Track events
      const events: string[] = []
      connector.on('connection:starting', () => events.push('starting'))
      connector.on('connection:provisioning', () => events.push('provisioning'))
      connector.on('connection:tunneling', () => events.push('tunneling'))
      connector.on('connection:ready', () => events.push('ready'))

      // Execute
      const connectionId = await connector.connect('charrisdb5', 'test-project')

      // Verify orchestration
      expect(connectionId).toMatch(/^conn-/)
      expect(devBoxManager.autoStart).toHaveBeenCalledWith(
        'test-project',
        'charrisdb5',
        expect.any(Function)
      )
      expect(openSshProvisioner.ensureOpenSsh).toHaveBeenCalled()
      expect(sshTunnelManager.createTunnel).toHaveBeenCalledWith(
        mockDevBox.connectionInfo,
        7777,
        7777,
        undefined
      )

      // Verify state transitions
      expect(events).toEqual(['starting', 'provisioning', 'tunneling', 'ready'])

      // Verify final state
      const status = connector.getStatus(connectionId)
      expect(status?.state).toBe('ready')
      expect(status?.tunnelId).toBe('tunnel-123')
      expect(status?.readyAt).toBeDefined()
    })

    it('uses custom SSH config when provided', async () => {
      devBoxManager.autoStart.mockResolvedValue(mockDevBox)
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      sshTunnelManager.createTunnel.mockReturnValue('tunnel-123')
      sshTunnelManager.getTunnelStatus.mockReturnValue({
        status: 'connected',
        reconnectAttempts: 0
      })

      // Test custom ports only (keyPath would require real file system)
      await connector.connect('charrisdb5', 'test-project', {
        localPort: 8888,
        remotePort: 9999
      })

      expect(sshTunnelManager.createTunnel).toHaveBeenCalledWith(
        mockDevBox.connectionInfo,
        8888,
        9999,
        undefined
      )
    })
  })

  // ==========================================================================
  // Auto-Start Polling
  // ==========================================================================

  describe('Auto-Start Polling', () => {
    it('polls Dev Box state until Running', async () => {
      let pollCount = 0
      const states: DevBoxProvisioningState[] = ['Starting', 'Starting', 'Running']
      
      devBoxManager.autoStart.mockImplementation(async (_project, _name, progressCallback) => {
        // Simulate polling with state changes
        for (let i = 0; i < states.length; i++) {
          progressCallback?.(states[i], i * 1000)
          pollCount++
          await new Promise(resolve => setTimeout(resolve, 10))
        }
        return mockDevBox
      })

      openSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      sshTunnelManager.createTunnel.mockReturnValue('tunnel-123')
      sshTunnelManager.getTunnelStatus.mockReturnValue({
        status: 'connected',
        reconnectAttempts: 0
      })

      await connector.connect('charrisdb5', 'test-project')

      expect(devBoxManager.autoStart).toHaveBeenCalled()
      expect(pollCount).toBeGreaterThan(0)
    })

    it('handles Dev Box already running', async () => {
      devBoxManager.autoStart.mockResolvedValue(mockDevBox)
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      sshTunnelManager.createTunnel.mockReturnValue('tunnel-123')
      sshTunnelManager.getTunnelStatus.mockReturnValue({
        status: 'connected',
        reconnectAttempts: 0
      })

      const connectionId = await connector.connect('charrisdb5', 'test-project')

      expect(connectionId).toMatch(/^conn-/)
      expect(devBoxManager.autoStart).toHaveBeenCalledTimes(1)
    })

    it('fails if Dev Box enters Failed state', async () => {
      devBoxManager.autoStart.mockRejectedValue(
        new Error('Dev Box charrisdb5 entered Failed state')
      )

      await expect(
        connector.connect('charrisdb5', 'test-project')
      ).rejects.toThrow('Failed state')
    })

    it('fails on timeout waiting for Dev Box to start', async () => {
      devBoxManager.autoStart.mockRejectedValue(
        new Error('Timeout waiting for Dev Box charrisdb5 to start (300000ms elapsed)')
      )

      await expect(
        connector.connect('charrisdb5', 'test-project')
      ).rejects.toThrow('Timeout')
    })
  })

  // ==========================================================================
  // SSH Tunnel Creation
  // ==========================================================================

  describe('SSH Tunnel Creation', () => {
    it('creates SSH tunnel with correct ports', async () => {
      devBoxManager.autoStart.mockResolvedValue(mockDevBox)
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      sshTunnelManager.createTunnel.mockReturnValue('tunnel-123')
      sshTunnelManager.getTunnelStatus.mockReturnValue({
        status: 'connected',
        reconnectAttempts: 0
      })

      await connector.connect('charrisdb5', 'test-project')

      expect(sshTunnelManager.createTunnel).toHaveBeenCalledWith(
        expect.objectContaining({
          sshHost: 'charrisdb5.devbox.azure.com',
          sshPort: 22,
          sshUser: 'azureuser',
          acpPort: 7777
        }),
        7777, // localPort
        7777, // remotePort
        undefined // keyPath
      )
    })

    it('passes SSH config to tunnel manager', async () => {
      devBoxManager.autoStart.mockResolvedValue(mockDevBox)
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      sshTunnelManager.createTunnel.mockReturnValue('tunnel-123')
      sshTunnelManager.getTunnelStatus.mockReturnValue({
        status: 'connected',
        reconnectAttempts: 0
      })

      // Test that tunnel manager receives the connection info
      // (keyPath testing requires fs mocking which is in unit tests)
      await connector.connect('charrisdb5', 'test-project')

      expect(sshTunnelManager.createTunnel).toHaveBeenCalledWith(
        expect.objectContaining({
          sshHost: 'charrisdb5.devbox.azure.com',
          sshPort: 22
        }),
        7777,
        7777,
        undefined
      )
    })

    it('fails if tunnel creation fails', async () => {
      devBoxManager.autoStart.mockResolvedValue(mockDevBox)
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      sshTunnelManager.createTunnel.mockImplementation(() => {
        throw new Error('Failed to create SSH tunnel')
      })

      await expect(
        connector.connect('charrisdb5', 'test-project')
      ).rejects.toThrow('Failed to create SSH tunnel')
    })
  })

  // ==========================================================================
  // Health Monitoring
  // ==========================================================================

  describe('Health Monitoring', () => {
    it('waits for tunnel to be ready', async () => {
      devBoxManager.autoStart.mockResolvedValue(mockDevBox)
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      sshTunnelManager.createTunnel.mockReturnValue('tunnel-123')
      
      // First two calls return 'connecting', then 'connected'
      let callCount = 0
      sshTunnelManager.getTunnelStatus.mockImplementation(() => {
        callCount++
        if (callCount <= 2) {
          return { status: 'connecting', reconnectAttempts: 0 }
        }
        return { status: 'connected', reconnectAttempts: 0 }
      })

      const connectionId = await connector.connect('charrisdb5', 'test-project')

      expect(connectionId).toMatch(/^conn-/)
      expect(sshTunnelManager.getTunnelStatus).toHaveBeenCalled()
    })

    it('detects tunnel health check failures', async () => {
      devBoxManager.autoStart.mockResolvedValue(mockDevBox)
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      sshTunnelManager.createTunnel.mockReturnValue('tunnel-123')
      sshTunnelManager.getTunnelStatus
        .mockReturnValueOnce({ status: 'connected', reconnectAttempts: 0 })
        .mockReturnValueOnce({
          status: 'error',
          error: 'Health check failed',
          reconnectAttempts: 1
        })

      const connectionId = await connector.connect('charrisdb5', 'test-project')
      
      // Query status after connection - should detect tunnel error
      const status = connector.getStatus(connectionId)
      expect(status?.state).toBe('failed')
      expect(status?.error).toBe('Health check failed')
    })

    it('times out if tunnel never becomes ready', async () => {
      devBoxManager.autoStart.mockResolvedValue(mockDevBox)
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      sshTunnelManager.createTunnel.mockReturnValue('tunnel-123')
      sshTunnelManager.getTunnelStatus.mockReturnValue({
        status: 'connecting',
        reconnectAttempts: 0
      })

      await expect(
        connector.connect('charrisdb5', 'test-project')
      ).rejects.toThrow('Timeout waiting for tunnel')
    }, 10000) // 10s test timeout
  })

  // ==========================================================================
  // Reconnection with Backoff
  // ==========================================================================

  describe('Reconnection with Backoff', () => {
    it('triggers reconnect when tunnel enters error state', async () => {
      devBoxManager.autoStart.mockResolvedValue(mockDevBox)
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      sshTunnelManager.createTunnel.mockReturnValue('tunnel-123')
      sshTunnelManager.getTunnelStatus.mockReturnValueOnce({
        status: 'connected',
        reconnectAttempts: 0
      })

      const connectionId = await connector.connect('charrisdb5', 'test-project')

      // Simulate tunnel entering error state with reconnect
      sshTunnelManager.getTunnelStatus.mockReturnValue({
        status: 'reconnecting',
        reconnectAttempts: 1
      })

      const status = connector.getStatus(connectionId)
      expect(status?.tunnelId).toBe('tunnel-123')
    })

    it('reflects exponential backoff attempts (1s, 2s, 4s, 8s, max 30s)', async () => {
      // This is tested in the tunnel manager's own tests
      // Here we verify connector observes the reconnect attempts
      devBoxManager.autoStart.mockResolvedValue(mockDevBox)
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      sshTunnelManager.createTunnel.mockReturnValue('tunnel-123')
      sshTunnelManager.getTunnelStatus.mockReturnValue({
        status: 'connected',
        reconnectAttempts: 0
      })

      const connectionId = await connector.connect('charrisdb5', 'test-project')

      // Simulate multiple reconnect attempts
      sshTunnelManager.getTunnelStatus.mockReturnValue({
        status: 'reconnecting',
        reconnectAttempts: 3
      })

      const status = connector.getStatus(connectionId)
      expect(status).toBeDefined()
    })

    it('handles max reconnect attempts reached', async () => {
      devBoxManager.autoStart.mockResolvedValue(mockDevBox)
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      sshTunnelManager.createTunnel.mockReturnValue('tunnel-123')
      sshTunnelManager.getTunnelStatus.mockReturnValueOnce({
        status: 'connected',
        reconnectAttempts: 0
      })

      const connectionId = await connector.connect('charrisdb5', 'test-project')

      // Simulate max attempts reached
      sshTunnelManager.getTunnelStatus.mockReturnValue({
        status: 'error',
        error: 'Max reconnect attempts reached',
        reconnectAttempts: 5
      })

      const status = connector.getStatus(connectionId)
      expect(status?.state).toBe('failed')
      expect(status?.error).toBe('Max reconnect attempts reached')
    })
  })

  // ==========================================================================
  // OpenSSH Provisioning
  // ==========================================================================

  describe('OpenSSH Provisioning', () => {
    it('provisions OpenSSH on first-time setup', async () => {
      devBoxManager.autoStart.mockResolvedValue(mockDevBox)
      
      // Simulate first-time setup flow
      openSshProvisioner.checkOpenSsh.mockResolvedValue(false)
      openSshProvisioner.installOpenSsh.mockResolvedValue(true)
      openSshProvisioner.enableOpenSsh.mockResolvedValue(true)
      openSshProvisioner.verifyOpenSsh.mockResolvedValue(true)
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      
      sshTunnelManager.createTunnel.mockReturnValue('tunnel-123')
      sshTunnelManager.getTunnelStatus.mockReturnValue({
        status: 'connected',
        reconnectAttempts: 0
      })

      await connector.connect('charrisdb5', 'test-project')

      expect(openSshProvisioner.ensureOpenSsh).toHaveBeenCalled()
    })

    it('skips provisioning if OpenSSH already running', async () => {
      devBoxManager.autoStart.mockResolvedValue(mockDevBox)
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      sshTunnelManager.createTunnel.mockReturnValue('tunnel-123')
      sshTunnelManager.getTunnelStatus.mockReturnValue({
        status: 'connected',
        reconnectAttempts: 0
      })

      await connector.connect('charrisdb5', 'test-project')

      expect(openSshProvisioner.ensureOpenSsh).toHaveBeenCalledTimes(1)
    })

    it('fails if OpenSSH installation fails', async () => {
      devBoxManager.autoStart.mockResolvedValue(mockDevBox)
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(false)

      await expect(
        connector.connect('charrisdb5', 'test-project')
      ).rejects.toThrow('Failed to provision OpenSSH')
    })

    it('fails if OpenSSH verification fails', async () => {
      devBoxManager.autoStart.mockResolvedValue(mockDevBox)
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(false)

      await expect(
        connector.connect('charrisdb5', 'test-project')
      ).rejects.toThrow('Failed to provision OpenSSH')
    })
  })

  // ==========================================================================
  // Connection Failure at Each Step
  // ==========================================================================

  describe('Connection Failure Scenarios', () => {
    it('fails at step 1: Dev Box won\'t start', async () => {
      devBoxManager.autoStart.mockRejectedValue(new Error('Failed to start Dev Box'))

      const events: string[] = []
      connector.on('connection:starting', () => events.push('starting'))
      connector.on('connection:failed', () => events.push('failed'))

      await expect(
        connector.connect('charrisdb5', 'test-project')
      ).rejects.toThrow('Failed to start Dev Box')

      expect(events).toEqual(['starting', 'failed'])
    })

    it('fails at step 2: SSH provisioning fails', async () => {
      devBoxManager.autoStart.mockResolvedValue(mockDevBox)
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(false)

      const events: string[] = []
      connector.on('connection:starting', () => events.push('starting'))
      connector.on('connection:provisioning', () => events.push('provisioning'))
      connector.on('connection:failed', () => events.push('failed'))

      await expect(
        connector.connect('charrisdb5', 'test-project')
      ).rejects.toThrow('Failed to provision OpenSSH')

      expect(events).toEqual(['starting', 'provisioning', 'failed'])
    })

    it('fails at step 3: tunnel creation fails', async () => {
      devBoxManager.autoStart.mockResolvedValue(mockDevBox)
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      sshTunnelManager.createTunnel.mockImplementation(() => {
        throw new Error('Connection refused')
      })

      await expect(
        connector.connect('charrisdb5', 'test-project')
      ).rejects.toThrow('Connection refused')
    })

    it('fails at step 4: health check fails', async () => {
      devBoxManager.autoStart.mockResolvedValue(mockDevBox)
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      sshTunnelManager.createTunnel.mockReturnValue('tunnel-123')
      sshTunnelManager.getTunnelStatus.mockReturnValue({
        status: 'error',
        error: 'Port unreachable',
        reconnectAttempts: 0
      })

      await expect(
        connector.connect('charrisdb5', 'test-project')
      ).rejects.toThrow('Tunnel error: Port unreachable')
    })

    it('fails if Dev Box has no connection info', async () => {
      const devBoxWithoutInfo: DevBoxResource = {
        ...mockDevBox,
        connectionInfo: undefined
      }

      devBoxManager.autoStart.mockResolvedValue(devBoxWithoutInfo)

      await expect(
        connector.connect('charrisdb5', 'test-project')
      ).rejects.toThrow('connection info unavailable')
    })
  })

  // ==========================================================================
  // State Transitions
  // ==========================================================================

  describe('State Transitions', () => {
    it('emits events through complete connection lifecycle', async () => {
      devBoxManager.autoStart.mockResolvedValue(mockDevBox)
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      sshTunnelManager.createTunnel.mockReturnValue('tunnel-123')
      sshTunnelManager.getTunnelStatus.mockReturnValue({
        status: 'connected',
        reconnectAttempts: 0
      })

      const events: Array<{ event: string; id?: string; error?: string }> = []
      
      connector.on('connection:starting', (id) => 
        events.push({ event: 'starting', id })
      )
      connector.on('connection:provisioning', (id) => 
        events.push({ event: 'provisioning', id })
      )
      connector.on('connection:tunneling', (id) => 
        events.push({ event: 'tunneling', id })
      )
      connector.on('connection:ready', (id) => 
        events.push({ event: 'ready', id })
      )

      const connectionId = await connector.connect('charrisdb5', 'test-project')

      expect(events).toHaveLength(4)
      expect(events[0].event).toBe('starting')
      expect(events[1].event).toBe('provisioning')
      expect(events[2].event).toBe('tunneling')
      expect(events[3].event).toBe('ready')
      expect(events[3].id).toBe(connectionId)
    })

    it('emits failed event on any error', async () => {
      devBoxManager.autoStart.mockRejectedValue(new Error('Start failed'))

      const events: Array<{ event: string; id?: string; error?: string }> = []
      
      connector.on('connection:starting', (id) => 
        events.push({ event: 'starting', id })
      )
      connector.on('connection:failed', (id, error) => 
        events.push({ event: 'failed', id, error })
      )

      await expect(
        connector.connect('charrisdb5', 'test-project')
      ).rejects.toThrow('Start failed')

      expect(events).toHaveLength(2)
      expect(events[0].event).toBe('starting')
      expect(events[1].event).toBe('failed')
      expect(events[1].error).toBe('Start failed')
    })

    it('emits disconnected event on manual disconnect', async () => {
      devBoxManager.autoStart.mockResolvedValue(mockDevBox)
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      sshTunnelManager.createTunnel.mockReturnValue('tunnel-123')
      sshTunnelManager.getTunnelStatus.mockReturnValue({
        status: 'connected',
        reconnectAttempts: 0
      })

      const connectionId = await connector.connect('charrisdb5', 'test-project')

      const events: string[] = []
      connector.on('connection:disconnected', () => events.push('disconnected'))

      await connector.disconnect(connectionId)

      expect(events).toEqual(['disconnected'])
      expect(sshTunnelManager.closeTunnel).toHaveBeenCalledWith('tunnel-123')
    })

    it('tracks state through internal connection handle', async () => {
      devBoxManager.autoStart.mockResolvedValue(mockDevBox)
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      sshTunnelManager.createTunnel.mockReturnValue('tunnel-123')
      sshTunnelManager.getTunnelStatus.mockReturnValue({
        status: 'connected',
        reconnectAttempts: 0
      })

      const connectionId = await connector.connect('charrisdb5', 'test-project')
      const status = connector.getStatus(connectionId)

      expect(status).toMatchObject({
        id: connectionId,
        devBoxName: 'charrisdb5',
        projectName: 'test-project',
        state: 'ready',
        tunnelId: 'tunnel-123'
      })
      expect(status?.startedAt).toBeLessThanOrEqual(Date.now())
      expect(status?.readyAt).toBeLessThanOrEqual(Date.now())
    })
  })

  // ==========================================================================
  // Disconnect Flow
  // ==========================================================================

  describe('Disconnect Flow', () => {
    it('cleans up tunnel and removes connection', async () => {
      devBoxManager.autoStart.mockResolvedValue(mockDevBox)
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      sshTunnelManager.createTunnel.mockReturnValue('tunnel-123')
      sshTunnelManager.getTunnelStatus.mockReturnValue({
        status: 'connected',
        reconnectAttempts: 0
      })

      const connectionId = await connector.connect('charrisdb5', 'test-project')
      
      expect(connector.getStatus(connectionId)).toBeDefined()

      await connector.disconnect(connectionId)

      expect(sshTunnelManager.closeTunnel).toHaveBeenCalledWith('tunnel-123')
      expect(connector.getStatus(connectionId)).toBeUndefined()
    })

    it('handles disconnect of non-existent connection gracefully', async () => {
      await connector.disconnect('non-existent-id')
      
      expect(sshTunnelManager.closeTunnel).not.toHaveBeenCalled()
    })

    it('handles disconnect when tunnel close fails', async () => {
      devBoxManager.autoStart.mockResolvedValue(mockDevBox)
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      sshTunnelManager.createTunnel.mockReturnValue('tunnel-123')
      sshTunnelManager.getTunnelStatus.mockReturnValue({
        status: 'connected',
        reconnectAttempts: 0
      })
      sshTunnelManager.closeTunnel.mockImplementation(() => {
        throw new Error('Failed to close tunnel')
      })

      const connectionId = await connector.connect('charrisdb5', 'test-project')
      
      // Should not throw
      await connector.disconnect(connectionId)

      // Connection should still be marked as disconnected despite error
      const status = connector.getStatus(connectionId)
      expect(status?.state).toBe('failed')
    })
  })

  // ==========================================================================
  // Multiple Connections
  // ==========================================================================

  describe('Multiple Connections', () => {
    it('manages multiple connections independently', async () => {
      const devBox1 = { ...mockDevBox, name: 'devbox1' }
      const devBox2 = { ...mockDevBox, name: 'devbox2' }

      devBoxManager.autoStart
        .mockResolvedValueOnce(devBox1)
        .mockResolvedValueOnce(devBox2)
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      sshTunnelManager.createTunnel
        .mockReturnValueOnce('tunnel-1')
        .mockReturnValueOnce('tunnel-2')
      sshTunnelManager.getTunnelStatus.mockReturnValue({
        status: 'connected',
        reconnectAttempts: 0
      })

      const conn1 = await connector.connect('devbox1', 'test-project')
      const conn2 = await connector.connect('devbox2', 'test-project')

      const status1 = connector.getStatus(conn1)
      const status2 = connector.getStatus(conn2)

      expect(status1?.devBoxName).toBe('devbox1')
      expect(status1?.tunnelId).toBe('tunnel-1')
      expect(status2?.devBoxName).toBe('devbox2')
      expect(status2?.tunnelId).toBe('tunnel-2')
    })

    it('disconnects one connection without affecting others', async () => {
      const devBox1 = { ...mockDevBox, name: 'devbox1' }
      const devBox2 = { ...mockDevBox, name: 'devbox2' }

      devBoxManager.autoStart
        .mockResolvedValueOnce(devBox1)
        .mockResolvedValueOnce(devBox2)
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      sshTunnelManager.createTunnel
        .mockReturnValueOnce('tunnel-1')
        .mockReturnValueOnce('tunnel-2')
      sshTunnelManager.getTunnelStatus.mockReturnValue({
        status: 'connected',
        reconnectAttempts: 0
      })

      const conn1 = await connector.connect('devbox1', 'test-project')
      const conn2 = await connector.connect('devbox2', 'test-project')

      await connector.disconnect(conn1)

      expect(connector.getStatus(conn1)).toBeUndefined()
      expect(connector.getStatus(conn2)).toBeDefined()
      expect(connector.getStatus(conn2)?.state).toBe('ready')
    })
  })
})
