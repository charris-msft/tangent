import { EventEmitter } from 'events'
import { RsyncManager, RsyncResult } from './RsyncManager'

// === Types ===

export interface SyncHistoryEntry {
  timestamp: Date
  fileCount: number
  byteCount: number
  duration: number
  success: boolean
  error?: string
}

export interface SyncListenerStatus {
  isListening: boolean
  localPath?: string
  sshHost?: string
  lastSync?: SyncHistoryEntry
  totalSyncs: number
}

// === SyncListener ===

/**
 * Listens for and orchestrates incoming sync requests from Dev Box hooks.
 *
 * When agentStop hook fires on Dev Box, it triggers rsync back to local machine.
 * SyncListener wraps RsyncManager.syncInbound() and monitors for hook-triggered syncs.
 *
 * Events:
 * - sync:incoming - { timestamp: Date, localPath: string, remotePath: string }
 * - sync:complete - { timestamp: Date, fileCount: number, byteCount: number, duration: number }
 * - sync:error - { timestamp: Date, error: Error }
 */
export class SyncListener extends EventEmitter {
  private rsyncManager: RsyncManager
  private isActive: boolean = false
  private localPath?: string
  private remotePath?: string
  private sshHost?: string
  private sshUser?: string
  private syncHistory: SyncHistoryEntry[] = []
  private maxHistoryEntries: number = 10
  private currentSyncStart?: Date

  constructor(rsyncManager?: RsyncManager) {
    super()
    this.rsyncManager = rsyncManager || new RsyncManager()
    this.setupRsyncListeners()
  }

  /**
   * Start listening for incoming syncs from Dev Box.
   * Sets up sync configuration and enables inbound sync monitoring.
   */
  startListening(
    localPath: string,
    remotePath: string,
    sshHost: string,
    sshUser: string = 'azureuser'
  ): void {
    if (this.isActive) {
      console.warn('[Tangent] SyncListener already active for', this.localPath)
      return
    }

    this.localPath = localPath
    this.remotePath = remotePath
    this.sshHost = sshHost
    this.sshUser = sshUser
    this.isActive = true

    console.log('[Tangent] SyncListener started for', localPath, '→', sshHost)
  }

  /**
   * Stop listening for incoming syncs.
   * Cleans up listeners but preserves sync history.
   */
  stopListening(): void {
    if (!this.isActive) {
      return
    }

    this.isActive = false
    this.localPath = undefined
    this.remotePath = undefined
    this.sshHost = undefined
    this.sshUser = undefined

    console.log('[Tangent] SyncListener stopped')
  }

  /**
   * Manually trigger an incoming sync.
   * Called when Dev Box hook fires and initiates rsync.
   */
  async triggerInboundSync(): Promise<RsyncResult> {
    if (!this.isActive || !this.localPath || !this.remotePath || !this.sshHost || !this.sshUser) {
      const error = 'SyncListener not active or not configured'
      console.warn('[Tangent]', error)
      return {
        success: false,
        bytesTransferred: 0,
        filesSynced: 0,
        error
      }
    }

    this.currentSyncStart = new Date()

    this.emit('sync:incoming', {
      timestamp: this.currentSyncStart,
      localPath: this.localPath,
      remotePath: this.remotePath
    })

    try {
      const result = await this.rsyncManager.syncInbound(
        this.remotePath,
        this.localPath,
        this.sshHost,
        this.sshUser
      )

      return result
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      console.warn('[Tangent] Inbound sync failed:', err.message)

      this.emit('sync:error', {
        timestamp: new Date(),
        error: err
      })

      return {
        success: false,
        bytesTransferred: 0,
        filesSynced: 0,
        error: err.message
      }
    }
  }

  /**
   * Trigger inbound sync with conflict detection enabled.
   * Emits conflict events if files would be overwritten.
   */
  async triggerInboundSyncWithConflictCheck(): Promise<RsyncResult> {
    if (!this.isActive || !this.localPath || !this.remotePath || !this.sshHost || !this.sshUser) {
      const error = 'SyncListener not active or not configured'
      console.warn('[Tangent]', error)
      return {
        success: false,
        bytesTransferred: 0,
        filesSynced: 0,
        error
      }
    }

    this.currentSyncStart = new Date()

    this.emit('sync:incoming', {
      timestamp: this.currentSyncStart,
      localPath: this.localPath,
      remotePath: this.remotePath
    })

    try {
      const result = await this.rsyncManager.syncInboundWithConflictCheck(
        this.remotePath,
        this.localPath,
        this.sshHost,
        this.sshUser
      )

      return result
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      console.warn('[Tangent] Inbound sync with conflict check failed:', err.message)

      this.emit('sync:error', {
        timestamp: new Date(),
        error: err
      })

      return {
        success: false,
        bytesTransferred: 0,
        filesSynced: 0,
        error: err.message
      }
    }
  }

  /**
   * Get sync history (last N syncs).
   */
  getHistory(): SyncHistoryEntry[] {
    return [...this.syncHistory]
  }

  /**
   * Get listener status.
   */
  getStatus(): SyncListenerStatus {
    return {
      isListening: this.isActive,
      localPath: this.localPath,
      sshHost: this.sshHost,
      lastSync: this.syncHistory.length > 0 ? this.syncHistory[0] : undefined,
      totalSyncs: this.syncHistory.length
    }
  }

  /**
   * Clear sync history.
   */
  clearHistory(): void {
    this.syncHistory = []
  }

  /**
   * Set up listeners for RsyncManager events.
   */
  private setupRsyncListeners(): void {
    // Listen for sync completion
    this.rsyncManager.on('sync:complete', (event: { direction: string; result: RsyncResult }) => {
      // Only track inbound syncs
      if (event.direction !== 'inbound') {
        return
      }

      const duration = this.currentSyncStart
        ? Date.now() - this.currentSyncStart.getTime()
        : 0

      const entry: SyncHistoryEntry = {
        timestamp: new Date(),
        fileCount: event.result.filesSynced,
        byteCount: event.result.bytesTransferred,
        duration,
        success: event.result.success,
        error: event.result.error
      }

      // Add to history (newest first)
      this.syncHistory.unshift(entry)

      // Trim history to max entries
      if (this.syncHistory.length > this.maxHistoryEntries) {
        this.syncHistory = this.syncHistory.slice(0, this.maxHistoryEntries)
      }

      // Emit sync:complete event
      this.emit('sync:complete', {
        timestamp: entry.timestamp,
        fileCount: entry.fileCount,
        byteCount: entry.byteCount,
        duration: entry.duration
      })

      this.currentSyncStart = undefined
    })

    // Listen for sync errors
    this.rsyncManager.on('sync:error', (event: { direction: string; error: Error }) => {
      if (event.direction !== 'inbound') {
        return
      }

      const entry: SyncHistoryEntry = {
        timestamp: new Date(),
        fileCount: 0,
        byteCount: 0,
        duration: this.currentSyncStart ? Date.now() - this.currentSyncStart.getTime() : 0,
        success: false,
        error: event.error.message
      }

      this.syncHistory.unshift(entry)

      if (this.syncHistory.length > this.maxHistoryEntries) {
        this.syncHistory = this.syncHistory.slice(0, this.maxHistoryEntries)
      }

      this.emit('sync:error', {
        timestamp: entry.timestamp,
        error: event.error
      })

      this.currentSyncStart = undefined
    })

    // Forward conflict events
    this.rsyncManager.on('sync:conflict', (event) => {
      this.emit('sync:conflict', event)
    })
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    this.stopListening()
    this.rsyncManager.removeAllListeners()
    this.removeAllListeners()
    this.syncHistory = []
  }
}
