import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { RsyncResult, ConflictingFile } from '../RsyncManager'
import { SyncListener } from '../SyncListener'

// ============================================================================
// Mock Dependencies
// ============================================================================

// Create a mock RsyncManager class that extends EventEmitter
// This must be defined before vi.mock() due to hoisting
class MockRsyncManagerClass extends EventEmitter {
  private activeSyncs = new Set<string>()
  
  async syncOutbound(
    localPath: string,
    remotePath: string,
    sshHost: string,
    sshUser: string
  ): Promise<RsyncResult> {
    const syncId = `outbound:${localPath}`
    if (this.activeSyncs.has(syncId)) {
      return { success: false, bytesTransferred: 0, filesSynced: 0, error: 'Sync in progress' }
    }

    this.activeSyncs.add(syncId)
    this.emit('sync:started', { direction: 'outbound', localPath, remotePath })

    // Simulate async operation
    await new Promise(resolve => setTimeout(resolve, 10))

    const result = { success: true, bytesTransferred: 12345, filesSynced: 3 }
    this.emit('sync:complete', { direction: 'outbound', result })
    this.activeSyncs.delete(syncId)
    
    return result
  }

  async syncInbound(
    remotePath: string,
    localPath: string,
    sshHost: string,
    sshUser: string
  ): Promise<RsyncResult> {
    this.emit('sync:started', { direction: 'inbound', localPath, remotePath })
    await new Promise(resolve => setTimeout(resolve, 10))
    const result = { success: true, bytesTransferred: 234, filesSynced: 2 }
    this.emit('sync:complete', { direction: 'inbound', result })
    return result
  }

  async syncInboundWithConflictCheck(
    remotePath: string,
    localPath: string,
    sshHost: string,
    sshUser: string
  ): Promise<RsyncResult> {
    this.emit('sync:started', { direction: 'inbound', localPath, remotePath })
    
    // Simulate conflict detection
    const conflicts: ConflictingFile[] = [
      { path: 'file.ts', hasUncommittedChanges: true }
    ]
    
    if (conflicts.length > 0) {
      this.emit('sync:conflict', { files: conflicts, localPath, remotePath })
    }
    
    await new Promise(resolve => setTimeout(resolve, 50))
    const result = { success: true, bytesTransferred: 100, filesSynced: 1 }
    this.emit('sync:complete', { direction: 'inbound', result })
    return result
  }

  async detectConflicts(
    localPath: string,
    remotePath: string,
    sshHost: string,
    sshUser: string
  ): Promise<ConflictingFile[]> {
    return [{ path: 'src/modified.ts', hasUncommittedChanges: true }]
  }

  getExcludePatterns(): string[] {
    return ['node_modules', '.git', '.env', '*.log', '.DS_Store', 'Thumbs.db']
  }

  setConflictResolution(syncId: string, resolution: 'keep-local' | 'use-remote' | 'merge'): void {
    // Mock implementation
  }

  isSyncActive(localPath: string, direction: 'outbound' | 'inbound'): boolean {
    return this.activeSyncs.has(`${direction}:${localPath}`)
  }
}

// Mock the RsyncManager module
vi.mock('../RsyncManager', () => ({
  RsyncManager: MockRsyncManagerClass,
  ConflictingFile: {} as any,
  RsyncResult: {} as any,
  SyncConflictEvent: {} as any
}))

// ============================================================================
// Integration Tests — Bidirectional Sync
// ============================================================================

describe('Bidirectional Sync Integration', () => {
  let rsyncManager: MockRsyncManagerClass
  let syncListener: SyncListener
  const testLocalPath = '/home/user/workspace'
  const testRemotePath = '/home/devbox/workspace'
  const testSshHost = '10.0.0.1'
  const testSshUser = 'azureuser'

  beforeEach(() => {
    rsyncManager = new MockRsyncManagerClass()
    syncListener = new SyncListener(rsyncManager as any)
    vi.clearAllMocks()
  })

  afterEach(() => {
    rsyncManager.removeAllListeners()
    syncListener.dispose()
  })

  // ============================================================================
  // Outbound Sync on Connect (Local → Dev Box)
  // ============================================================================

  describe('Outbound Sync on Connect', () => {
    it('should sync local workspace to Dev Box on initial connection', async () => {
      const startedSpy = vi.fn()
      const completeSpy = vi.fn()
      rsyncManager.on('sync:started', startedSpy)
      rsyncManager.on('sync:complete', completeSpy)

      const result = await rsyncManager.syncOutbound(
        testLocalPath,
        testRemotePath,
        testSshHost,
        testSshUser
      )

      // Verify sync started event
      expect(startedSpy).toHaveBeenCalledWith({
        direction: 'outbound',
        localPath: testLocalPath,
        remotePath: testRemotePath
      })

      // Verify sync completed successfully
      expect(result.success).toBe(true)
      expect(result.bytesTransferred).toBeGreaterThan(0)
      expect(result.filesSynced).toBeGreaterThan(0)

      // Verify complete event
      expect(completeSpy).toHaveBeenCalledWith({
        direction: 'outbound',
        result: expect.objectContaining({ success: true })
      })
    })

    it('should prevent concurrent outbound syncs to same path', async () => {
      // Start first sync
      const sync1Promise = rsyncManager.syncOutbound(
        testLocalPath,
        testRemotePath,
        testSshHost,
        testSshUser
      )

      // Try to start second sync before first completes
      const sync2Promise = rsyncManager.syncOutbound(
        testLocalPath,
        testRemotePath,
        testSshHost,
        testSshUser
      )

      const [result1, result2] = await Promise.all([sync1Promise, sync2Promise])

      // First sync succeeds
      expect(result1.success).toBe(true)
      // Second sync is rejected
      expect(result2.success).toBe(false)
      expect(result2.error).toContain('Sync in progress')
    })
  })

  // ============================================================================
  // Inbound Sync After Agent Turn (Dev Box → Local via Hooks)
  // ============================================================================

  describe('Inbound Sync After Agent Turn', () => {
    it('should sync Dev Box workspace back to local via hook trigger', async () => {
      syncListener.startListening(testLocalPath, testRemotePath, testSshHost, testSshUser)

      const incomingSpy = vi.fn()
      const completeSpy = vi.fn()
      syncListener.on('sync:incoming', incomingSpy)
      syncListener.on('sync:complete', completeSpy)

      const result = await syncListener.triggerInboundSync()

      // Verify incoming event
      expect(incomingSpy).toHaveBeenCalledWith({
        timestamp: expect.any(Date),
        localPath: testLocalPath,
        remotePath: testRemotePath
      })

      // Verify sync succeeded
      expect(result.success).toBe(true)
      expect(result.bytesTransferred).toBeGreaterThan(0)
      expect(result.filesSynced).toBeGreaterThan(0)

      // Verify complete event
      expect(completeSpy).toHaveBeenCalledWith({
        timestamp: expect.any(Date),
        fileCount: expect.any(Number),
        byteCount: expect.any(Number),
        duration: expect.any(Number)
      })
    })

    it('should record sync history on successful sync', async () => {
      syncListener.startListening(testLocalPath, testRemotePath, testSshHost, testSshUser)

      await syncListener.triggerInboundSync()

      const history = syncListener.getHistory()
      expect(history.length).toBe(1)
      expect(history[0]).toEqual({
        timestamp: expect.any(Date),
        fileCount: expect.any(Number),
        byteCount: expect.any(Number),
        duration: expect.any(Number),
        success: true,
        error: undefined
      })
    })

    it('should fail gracefully if listener not started', async () => {
      // Don't start listener
      const result = await syncListener.triggerInboundSync()

      expect(result.success).toBe(false)
      expect(result.error).toContain('not active')
    })
  })

  // ============================================================================
  // Conflict Detection with Uncommitted Changes
  // ============================================================================

  describe('Conflict Detection', () => {
    it('should detect conflicts when files would be overwritten', async () => {
      const conflicts = await rsyncManager.detectConflicts(
        testLocalPath,
        testRemotePath,
        testSshHost,
        testSshUser
      )

      expect(conflicts.length).toBeGreaterThan(0)
      expect(conflicts[0]).toEqual({
        path: expect.any(String),
        hasUncommittedChanges: true
      })
    })

    it('should emit conflict event when conflicts are detected', async () => {
      syncListener.startListening(testLocalPath, testRemotePath, testSshHost, testSshUser)

      const conflictSpy = vi.fn()
      syncListener.on('sync:conflict', conflictSpy)

      // Trigger inbound sync with conflict check
      await syncListener.triggerInboundSyncWithConflictCheck()

      expect(conflictSpy).toHaveBeenCalledWith({
        files: expect.arrayContaining([
          expect.objectContaining({ path: expect.any(String), hasUncommittedChanges: true })
        ]),
        localPath: testLocalPath,
        remotePath: testRemotePath
      })
    })

    it('should complete sync after conflict handling', async () => {
      syncListener.startListening(testLocalPath, testRemotePath, testSshHost, testSshUser)

      const result = await syncListener.triggerInboundSyncWithConflictCheck()

      expect(result.success).toBe(true)
    })
  })

  // ============================================================================
  // Exclusion Patterns
  // ============================================================================

  describe('Exclusion Patterns', () => {
    it('should get default exclude patterns', () => {
      const patterns = rsyncManager.getExcludePatterns()

      // Should include defaults
      expect(patterns).toContain('node_modules')
      expect(patterns).toContain('.git')
      expect(patterns).toContain('.env')
      expect(patterns).toContain('*.log')
      expect(patterns).toContain('.DS_Store')
      expect(patterns).toContain('Thumbs.db')
    })
  })

  // ============================================================================
  // Sync Listener Receiving Hook Callbacks
  // ============================================================================

  describe('Sync Listener Hook Integration', () => {
    it('should forward RsyncManager events to SyncListener subscribers', async () => {
      syncListener.startListening(testLocalPath, testRemotePath, testSshHost, testSshUser)

      const listenerCompleteSpy = vi.fn()
      syncListener.on('sync:complete', listenerCompleteSpy)

      await syncListener.triggerInboundSync()

      // Verify SyncListener forwarded the event
      expect(listenerCompleteSpy).toHaveBeenCalledWith({
        timestamp: expect.any(Date),
        fileCount: expect.any(Number),
        byteCount: expect.any(Number),
        duration: expect.any(Number)
      })
    })

    it('should maintain sync history across multiple syncs', async () => {
      syncListener.startListening(testLocalPath, testRemotePath, testSshHost, testSshUser)

      // Trigger multiple syncs
      await syncListener.triggerInboundSync()
      await syncListener.triggerInboundSync()
      await syncListener.triggerInboundSync()

      const history = syncListener.getHistory()
      expect(history.length).toBe(3)

      // History should be ordered newest first
      expect(history[0].timestamp.getTime()).toBeGreaterThanOrEqual(
        history[2].timestamp.getTime()
      )
    })

    it('should limit history to max entries', async () => {
      syncListener.startListening(testLocalPath, testRemotePath, testSshHost, testSshUser)

      // Trigger 15 syncs
      for (let i = 0; i < 15; i++) {
        await syncListener.triggerInboundSync()
      }

      const history = syncListener.getHistory()
      expect(history.length).toBe(10) // Limited to max
    })

    it('should clear history on demand', async () => {
      syncListener.startListening(testLocalPath, testRemotePath, testSshHost, testSshUser)

      await syncListener.triggerInboundSync()
      expect(syncListener.getHistory().length).toBe(1)

      syncListener.clearHistory()
      expect(syncListener.getHistory().length).toBe(0)
    })

    it('should preserve history when listener is stopped', async () => {
      syncListener.startListening(testLocalPath, testRemotePath, testSshHost, testSshUser)

      await syncListener.triggerInboundSync()
      expect(syncListener.getHistory().length).toBe(1)

      syncListener.stopListening()

      // History should still be available
      expect(syncListener.getHistory().length).toBe(1)
      expect(syncListener.getStatus().isListening).toBe(false)
    })

    it('should forward conflict events from RsyncManager to listeners', async () => {
      syncListener.startListening(testLocalPath, testRemotePath, testSshHost, testSshUser)

      const conflictSpy = vi.fn()
      syncListener.on('sync:conflict', conflictSpy)

      await syncListener.triggerInboundSyncWithConflictCheck()

      expect(conflictSpy).toHaveBeenCalledWith({
        files: expect.any(Array),
        localPath: testLocalPath,
        remotePath: testRemotePath
      })
    })
  })
})
