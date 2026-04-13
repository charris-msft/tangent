import { EventEmitter } from 'events'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { DevBoxSyncConfig } from '../../shared/devbox-types'

const nodeRsync = require('node-rsync')

// === Constants ===

const DEFAULT_EXCLUDES = ['node_modules', '.git', '.env', '*.log', '.DS_Store', 'Thumbs.db']
const CONFIG_PATH = path.join(os.homedir(), '.tangent-2', 'sync-config.json')

// === Types ===

export interface RsyncProgress {
  bytesTransferred: number
  filesSynced: number
  currentFile?: string
}

export interface RsyncResult {
  success: boolean
  bytesTransferred: number
  filesSynced: number
  error?: string
}

// === RsyncManager ===

/**
 * Orchestrates bidirectional rsync for workspace sync between local machine and Dev Box.
 * 
 * Local-as-primary model:
 * - syncOutbound: local → Dev Box (on connect)
 * - syncInbound: Dev Box → local (after agent turn)
 * 
 * Events:
 * - sync:started - { direction: 'outbound' | 'inbound', localPath, remotePath }
 * - sync:progress - { bytesTransferred, filesSynced, currentFile }
 * - sync:complete - { direction, result: RsyncResult }
 * - sync:error - { direction, error: Error }
 */
export class RsyncManager extends EventEmitter {
  private excludePatterns: string[] = []
  private activeSyncs: Set<string> = new Set()

  constructor() {
    super()
    this.loadExclusions()
  }

  /**
   * Sync local workspace to Dev Box (outbound).
   * Local → Dev Box
   */
  async syncOutbound(
    localPath: string,
    remotePath: string,
    sshHost: string,
    sshUser: string
  ): Promise<RsyncResult> {
    const syncId = `outbound:${localPath}`
    if (this.activeSyncs.has(syncId)) {
      console.warn('[Tangent 2] Sync already in progress for', localPath)
      return { success: false, bytesTransferred: 0, filesSynced: 0, error: 'Sync in progress' }
    }

    this.activeSyncs.add(syncId)
    this.emit('sync:started', { direction: 'outbound', localPath, remotePath })

    try {
      const result = await this.executeRsync(localPath, remotePath, sshHost, sshUser, 'outbound')
      this.emit('sync:complete', { direction: 'outbound', result })
      return result
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      console.warn('[Tangent 2] Outbound sync failed:', err.message)
      this.emit('sync:error', { direction: 'outbound', error: err })
      return { success: false, bytesTransferred: 0, filesSynced: 0, error: err.message }
    } finally {
      this.activeSyncs.delete(syncId)
    }
  }

  /**
   * Sync Dev Box workspace to local (inbound).
   * Dev Box → Local
   */
  async syncInbound(
    remotePath: string,
    localPath: string,
    sshHost: string,
    sshUser: string
  ): Promise<RsyncResult> {
    const syncId = `inbound:${localPath}`
    if (this.activeSyncs.has(syncId)) {
      console.warn('[Tangent 2] Sync already in progress for', localPath)
      return { success: false, bytesTransferred: 0, filesSynced: 0, error: 'Sync in progress' }
    }

    this.activeSyncs.add(syncId)
    this.emit('sync:started', { direction: 'inbound', localPath, remotePath })

    try {
      const result = await this.executeRsync(remotePath, localPath, sshHost, sshUser, 'inbound')
      this.emit('sync:complete', { direction: 'inbound', result })
      return result
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      console.warn('[Tangent 2] Inbound sync failed:', err.message)
      this.emit('sync:error', { direction: 'inbound', error: err })
      return { success: false, bytesTransferred: 0, filesSynced: 0, error: err.message }
    } finally {
      this.activeSyncs.delete(syncId)
    }
  }

  /**
   * Execute rsync command with configured options.
   */
  private async executeRsync(
    source: string,
    destination: string,
    sshHost: string,
    sshUser: string,
    direction: 'outbound' | 'inbound'
  ): Promise<RsyncResult> {
    return new Promise((resolve, reject) => {
      // Build exclude options
      const allExcludes = [...DEFAULT_EXCLUDES, ...this.excludePatterns]
      const excludeOptions = allExcludes.map((pattern) => `--exclude="${pattern}"`).join(' ')

      // Build rsync parameters
      const isRemoteSource = direction === 'inbound'
      const isRemoteDest = direction === 'outbound'

      const remoteSource = isRemoteSource ? `${sshUser}@${sshHost}:${source}` : source
      const remoteDest = isRemoteDest ? `${sshUser}@${sshHost}:${destination}` : destination

      const params = {
        flags: 'avz', // archive, verbose, compress
        options: `--delete ${excludeOptions} -e "ssh -o StrictHostKeyChecking=no"`,
        source: remoteSource,
        destination: remoteDest
      }

      let bytesTransferred = 0
      let filesSynced = 0

      // Execute rsync
      nodeRsync.execute(
        params,
        (stdout: string) => {
          // Parse stdout for progress
          const progress = this.parseRsyncOutput(stdout)
          bytesTransferred = progress.bytesTransferred
          filesSynced = progress.filesSynced

          // Emit progress events
          if (progress.currentFile) {
            this.emit('sync:progress', progress)
          }

          resolve({ success: true, bytesTransferred, filesSynced })
        },
        (error: Error) => {
          reject(error)
        }
      )
    })
  }

  /**
   * Parse rsync output for progress information.
   * Example line: "file.txt 1,234 100% 1.23MB/s 0:00:01"
   */
  private parseRsyncOutput(stdout: string): RsyncProgress {
    const lines = stdout.split('\n').filter((line) => line.trim())
    let bytesTransferred = 0
    let filesSynced = 0
    let currentFile: string | undefined

    for (const line of lines) {
      // Count files synced (non-directory entries)
      if (line.match(/^\S+\s+\d+/)) {
        filesSynced++
        // Extract filename from beginning of line
        const match = line.match(/^(\S+)/)
        if (match) {
          currentFile = match[1]
        }
      }

      // Extract bytes from summary line
      // "sent 1,234 bytes  received 567 bytes  360.20 bytes/sec"
      const bytesMatch = line.match(/sent\s+([\d,]+)\s+bytes/)
      if (bytesMatch) {
        bytesTransferred = parseInt(bytesMatch[1].replace(/,/g, ''), 10)
      }
    }

    return { bytesTransferred, filesSynced, currentFile }
  }

  /**
   * Load exclude patterns from sync-config.json.
   * Falls back to defaults if config file doesn't exist.
   */
  private loadExclusions(): void {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const configData = fs.readFileSync(CONFIG_PATH, 'utf8')
        const config: DevBoxSyncConfig = JSON.parse(configData)

        if (config.version === 1 && Array.isArray(config.excludePatterns)) {
          this.excludePatterns = config.excludePatterns
        }
      }
    } catch (error) {
      console.warn('[Tangent 2] Failed to load sync config, using defaults:', error)
      this.excludePatterns = []
    }
  }

  /**
   * Get current exclude patterns (defaults + config).
   */
  getExcludePatterns(): string[] {
    return [...DEFAULT_EXCLUDES, ...this.excludePatterns]
  }

  /**
   * Check if a sync is currently active for a given path.
   */
  isSyncActive(localPath: string, direction: 'outbound' | 'inbound'): boolean {
    const syncId = `${direction}:${localPath}`
    return this.activeSyncs.has(syncId)
  }
}
