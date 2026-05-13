import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SyncListener, SyncHistoryEntry } from '../SyncListener'
import { RsyncManager, RsyncResult } from '../RsyncManager'
import { EventEmitter } from 'events'

// Mock RsyncManager - must use vi.fn() factory pattern for hoisting
vi.mock('../RsyncManager', () => {
  const { EventEmitter } = require('events')

  return {
    RsyncManager: class extends EventEmitter {
      syncInbound = vi.fn()
      syncInboundWithConflictCheck = vi.fn()
    }
  }
})

describe('SyncListener', () => {
  let listener: SyncListener
  let mockRsyncManager: RsyncManager
  const testLocalPath = '/home/user/workspace'
  const testRemotePath = '/home/devbox/workspace'
  const testSshHost = '10.0.0.1'
  const testSshUser = 'azureuser'

  beforeEach(() => {
    listener = new SyncListener()
    // Access the internal rsyncManager for testing
    mockRsyncManager = (listener as any).rsyncManager
    vi.clearAllMocks()
  })

  afterEach(() => {
    listener.dispose()
  })

  describe('startListening', () => {
    it('should start listening with correct configuration', () => {
      listener.startListening(testLocalPath, testRemotePath, testSshHost, testSshUser)

      const status = listener.getStatus()
      expect(status.isListening).toBe(true)
      expect(status.localPath).toBe(testLocalPath)
      expect(status.sshHost).toBe(testSshHost)
    })

    it('should use default ssh user if not provided', () => {
      listener.startListening(testLocalPath, testRemotePath, testSshHost)

      const status = listener.getStatus()
      expect(status.isListening).toBe(true)
    })

    it('should not start if already active', () => {
      listener.startListening(testLocalPath, testRemotePath, testSshHost, testSshUser)

      // Try to start again with different path
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      listener.startListening('/other/path', testRemotePath, testSshHost, testSshUser)

      expect(consoleSpy).toHaveBeenCalledWith(
        '[Tangent] SyncListener already active for',
        testLocalPath
      )

      // Should still have original path
      const status = listener.getStatus()
      expect(status.localPath).toBe(testLocalPath)

      consoleSpy.mockRestore()
    })
  })

  describe('stopListening', () => {
    it('should stop listening and clear configuration', () => {
      listener.startListening(testLocalPath, testRemotePath, testSshHost, testSshUser)
      listener.stopListening()

      const status = listener.getStatus()
      expect(status.isListening).toBe(false)
      expect(status.localPath).toBeUndefined()
      expect(status.sshHost).toBeUndefined()
    })

    it('should preserve sync history when stopped', () => {
      listener.startListening(testLocalPath, testRemotePath, testSshHost, testSshUser)

      // Simulate sync completion
      mockRsyncManager.emit('sync:complete', {
        direction: 'inbound',
        result: {
          success: true,
          bytesTransferred: 1234,
          filesSynced: 5
        }
      })

      listener.stopListening()

      const history = listener.getHistory()
      expect(history).toHaveLength(1)
    })

    it('should handle stop when not listening', () => {
      // Should not throw
      expect(() => listener.stopListening()).not.toThrow()
    })
  })

  describe('triggerInboundSync', () => {
    it('should trigger sync and emit sync:incoming event', async () => {
      listener.startListening(testLocalPath, testRemotePath, testSshHost, testSshUser)

      const mockResult: RsyncResult = {
        success: true,
        bytesTransferred: 2345,
        filesSynced: 10
      }

      vi.mocked(mockRsyncManager.syncInbound).mockResolvedValue(mockResult)

      const incomingSpy = vi.fn()
      listener.on('sync:incoming', incomingSpy)

      const result = await listener.triggerInboundSync()

      expect(result.success).toBe(true)
      expect(incomingSpy).toHaveBeenCalledWith({
        timestamp: expect.any(Date),
        localPath: testLocalPath,
        remotePath: testRemotePath
      })
      expect(mockRsyncManager.syncInbound).toHaveBeenCalledWith(
        testRemotePath,
        testLocalPath,
        testSshHost,
        testSshUser
      )
    })

    it('should handle sync errors gracefully', async () => {
      listener.startListening(testLocalPath, testRemotePath, testSshHost, testSshUser)

      const mockError = new Error('Connection timeout')
      vi.mocked(mockRsyncManager.syncInbound).mockRejectedValue(mockError)

      const errorSpy = vi.fn()
      listener.on('sync:error', errorSpy)

      const result = await listener.triggerInboundSync()

      expect(result.success).toBe(false)
      expect(result.error).toBe('Connection timeout')
      expect(errorSpy).toHaveBeenCalledWith({
        timestamp: expect.any(Date),
        error: mockError
      })
    })

    it('should fail if not listening', async () => {
      const result = await listener.triggerInboundSync()

      expect(result.success).toBe(false)
      expect(result.error).toContain('not active')
    })
  })

  describe('triggerInboundSyncWithConflictCheck', () => {
    it('should trigger conflict-aware sync', async () => {
      listener.startListening(testLocalPath, testRemotePath, testSshHost, testSshUser)

      const mockResult: RsyncResult = {
        success: true,
        bytesTransferred: 3456,
        filesSynced: 8
      }

      vi.mocked(mockRsyncManager.syncInboundWithConflictCheck).mockResolvedValue(mockResult)

      const result = await listener.triggerInboundSyncWithConflictCheck()

      expect(result.success).toBe(true)
      expect(mockRsyncManager.syncInboundWithConflictCheck).toHaveBeenCalledWith(
        testRemotePath,
        testLocalPath,
        testSshHost,
        testSshUser
      )
    })

    it('should emit sync:incoming event', async () => {
      listener.startListening(testLocalPath, testRemotePath, testSshHost, testSshUser)

      vi.mocked(mockRsyncManager.syncInboundWithConflictCheck).mockResolvedValue({
        success: true,
        bytesTransferred: 100,
        filesSynced: 1
      })

      const incomingSpy = vi.fn()
      listener.on('sync:incoming', incomingSpy)

      await listener.triggerInboundSyncWithConflictCheck()

      expect(incomingSpy).toHaveBeenCalled()
    })

    it('should handle errors', async () => {
      listener.startListening(testLocalPath, testRemotePath, testSshHost, testSshUser)

      vi.mocked(mockRsyncManager.syncInboundWithConflictCheck).mockRejectedValue(
        new Error('Conflict detection failed')
      )

      const result = await listener.triggerInboundSyncWithConflictCheck()

      expect(result.success).toBe(false)
      expect(result.error).toContain('Conflict detection failed')
    })
  })

  describe('sync history', () => {
    it('should track successful sync in history', async () => {
      listener.startListening(testLocalPath, testRemotePath, testSshHost, testSshUser)

      vi.mocked(mockRsyncManager.syncInbound).mockResolvedValue({
        success: true,
        bytesTransferred: 5678,
        filesSynced: 15
      })

      await listener.triggerInboundSync()

      // Simulate RsyncManager emitting completion
      mockRsyncManager.emit('sync:complete', {
        direction: 'inbound',
        result: {
          success: true,
          bytesTransferred: 5678,
          filesSynced: 15
        }
      })

      const history = listener.getHistory()
      expect(history).toHaveLength(1)
      expect(history[0].success).toBe(true)
      expect(history[0].fileCount).toBe(15)
      expect(history[0].byteCount).toBe(5678)
      expect(history[0].timestamp).toBeInstanceOf(Date)
    })

    it('should track failed sync in history', async () => {
      listener.startListening(testLocalPath, testRemotePath, testSshHost, testSshUser)

      const mockError = new Error('Sync failed')
      vi.mocked(mockRsyncManager.syncInbound).mockRejectedValue(mockError)

      await listener.triggerInboundSync()

      // Simulate RsyncManager emitting error
      mockRsyncManager.emit('sync:error', {
        direction: 'inbound',
        error: mockError
      })

      const history = listener.getHistory()
      expect(history).toHaveLength(1)
      expect(history[0].success).toBe(false)
      expect(history[0].error).toBe('Sync failed')
    })

    it('should limit history to max entries (10)', async () => {
      listener.startListening(testLocalPath, testRemotePath, testSshHost, testSshUser)

      // Trigger 15 syncs
      for (let i = 0; i < 15; i++) {
        mockRsyncManager.emit('sync:complete', {
          direction: 'inbound',
          result: {
            success: true,
            bytesTransferred: 100 * i,
            filesSynced: i
          }
        })
      }

      const history = listener.getHistory()
      expect(history).toHaveLength(10)

      // Should keep newest entries (filesSynced 14, 13, 12, ...)
      expect(history[0].fileCount).toBe(14)
      expect(history[9].fileCount).toBe(5)
    })

    it('should only track inbound syncs (not outbound)', () => {
      listener.startListening(testLocalPath, testRemotePath, testSshHost, testSshUser)

      // Emit outbound sync completion
      mockRsyncManager.emit('sync:complete', {
        direction: 'outbound',
        result: {
          success: true,
          bytesTransferred: 1000,
          filesSynced: 5
        }
      })

      const history = listener.getHistory()
      expect(history).toHaveLength(0)
    })

    it('should calculate sync duration', async () => {
      listener.startListening(testLocalPath, testRemotePath, testSshHost, testSshUser)

      vi.mocked(mockRsyncManager.syncInbound).mockImplementation(async () => {
        // Simulate delay
        await new Promise((resolve) => setTimeout(resolve, 50))
        return {
          success: true,
          bytesTransferred: 100,
          filesSynced: 1
        }
      })

      await listener.triggerInboundSync()

      mockRsyncManager.emit('sync:complete', {
        direction: 'inbound',
        result: {
          success: true,
          bytesTransferred: 100,
          filesSynced: 1
        }
      })

      const history = listener.getHistory()
      expect(history[0].duration).toBeGreaterThan(0)
    })

    it('should emit sync:complete event with stats', async () => {
      listener.startListening(testLocalPath, testRemotePath, testSshHost, testSshUser)

      const completeSpy = vi.fn()
      listener.on('sync:complete', completeSpy)

      mockRsyncManager.emit('sync:complete', {
        direction: 'inbound',
        result: {
          success: true,
          bytesTransferred: 2048,
          filesSynced: 8
        }
      })

      expect(completeSpy).toHaveBeenCalledWith({
        timestamp: expect.any(Date),
        fileCount: 8,
        byteCount: 2048,
        duration: expect.any(Number)
      })
    })
  })

  describe('getStatus', () => {
    it('should return correct status when not listening', () => {
      const status = listener.getStatus()

      expect(status.isListening).toBe(false)
      expect(status.localPath).toBeUndefined()
      expect(status.sshHost).toBeUndefined()
      expect(status.lastSync).toBeUndefined()
      expect(status.totalSyncs).toBe(0)
    })

    it('should return correct status when listening', () => {
      listener.startListening(testLocalPath, testRemotePath, testSshHost, testSshUser)

      const status = listener.getStatus()

      expect(status.isListening).toBe(true)
      expect(status.localPath).toBe(testLocalPath)
      expect(status.sshHost).toBe(testSshHost)
    })

    it('should include last sync in status', () => {
      listener.startListening(testLocalPath, testRemotePath, testSshHost, testSshUser)

      mockRsyncManager.emit('sync:complete', {
        direction: 'inbound',
        result: {
          success: true,
          bytesTransferred: 512,
          filesSynced: 3
        }
      })

      const status = listener.getStatus()
      expect(status.lastSync).toBeDefined()
      expect(status.lastSync?.fileCount).toBe(3)
      expect(status.lastSync?.byteCount).toBe(512)
      expect(status.totalSyncs).toBe(1)
    })
  })

  describe('clearHistory', () => {
    it('should clear all history entries', () => {
      listener.startListening(testLocalPath, testRemotePath, testSshHost, testSshUser)

      // Add some history
      mockRsyncManager.emit('sync:complete', {
        direction: 'inbound',
        result: {
          success: true,
          bytesTransferred: 100,
          filesSynced: 1
        }
      })

      expect(listener.getHistory()).toHaveLength(1)

      listener.clearHistory()

      expect(listener.getHistory()).toHaveLength(0)
      expect(listener.getStatus().lastSync).toBeUndefined()
    })
  })

  describe('conflict events', () => {
    it('should forward sync:conflict events from RsyncManager', () => {
      const conflictSpy = vi.fn()
      listener.on('sync:conflict', conflictSpy)

      const conflictEvent = {
        files: [
          { path: 'file1.txt', hasUncommittedChanges: true },
          { path: 'file2.js', hasUncommittedChanges: true }
        ],
        localPath: testLocalPath,
        remotePath: testRemotePath
      }

      mockRsyncManager.emit('sync:conflict', conflictEvent)

      expect(conflictSpy).toHaveBeenCalledWith(conflictEvent)
    })
  })

  describe('dispose', () => {
    it('should stop listening and clean up resources', () => {
      listener.startListening(testLocalPath, testRemotePath, testSshHost, testSshUser)

      // Add history
      mockRsyncManager.emit('sync:complete', {
        direction: 'inbound',
        result: {
          success: true,
          bytesTransferred: 100,
          filesSynced: 1
        }
      })

      listener.dispose()

      const status = listener.getStatus()
      expect(status.isListening).toBe(false)
      expect(listener.getHistory()).toHaveLength(0)
    })

    it('should remove all event listeners', () => {
      const incomingSpy = vi.fn()
      const completeSpy = vi.fn()
      const errorSpy = vi.fn()

      listener.on('sync:incoming', incomingSpy)
      listener.on('sync:complete', completeSpy)
      listener.on('sync:error', errorSpy)

      listener.dispose()

      // Emit events after dispose
      mockRsyncManager.emit('sync:complete', {
        direction: 'inbound',
        result: { success: true, bytesTransferred: 100, filesSynced: 1 }
      })

      // Spies should not be called
      expect(incomingSpy).not.toHaveBeenCalled()
      expect(completeSpy).not.toHaveBeenCalled()
    })
  })
})
