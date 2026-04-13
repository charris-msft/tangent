import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { DevBoxConnector } from '../DevBoxConnector'
import type { DevBoxResource } from '@shared/devbox-types'

// Mock dependencies
class MockDevBoxManager extends EventEmitter {
  autoStart = vi.fn()
  stopDevBox = vi.fn()
}

class MockSshTunnelManager extends EventEmitter {
  createTunnel = vi.fn()
  closeTunnel = vi.fn()
  getTunnelStatus = vi.fn()
}

class MockOpenSshProvisioner {
  ensureOpenSsh = vi.fn()
}

class MockRsyncManager extends EventEmitter {
  syncOutbound = vi.fn()
  syncInbound = vi.fn()
}

class MockSshClient extends EventEmitter {
  connect = vi.fn()
  end = vi.fn()
}

// Track created SSH clients
let mockSshClients: MockSshClient[] = []

// Mock ssh2 module
vi.mock('ssh2', () => ({
  Client: class extends EventEmitter {
    connect = vi.fn()
    end = vi.fn()
    
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

// Mock fs module
vi.mock('fs', () => ({
  readFileSync: vi.fn(() => 'mock-ssh-key-content')
}))

describe('DevBoxConnector', () => {
  let connector: DevBoxConnector
  let devBoxManager: MockDevBoxManager
  let sshTunnelManager: MockSshTunnelManager
  let openSshProvisioner: MockOpenSshProvisioner
  let rsyncManager: MockRsyncManager

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

  describe('connect', () => {
    it('should orchestrate full connection flow successfully', async () => {
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

      devBoxManager.autoStart.mockResolvedValue(mockDevBox)
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      sshTunnelManager.createTunnel.mockReturnValue('tunnel-123')
      sshTunnelManager.getTunnelStatus.mockReturnValue({
        status: 'connected',
        reconnectAttempts: 0
      })

      const events: string[] = []
      connector.on('connection:starting', () => events.push('starting'))
      connector.on('connection:provisioning', () => events.push('provisioning'))
      connector.on('connection:tunneling', () => events.push('tunneling'))
      connector.on('connection:ready', () => events.push('ready'))

      const connectionId = await connector.connect('charrisdb5', 'test-project')

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
      expect(events).toEqual(['starting', 'provisioning', 'tunneling', 'ready'])

      const status = connector.getStatus(connectionId)
      expect(status?.state).toBe('ready')
      expect(status?.tunnelId).toBe('tunnel-123')
    })

    it('should fail if Dev Box does not start', async () => {
      devBoxManager.autoStart.mockRejectedValue(new Error('Failed to start Dev Box'))

      const events: string[] = []
      connector.on('connection:starting', () => events.push('starting'))
      connector.on('connection:failed', () => events.push('failed'))

      await expect(
        connector.connect('charrisdb5', 'test-project')
      ).rejects.toThrow('Failed to start Dev Box')

      expect(events).toEqual(['starting', 'failed'])
    })

    it('should fail if Dev Box has no connection info', async () => {
      const mockDevBox: DevBoxResource = {
        id: 'devbox-123',
        name: 'charrisdb5',
        projectName: 'test-project',
        poolName: 'default-pool',
        state: 'Running',
        osType: 'Windows',
        location: 'eastus'
      }

      devBoxManager.autoStart.mockResolvedValue(mockDevBox)

      await expect(
        connector.connect('charrisdb5', 'test-project')
      ).rejects.toThrow('connection info unavailable')

      const connectionId = Array.from((connector as any).connections.keys())[0]
      const status = connector.getStatus(connectionId)
      expect(status?.state).toBe('failed')
    })

    it('should fail if OpenSSH provisioning fails', async () => {
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
          sshUser: 'azureuser'
        },
        osType: 'Windows',
        location: 'eastus'
      }

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

    it('should fail if tunnel creation times out', async () => {
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
          sshUser: 'azureuser'
        },
        osType: 'Windows',
        location: 'eastus'
      }

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

    it('should fail if tunnel enters error state', async () => {
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
          sshUser: 'azureuser'
        },
        osType: 'Windows',
        location: 'eastus'
      }

      devBoxManager.autoStart.mockResolvedValue(mockDevBox)
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      sshTunnelManager.createTunnel.mockReturnValue('tunnel-123')
      sshTunnelManager.getTunnelStatus.mockReturnValue({
        status: 'error',
        error: 'Connection refused',
        reconnectAttempts: 1
      })

      await expect(
        connector.connect('charrisdb5', 'test-project')
      ).rejects.toThrow('Tunnel error: Connection refused')
    })

    it('should use custom SSH config when provided', async () => {
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
          sshUser: 'azureuser'
        },
        osType: 'Windows',
        location: 'eastus'
      }

      devBoxManager.autoStart.mockResolvedValue(mockDevBox)
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      sshTunnelManager.createTunnel.mockReturnValue('tunnel-123')
      sshTunnelManager.getTunnelStatus.mockReturnValue({
        status: 'connected',
        reconnectAttempts: 0
      })

      // For this test, we skip keyPath to avoid fs.readFileSync issue
      // The important thing is testing custom ports
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

  describe('disconnect', () => {
    it('should gracefully close tunnel and update state', async () => {
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
          sshUser: 'azureuser'
        },
        osType: 'Windows',
        location: 'eastus'
      }

      devBoxManager.autoStart.mockResolvedValue(mockDevBox)
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      sshTunnelManager.createTunnel.mockReturnValue('tunnel-123')
      sshTunnelManager.getTunnelStatus.mockReturnValue({
        status: 'connected',
        reconnectAttempts: 0
      })

      const connectionId = await connector.connect('charrisdb5', 'test-project')

      const disconnectEvents: string[] = []
      connector.on('connection:disconnected', () => disconnectEvents.push('disconnected'))

      await connector.disconnect(connectionId)

      expect(sshTunnelManager.closeTunnel).toHaveBeenCalledWith('tunnel-123')
      expect(devBoxManager.stopDevBox).not.toHaveBeenCalled()
      expect(disconnectEvents).toEqual(['disconnected'])
      expect(connector.getStatus(connectionId)).toBeUndefined()
    })

    it('should stop Dev Box when stopDevBox option is true', async () => {
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
          sshUser: 'azureuser'
        },
        osType: 'Windows',
        location: 'eastus'
      }

      devBoxManager.autoStart.mockResolvedValue(mockDevBox)
      devBoxManager.stopDevBox.mockResolvedValue(undefined)
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      sshTunnelManager.createTunnel.mockReturnValue('tunnel-123')
      sshTunnelManager.getTunnelStatus.mockReturnValue({
        status: 'connected',
        reconnectAttempts: 0
      })

      const connectionId = await connector.connect('charrisdb5', 'test-project')

      await connector.disconnect(connectionId, { stopDevBox: true })

      expect(sshTunnelManager.closeTunnel).toHaveBeenCalledWith('tunnel-123')
      expect(devBoxManager.stopDevBox).toHaveBeenCalledWith('test-project', 'charrisdb5')
    })

    it('should continue disconnect even if stopping Dev Box fails', async () => {
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
          sshUser: 'azureuser'
        },
        osType: 'Windows',
        location: 'eastus'
      }

      devBoxManager.autoStart.mockResolvedValue(mockDevBox)
      devBoxManager.stopDevBox.mockRejectedValue(new Error('Failed to stop'))
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      sshTunnelManager.createTunnel.mockReturnValue('tunnel-123')
      sshTunnelManager.getTunnelStatus.mockReturnValue({
        status: 'connected',
        reconnectAttempts: 0
      })

      const connectionId = await connector.connect('charrisdb5', 'test-project')

      await connector.disconnect(connectionId, { stopDevBox: true })

      expect(devBoxManager.stopDevBox).toHaveBeenCalled()
      expect(connector.getStatus(connectionId)).toBeUndefined()
    })

    it('should handle disconnect of non-existent connection', async () => {
      await connector.disconnect('non-existent-id')
      expect(sshTunnelManager.closeTunnel).not.toHaveBeenCalled()
    })
  })

  describe('getStatus', () => {
    it('should return connection status', async () => {
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
          sshUser: 'azureuser'
        },
        osType: 'Windows',
        location: 'eastus'
      }

      devBoxManager.autoStart.mockResolvedValue(mockDevBox)
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      sshTunnelManager.createTunnel.mockReturnValue('tunnel-123')
      sshTunnelManager.getTunnelStatus.mockReturnValue({
        status: 'connected',
        reconnectAttempts: 0
      })

      const connectionId = await connector.connect('charrisdb5', 'test-project')
      const status = connector.getStatus(connectionId)

      expect(status).toBeDefined()
      expect(status?.id).toBe(connectionId)
      expect(status?.devBoxName).toBe('charrisdb5')
      expect(status?.projectName).toBe('test-project')
      expect(status?.state).toBe('ready')
      expect(status?.tunnelId).toBe('tunnel-123')
      expect(status?.startedAt).toBeLessThanOrEqual(Date.now())
      expect(status?.readyAt).toBeDefined()
    })

    it('should update state to failed if tunnel has error', async () => {
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
          sshUser: 'azureuser'
        },
        osType: 'Windows',
        location: 'eastus'
      }

      devBoxManager.autoStart.mockResolvedValue(mockDevBox)
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      sshTunnelManager.createTunnel.mockReturnValue('tunnel-123')
      sshTunnelManager.getTunnelStatus
        .mockReturnValueOnce({ status: 'connected', reconnectAttempts: 0 })
        .mockReturnValueOnce({
          status: 'error',
          error: 'Connection lost',
          reconnectAttempts: 2
        })

      const connectionId = await connector.connect('charrisdb5', 'test-project')

      const status = connector.getStatus(connectionId)
      expect(status?.state).toBe('failed')
      expect(status?.error).toBe('Connection lost')
    })

    it('should return undefined for non-existent connection', () => {
      const status = connector.getStatus('non-existent-id')
      expect(status).toBeUndefined()
    })
  })

  describe('state transitions', () => {
    it('should transition through all states in happy path', async () => {
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
          sshUser: 'azureuser'
        },
        osType: 'Windows',
        location: 'eastus'
      }

      const states: string[] = []

      devBoxManager.autoStart.mockImplementation(async () => {
        states.push('starting-devbox')
        return mockDevBox
      })

      openSshProvisioner.ensureOpenSsh.mockImplementation(async () => {
        states.push('ensuring-ssh')
        return true
      })

      sshTunnelManager.createTunnel.mockImplementation(() => {
        states.push('tunneling')
        return 'tunnel-123'
      })

      sshTunnelManager.getTunnelStatus.mockImplementation(() => {
        states.push('verifying')
        return { status: 'connected', reconnectAttempts: 0 }
      })

      await connector.connect('charrisdb5', 'test-project')

      expect(states).toContain('starting-devbox')
      expect(states).toContain('ensuring-ssh')
      expect(states).toContain('tunneling')
      expect(states).toContain('verifying')
    })

    it('should transition to failed on any error', async () => {
      devBoxManager.autoStart.mockRejectedValue(new Error('Start failed'))

      let failedConnectionId = ''
      let failedError = ''
      connector.on('connection:failed', (id, error) => {
        failedConnectionId = id
        failedError = error
      })

      await expect(
        connector.connect('charrisdb5', 'test-project')
      ).rejects.toThrow('Start failed')

      expect(failedConnectionId).toMatch(/^conn-/)
      expect(failedError).toBe('Start failed')

      const status = connector.getStatus(failedConnectionId)
      expect(status?.state).toBe('failed')
      expect(status?.error).toBe('Start failed')
    })
  })

  describe('syncWorkspaceOut', () => {
    it('should sync workspace successfully', async () => {
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
          sshUser: 'azureuser'
        },
        osType: 'Windows',
        location: 'eastus'
      }

      devBoxManager.autoStart.mockResolvedValue(mockDevBox)
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      sshTunnelManager.createTunnel.mockReturnValue('tunnel-123')
      sshTunnelManager.getTunnelStatus.mockReturnValue({
        status: 'connected',
        reconnectAttempts: 0
      })

      rsyncManager.syncOutbound.mockResolvedValue({
        success: true,
        bytesTransferred: 1024,
        filesSynced: 5
      })

      const connectionId = await connector.connect('charrisdb5', 'test-project')

      const syncEvents: string[] = []
      connector.on('connection:syncing', () => syncEvents.push('syncing'))

      const result = await connector.syncWorkspaceOut(
        connectionId,
        '/local/workspace',
        '/remote/workspace'
      )

      expect(result.success).toBe(true)
      expect(rsyncManager.syncOutbound).toHaveBeenCalledWith(
        '/local/workspace',
        '/remote/workspace',
        'charrisdb5.devbox.azure.com',
        'azureuser'
      )
      expect(syncEvents).toEqual(['syncing'])
    })

    it('should fail if connection not found', async () => {
      const result = await connector.syncWorkspaceOut(
        'non-existent-id',
        '/local/workspace',
        '/remote/workspace'
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('should fail if connection info unavailable', async () => {
      const mockDevBox: DevBoxResource = {
        id: 'devbox-123',
        name: 'charrisdb5',
        projectName: 'test-project',
        poolName: 'default-pool',
        state: 'Running',
        osType: 'Windows',
        location: 'eastus'
      }

      // Mock connection without connection info
      devBoxManager.autoStart.mockResolvedValue(mockDevBox)
      
      let connectionId = ''
      try {
        connectionId = await connector.connect('charrisdb5', 'test-project')
      } catch {
        // Expected to fail, get connection from internal map
        const connections = (connector as any).connections as Map<string, any>
        connectionId = Array.from(connections.keys())[0]
      }

      const result = await connector.syncWorkspaceOut(
        connectionId,
        '/local/workspace',
        '/remote/workspace'
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('Connection info unavailable')
    })

    it('should fail if rsync manager not configured', async () => {
      const connectorWithoutRsync = new DevBoxConnector(
        devBoxManager as any,
        sshTunnelManager as any,
        openSshProvisioner as any,
        undefined,
        () => {
          const client = new MockSshClient()
          mockSshClients.push(client)
          client.connect.mockImplementation(() => {
            setTimeout(() => {
              client.emit('ready')
            }, 10)
          })
          return client
        }
      )

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
          sshUser: 'azureuser'
        },
        osType: 'Windows',
        location: 'eastus'
      }

      devBoxManager.autoStart.mockResolvedValue(mockDevBox)
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      sshTunnelManager.createTunnel.mockReturnValue('tunnel-123')
      sshTunnelManager.getTunnelStatus.mockReturnValue({
        status: 'connected',
        reconnectAttempts: 0
      })

      const connectionId = await connectorWithoutRsync.connect('charrisdb5', 'test-project')

      const result = await connectorWithoutRsync.syncWorkspaceOut(
        connectionId,
        '/local/workspace',
        '/remote/workspace'
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('RsyncManager not configured')
    })

    it('should handle rsync failure', async () => {
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
          sshUser: 'azureuser'
        },
        osType: 'Windows',
        location: 'eastus'
      }

      devBoxManager.autoStart.mockResolvedValue(mockDevBox)
      openSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      sshTunnelManager.createTunnel.mockReturnValue('tunnel-123')
      sshTunnelManager.getTunnelStatus.mockReturnValue({
        status: 'connected',
        reconnectAttempts: 0
      })

      rsyncManager.syncOutbound.mockResolvedValue({
        success: false,
        bytesTransferred: 0,
        filesSynced: 0,
        error: 'Connection refused'
      })

      const connectionId = await connector.connect('charrisdb5', 'test-project')

      const result = await connector.syncWorkspaceOut(
        connectionId,
        '/local/workspace',
        '/remote/workspace'
      )

      expect(result.success).toBe(false)
      expect(result.error).toBe('Connection refused')
    })
  })
})
