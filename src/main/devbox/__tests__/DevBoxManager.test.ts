import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { DevBoxResource, DevBoxHealthStatus, DevBoxConnectionInfo } from '@shared/devbox-types'

// Mock @azure/identity
vi.mock('@azure/identity', () => ({
  DefaultAzureCredential: vi.fn()
}))

// Mock fs
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn()
}))

// === Imports after mocks ===
import { DevBoxManager } from '../DevBoxManager'

// Test config
const TEST_CONFIG = {
  devCenterEndpoint: 'https://test-devcenter.eastus.devcenter.azure.com',
  projectName: 'test-project'
}

// Mock credential that returns a token
const mockCredential = {
  getToken: vi.fn().mockResolvedValue({ token: 'test-token-123' })
} as any

describe('DevBoxManager', () => {
  let manager: DevBoxManager

  beforeEach(() => {
    vi.clearAllMocks()
    // Inject config + credential directly for tests
    manager = new DevBoxManager(TEST_CONFIG, mockCredential)
  })

  afterEach(() => {
    manager?.dispose()
  })

  // ============================================================================
  // Configuration
  // ============================================================================

  describe('configuration', () => {
    it('reports isConfigured=true with valid config', () => {
      expect(manager.isConfigured).toBe(true)
    })

    it('reports isConfigured=false when config is null', () => {
      const unconfigured = new DevBoxManager(null, null)
      expect(unconfigured.isConfigured).toBe(false)
      unconfigured.dispose()
    })
  })

  // ============================================================================
  // listDevBoxes
  // ============================================================================

  describe('listDevBoxes', () => {
    it('calls REST API and maps response to DevBoxResource[]', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          value: [
            {
              uniqueId: 'db-1',
              name: 'charrisdb5',
              poolName: 'pool-1',
              powerState: 'Running',
              provisioningState: 'Succeeded',
              osType: 'Windows',
              location: 'eastus',
              createdTime: '2024-01-01T00:00:00Z'
            }
          ]
        })
      }
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as any)

      const result = await manager.listDevBoxes()

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('charrisdb5')
      expect(result[0].state).toBe('Running')
      expect(result[0].projectName).toBe('test-project')
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/projects/test-project/users/me/devboxes'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token-123' })
        })
      )
    })

    it('returns empty array when not configured', async () => {
      const unconfigured = new DevBoxManager(null, null)
      const result = await unconfigured.listDevBoxes()
      expect(result).toEqual([])
      unconfigured.dispose()
    })

    it('returns empty array on API error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: vi.fn().mockResolvedValue('Access denied')
      } as any)

      const result = await manager.listDevBoxes()
      expect(result).toEqual([])
    })
  })

  // ============================================================================
  // startDevBox
  // ============================================================================

  describe('startDevBox', () => {
    it('POSTs to :start endpoint and emits state-changed', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true, status: 202, json: vi.fn()
      } as any)

      const stateHandler = vi.fn()
      manager.on('devbox:state-changed', stateHandler)

      const result = await manager.startDevBox('test-project', 'charrisdb5')
      expect(result).toBe(true)
      expect(stateHandler).toHaveBeenCalledWith('charrisdb5', 'Starting')
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/devboxes/charrisdb5:start'),
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('returns false on API error and emits devbox:error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false, status: 500, statusText: 'Internal Server Error',
        text: vi.fn().mockResolvedValue('error')
      } as any)

      const errorHandler = vi.fn()
      manager.on('devbox:error', errorHandler)

      const result = await manager.startDevBox('test-project', 'charrisdb5')
      expect(result).toBe(false)
      expect(errorHandler).toHaveBeenCalledWith('charrisdb5', expect.stringContaining('500'))
    })
  })

  // ============================================================================
  // stopDevBox
  // ============================================================================

  describe('stopDevBox', () => {
    it('POSTs to :stop endpoint and emits state-changed', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true, status: 202, json: vi.fn()
      } as any)

      const stateHandler = vi.fn()
      manager.on('devbox:state-changed', stateHandler)

      const result = await manager.stopDevBox('test-project', 'charrisdb5')
      expect(result).toBe(true)
      expect(stateHandler).toHaveBeenCalledWith('charrisdb5', 'Stopping')
    })

    it('returns false when not configured', async () => {
      const unconfigured = new DevBoxManager(null, null)
      const result = await unconfigured.stopDevBox('test-project', 'charrisdb5')
      expect(result).toBe(false)
      unconfigured.dispose()
    })
  })

  // ============================================================================
  // getConnectionInfo
  // ============================================================================

  describe('getConnectionInfo', () => {
    it('returns connection info from remoteConnection endpoint', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          rdpConnectionUrl: 'rdp://10.0.0.5',
          webUrl: 'https://charrisdb5.eastus.devcenter.azure.com'
        })
      } as any)

      const result = await manager.getConnectionInfo('test-project', 'charrisdb5')
      expect(result).not.toBeNull()
      expect(result?.sshPort).toBe(22)
      expect(result?.sshUser).toBe('azureuser')
    })

    it('returns null when not configured', async () => {
      const unconfigured = new DevBoxManager(null, null)
      const result = await unconfigured.getConnectionInfo('test-project', 'charrisdb5')
      expect(result).toBeNull()
      unconfigured.dispose()
    })
  })

  // ============================================================================
  // checkHealth
  // ============================================================================

  describe('checkHealth', () => {
    it('returns healthy when dev box is Running', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          name: 'charrisdb5',
          powerState: 'Running',
          provisioningState: 'Succeeded'
        })
      } as any)

      const result = await manager.checkHealth('test-project', 'charrisdb5')
      expect(result.isHealthy).toBe(true)
      expect(result.sshReachable).toBe(true)
      expect(result.lastCheckAt).toBeDefined()
    })

    it('returns unhealthy when dev box is Stopped', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          name: 'charrisdb5',
          powerState: 'Stopped',
          provisioningState: 'Succeeded'
        })
      } as any)

      const result = await manager.checkHealth('test-project', 'charrisdb5')
      expect(result.isHealthy).toBe(false)
      expect(result.error).toContain('Stopped')
    })
  })

  // ============================================================================
  // autoStart
  // ============================================================================

  describe('autoStart', () => {
    it('starts dev box and polls until Running state', async () => {
      vi.useFakeTimers()
      let callCount = 0

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        const urlStr = url.toString()
        // getDevBox call (initial check)
        if (urlStr.includes(':start')) {
          return { ok: true, status: 202, json: vi.fn() } as any
        }
        // getDevBox polling
        callCount++
        if (callCount >= 3) {
          return {
            ok: true, status: 200,
            json: vi.fn().mockResolvedValue({
              uniqueId: 'db-1', name: 'charrisdb5', poolName: 'pool-1',
              powerState: 'Running', provisioningState: 'Succeeded',
              osType: 'Windows', location: 'eastus',
            })
          } as any
        }
        return {
          ok: true, status: 200,
          json: vi.fn().mockResolvedValue({
            name: 'charrisdb5', poolName: 'pool-1',
            powerState: callCount === 1 ? 'Stopped' : 'Starting',
            provisioningState: 'Succeeded',
            osType: 'Windows', location: 'eastus'
          })
        } as any
      })

      const progressCallback = vi.fn()
      const promise = manager.autoStart('test-project', 'charrisdb5', progressCallback)

      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(5000)
      }

      const result = await promise
      expect(result.state).toBe('Running')
      expect(progressCallback).toHaveBeenCalled()
      vi.useRealTimers()
    })

    it('returns immediately if already running', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true, status: 200,
        json: vi.fn().mockResolvedValue({
          uniqueId: 'db-1', name: 'charrisdb5', poolName: 'pool-1',
          powerState: 'Running', provisioningState: 'Succeeded',
          osType: 'Windows', location: 'eastus',
        })
      } as any)

      const result = await manager.autoStart('test-project', 'charrisdb5')
      expect(result.state).toBe('Running')
      // Should not have called :start
      const calls = (globalThis.fetch as any).mock.calls
      const startCalls = calls.filter((c: any) => c[0].toString().includes(':start'))
      expect(startCalls).toHaveLength(0)
    })

    it('throws error if dev box enters Failed state', async () => {
      vi.useFakeTimers()
      let isFirst = true

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        const urlStr = url.toString()
        if (urlStr.includes(':start')) {
          return { ok: true, status: 202, json: vi.fn() } as any
        }
        if (isFirst) {
          isFirst = false
          return {
            ok: true, status: 200,
            json: vi.fn().mockResolvedValue({
              name: 'charrisdb5', powerState: 'Stopped', provisioningState: 'Succeeded',
              osType: 'Windows', location: 'eastus'
            })
          } as any
        }
        return {
          ok: true, status: 200,
          json: vi.fn().mockResolvedValue({
            name: 'charrisdb5', powerState: 'Running',
            provisioningState: 'Failed', osType: 'Windows', location: 'eastus'
          })
        } as any
      })

      const promise = manager.autoStart('test-project', 'charrisdb5')
      const caught = promise.catch(() => {})

      await vi.advanceTimersByTimeAsync(5000)

      await expect(promise).rejects.toThrow(/Failed state/i)
      await caught
      vi.useRealTimers()
    })

    it('times out after 5 minutes if dev box does not start', async () => {
      vi.useFakeTimers()
      let isFirst = true

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        const urlStr = url.toString()
        if (urlStr.includes(':start')) {
          return { ok: true, status: 202, json: vi.fn() } as any
        }
        if (isFirst) {
          isFirst = false
          return {
            ok: true, status: 200,
            json: vi.fn().mockResolvedValue({
              name: 'charrisdb5', powerState: 'Stopped', provisioningState: 'Succeeded',
              osType: 'Windows', location: 'eastus'
            })
          } as any
        }
        return {
          ok: true, status: 200,
          json: vi.fn().mockResolvedValue({
            name: 'charrisdb5', powerState: 'Starting', provisioningState: 'Succeeded',
            osType: 'Windows', location: 'eastus'
          })
        } as any
      })

      const promise = manager.autoStart('test-project', 'charrisdb5')
      const caught = promise.catch(() => {})

      await vi.advanceTimersByTimeAsync(6 * 60 * 1000)

      await expect(promise).rejects.toThrow(/timeout/i)
      await caught
      vi.useRealTimers()
    })

    it('calls progress callback with state and elapsed time', async () => {
      vi.useFakeTimers()
      let callCount = 0

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        const urlStr = url.toString()
        if (urlStr.includes(':start')) {
          return { ok: true, status: 202, json: vi.fn() } as any
        }
        callCount++
        if (callCount === 1) {
          return {
            ok: true, status: 200,
            json: vi.fn().mockResolvedValue({
              name: 'charrisdb5', powerState: 'Stopped', provisioningState: 'Succeeded',
              osType: 'Windows', location: 'eastus'
            })
          } as any
        }
        if (callCount === 2) {
          return {
            ok: true, status: 200,
            json: vi.fn().mockResolvedValue({
              name: 'charrisdb5', powerState: 'Starting', provisioningState: 'Succeeded',
              osType: 'Windows', location: 'eastus'
            })
          } as any
        }
        return {
          ok: true, status: 200,
          json: vi.fn().mockResolvedValue({
            uniqueId: 'db-1', name: 'charrisdb5', poolName: 'pool-1',
            powerState: 'Running', provisioningState: 'Succeeded',
            osType: 'Windows', location: 'eastus'
          })
        } as any
      })

      const progressCallback = vi.fn()
      const promise = manager.autoStart('test-project', 'charrisdb5', progressCallback)

      await vi.advanceTimersByTimeAsync(10000)
      await promise

      expect(progressCallback).toHaveBeenCalledWith('Starting', expect.any(Number))
      expect(progressCallback.mock.calls.length).toBeGreaterThanOrEqual(1)

      vi.useRealTimers()
    })
  })
})
