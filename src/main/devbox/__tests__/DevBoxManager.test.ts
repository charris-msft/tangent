import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { DevBoxResource, DevBoxHealthStatus, DevBoxConnectionInfo } from '@shared/devbox-types'

// Mock @microsoft/devbox-mcp
const mockListProjects = vi.fn()
const mockListDevBoxes = vi.fn()
const mockStartDevBox = vi.fn()
const mockStopDevBox = vi.fn()
const mockGetDevBox = vi.fn()
const mockGetConnectionInfo = vi.fn()

vi.mock('@microsoft/devbox-mcp', () => ({
  DevBoxClient: function() {
    return {
      listProjects: mockListProjects,
      listDevBoxes: mockListDevBoxes,
      startDevBox: mockStartDevBox,
      stopDevBox: mockStopDevBox,
      getDevBox: mockGetDevBox,
      getConnectionInfo: mockGetConnectionInfo,
    }
  }
}))

// Mock ssh2 for health checks
const mockSshConnect = vi.fn()
const mockSshEnd = vi.fn()
const mockSshOn = vi.fn()

vi.mock('ssh2', () => ({
  Client: function() {
    return {
      connect: mockSshConnect,
      end: mockSshEnd,
      on: mockSshOn,
    }
  }
}))

// === Imports after mocks ===
import { DevBoxManager } from '../DevBoxManager'

describe('DevBoxManager', () => {
  let manager: DevBoxManager
  let mockClient: any

  beforeEach(() => {
    vi.clearAllMocks()
    
    // Create a mock client instance to inject
    mockClient = {
      listProjects: mockListProjects,
      listDevBoxes: mockListDevBoxes,
      startDevBox: mockStartDevBox,
      stopDevBox: mockStopDevBox,
      getDevBox: mockGetDevBox,
      getConnectionInfo: mockGetConnectionInfo,
    }
    
    // Inject the mock client directly
    manager = new DevBoxManager(mockClient)
  })

  afterEach(() => {
    manager?.dispose()
  })

  // ============================================================================
  // listDevBoxes
  // ============================================================================

  describe('listDevBoxes', () => {
    it.skip('returns array of dev boxes grouped by project', async () => {
      // TODO: Implement once MCP client integration is complete
    })

    it.skip('returns empty array when no projects exist', async () => {
      // TODO: Implement once MCP client integration is complete
    })

    it.skip('handles MCP errors gracefully', async () => {
      // TODO: Implement once MCP client integration is complete
    })

    it.skip('handles empty projects with no dev boxes', async () => {
      // TODO: Implement once MCP client integration is complete
    })
  })

  // ============================================================================
  // startDevBox
  // ============================================================================

  describe('startDevBox', () => {
    it.skip('starts a stopped dev box successfully', async () => {
      // TODO: Implement once MCP client integration is complete
    })

    it.skip('returns immediately if dev box is already running', async () => {
      // TODO: Implement once MCP client integration is complete
    })

    it.skip('handles MCP failure during start', async () => {
      // TODO: Implement once MCP client integration is complete
    })

    it.skip('times out if dev box does not reach Running state', async () => {
      // TODO: Implement once MCP client integration is complete
    })
  })

  // ============================================================================
  // stopDevBox
  // ============================================================================

  describe('stopDevBox', () => {
    it.skip('stops a running dev box successfully', async () => {
      // TODO: Implement once MCP client integration is complete
    })

    it.skip('returns immediately if dev box is already stopped', async () => {
      // TODO: Implement once MCP client integration is complete
    })

    it.skip('handles MCP error during stop', async () => {
      // TODO: Implement once MCP client integration is complete
    })
  })

  // ============================================================================
  // getConnectionInfo
  // ============================================================================

  describe('getConnectionInfo', () => {
    it.skip('returns connection info for a running dev box', async () => {
      // TODO: Implement once MCP client integration is complete
    })

    it.skip('throws error if dev box not found', async () => {
      // TODO: Implement once MCP client integration is complete
    })

    it.skip('returns undefined acpPort if not configured', async () => {
      // TODO: Implement once MCP client integration is complete
    })
  })

  // ============================================================================
  // checkHealth
  // ============================================================================

  describe('checkHealth', () => {
    it.skip('returns healthy status when SSH and ACP are reachable', async () => {
      // TODO: Implement with proper mocking once checkHealth is implemented
    })

    it.skip('returns unhealthy status when SSH connection fails', async () => {
      // TODO: Implement with proper mocking once checkHealth is implemented
    })

    it.skip('includes lastCheckAt timestamp', async () => {
      // TODO: Implement with proper mocking once checkHealth is implemented
    })
  })

  // ============================================================================
  // autoStart
  // ============================================================================

  describe('autoStart', () => {
    it('starts dev box and polls until Running state', async () => {
      vi.useFakeTimers()
      let callCount = 0
      
      // Mock initial state check (not running)
      mockGetDevBox
        .mockResolvedValueOnce({ state: 'Stopped', name: 'charrisdb5', projectName: 'project-1' })
      
      // Mock start operation
      mockStartDevBox.mockResolvedValue({ state: 'Starting' })
      
      // Mock polling - returns Starting for first 2 calls, then Running
      mockGetDevBox.mockImplementation(() => {
        callCount++
        if (callCount >= 3) {
          return Promise.resolve({
            id: 'db-1',
            name: 'charrisdb5',
            projectName: 'project-1',
            poolName: 'pool-1',
            state: 'Running',
            osType: 'Windows' as const,
            location: 'eastus',
            connectionInfo: {
              ipAddress: '10.0.0.5',
              sshHost: 'charrisdb5.eastus.devcenter.azure.com',
              sshPort: 22,
              sshUser: 'azureuser',
              acpPort: 8765
            }
          })
        }
        return Promise.resolve({ 
          state: 'Starting', 
          name: 'charrisdb5', 
          projectName: 'project-1',
          poolName: 'pool-1',
          osType: 'Windows' as const,
          location: 'eastus'
        })
      })

      const progressCallback = vi.fn()
      const promise = manager.autoStart('project-1', 'charrisdb5', progressCallback)

      // Advance through polling intervals (5 seconds each)
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(5000)
      }

      const result = await promise

      expect(result.state).toBe('Running')
      expect(result.connectionInfo).toBeDefined()
      expect(result.connectionInfo?.sshHost).toBe('charrisdb5.eastus.devcenter.azure.com')
      expect(progressCallback).toHaveBeenCalled()
      expect(callCount).toBeGreaterThanOrEqual(3)
      vi.useRealTimers()
    })

    it('times out after 5 minutes if dev box does not start', async () => {
      vi.useFakeTimers()
      
      // Mock initial state check (not running)
      mockGetDevBox.mockResolvedValueOnce({ 
        state: 'Stopped', 
        name: 'charrisdb5', 
        projectName: 'project-1',
        poolName: 'pool-1',
        osType: 'Windows' as const,
        location: 'eastus'
      })
      
      // Mock start
      mockStartDevBox.mockResolvedValue({ state: 'Starting' })
      
      // Mock continuous Starting state during polling
      mockGetDevBox.mockResolvedValue({ 
        state: 'Starting', 
        name: 'charrisdb5', 
        projectName: 'project-1',
        poolName: 'pool-1',
        osType: 'Windows' as const,
        location: 'eastus'
      })

      const promise = manager.autoStart('project-1', 'charrisdb5')
      const caught = promise.catch(() => {})

      // Advance past 5 minute timeout
      await vi.advanceTimersByTimeAsync(6 * 60 * 1000)

      await expect(promise).rejects.toThrow(/timeout/i)
      await caught
      vi.useRealTimers()
    })

    it('returns immediately if already running', async () => {
      // Mock getDevBox showing already running
      mockGetDevBox.mockResolvedValue({
        id: 'db-1',
        name: 'charrisdb5',
        projectName: 'project-1',
        poolName: 'pool-1',
        state: 'Running',
        osType: 'Windows' as const,
        location: 'eastus',
        connectionInfo: {
          ipAddress: '10.0.0.5',
          sshHost: 'charrisdb5.eastus.devcenter.azure.com',
          sshPort: 22,
          sshUser: 'azureuser',
          acpPort: 8765
        }
      })

      const result = await manager.autoStart('project-1', 'charrisdb5')

      expect(result.state).toBe('Running')
      expect(result.connectionInfo).toBeDefined()
      expect(mockStartDevBox).not.toHaveBeenCalled()
    })

    it('throws error if dev box enters Failed state', async () => {
      vi.useFakeTimers()
      
      // Mock initial state check (not running)
      mockGetDevBox.mockResolvedValueOnce({ 
        state: 'Stopped', 
        name: 'charrisdb5', 
        projectName: 'project-1'
      })
      
      // Mock start
      mockStartDevBox.mockResolvedValue({ state: 'Starting' })
      
      // Mock Failed state during polling
      mockGetDevBox.mockResolvedValue({ 
        state: 'Failed', 
        name: 'charrisdb5', 
        projectName: 'project-1'
      })

      const promise = manager.autoStart('project-1', 'charrisdb5')
      // Attach catch handler immediately to prevent unhandled rejection
      const caught = promise.catch(() => {})

      // Advance one polling interval
      await vi.advanceTimersByTimeAsync(5000)

      await expect(promise).rejects.toThrow(/Failed state/i)
      await caught
      vi.useRealTimers()
    })

    it('calls progress callback with state and elapsed time', async () => {
      vi.useFakeTimers()
      
      // Mock initial state check (not running)
      mockGetDevBox.mockResolvedValueOnce({ 
        state: 'Stopped', 
        name: 'charrisdb5', 
        projectName: 'project-1'
      })
      
      // Mock start
      mockStartDevBox.mockResolvedValue({ state: 'Starting' })
      
      // Mock polling - first Starting, then Running
      mockGetDevBox
        .mockResolvedValueOnce({ state: 'Starting', name: 'charrisdb5', projectName: 'project-1' })
        .mockResolvedValueOnce({ 
          state: 'Running', 
          name: 'charrisdb5', 
          projectName: 'project-1',
          poolName: 'pool-1',
          osType: 'Windows' as const,
          location: 'eastus'
        })

      const progressCallback = vi.fn()
      const promise = manager.autoStart('project-1', 'charrisdb5', progressCallback)

      // Advance through polling
      await vi.advanceTimersByTimeAsync(10000)

      await promise

      // Should have called with 'Starting' from the start action
      expect(progressCallback).toHaveBeenCalledWith('Starting', expect.any(Number))
      // Should have called during polling as well
      expect(progressCallback.mock.calls.length).toBeGreaterThanOrEqual(1)
      
      vi.useRealTimers()
    })
  })
})
