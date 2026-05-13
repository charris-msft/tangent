import { EventEmitter } from 'events'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { spawn } from 'child_process'
import { DevBoxSyncConfig } from '../../shared/devbox-types'
import * as nodeRsync from 'node-rsync'

// === Constants ===

const DEFAULT_EXCLUDES = ['node_modules', '.git', '.env', '*.log', '.DS_Store', 'Thumbs.db']
const CONFIG_PATH = path.join(os.homedir(), '.tangent', 'sync-config.json')

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

export type SyncConflictResolution = 'keep-local' | 'use-remote' | 'merge'

export interface ConflictingFile {
  path: string
  hasUncommittedChanges: boolean
}

export interface SyncConflictEvent {
  files: ConflictingFile[]
  localPath: string
  remotePath: string
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
 * - sync:conflict - { files: ConflictingFile[], localPath, remotePath }
 */
export class RsyncManager extends EventEmitter {
  private excludePatterns: string[] = []
  private activeSyncs: Set<string> = new Set()
  private conflictResolutions: Map<string, SyncConflictResolution> = new Map()

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
      console.warn('[Tangent] Sync already in progress for', localPath)
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
      console.warn('[Tangent] Outbound sync failed:', err.message)
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
      console.warn('[Tangent] Sync already in progress for', localPath)
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
      console.warn('[Tangent] Inbound sync failed:', err.message)
      this.emit('sync:error', { direction: 'inbound', error: err })
      return { success: false, bytesTransferred: 0, filesSynced: 0, error: err.message }
    } finally {
      this.activeSyncs.delete(syncId)
    }
  }

  /**
   * Sync Dev Box workspace to local with conflict detection (inbound).
   * Checks for conflicts before applying sync and waits for user resolution.
   * Dev Box → Local
   */
  async syncInboundWithConflictCheck(
    remotePath: string,
    localPath: string,
    sshHost: string,
    sshUser: string
  ): Promise<RsyncResult> {
    const syncId = `inbound:${localPath}`
    if (this.activeSyncs.has(syncId)) {
      console.warn('[Tangent] Sync already in progress for', localPath)
      return { success: false, bytesTransferred: 0, filesSynced: 0, error: 'Sync in progress' }
    }

    // Detect conflicts first
    const conflicts = await this.detectConflicts(localPath, remotePath, sshHost, sshUser)

    if (conflicts.length > 0) {
      // Emit conflict event and wait for resolution
      this.emit('sync:conflict', {
        files: conflicts,
        localPath,
        remotePath
      } as SyncConflictEvent)

      // Wait for resolution to be set
      const resolution = await this.waitForConflictResolution(syncId)

      // Apply resolution
      switch (resolution) {
        case 'keep-local':
          // Skip conflicting files - add them to exclude list temporarily
          return this.syncInboundWithExclusions(
            remotePath,
            localPath,
            sshHost,
            sshUser,
            conflicts.map((c) => c.path)
          )
        case 'use-remote':
          // Proceed with normal sync (overwrite local)
          return this.syncInbound(remotePath, localPath, sshHost, sshUser)
        case 'merge':
          // For now, delegate to VS Code diff - this is a UI concern
          // Just proceed with sync and let user handle merge manually
          return this.syncInbound(remotePath, localPath, sshHost, sshUser)
      }
    }

    // No conflicts, proceed normally
    return this.syncInbound(remotePath, localPath, sshHost, sshUser)
  }

  /**
   * Detect conflicts between local and remote files.
   * Returns list of files that would be overwritten and have uncommitted changes.
   */
  async detectConflicts(
    localPath: string,
    remotePath: string,
    sshHost: string,
    sshUser: string
  ): Promise<ConflictingFile[]> {
    try {
      // Step 1: Run rsync --dry-run to get list of files that would change
      const filesToChange = await this.getRsyncDryRunFiles(
        remotePath,
        localPath,
        sshHost,
        sshUser
      )

      if (filesToChange.length === 0) {
        return []
      }

      // Step 2: Check which files have uncommitted changes
      const uncommittedFiles = await this.getUncommittedFiles(localPath)

      // Step 3: Find intersection
      const conflicts: ConflictingFile[] = []
      for (const file of filesToChange) {
        if (uncommittedFiles.has(file)) {
          conflicts.push({
            path: file,
            hasUncommittedChanges: true
          })
        }
      }

      return conflicts
    } catch (error) {
      console.warn('[Tangent] Conflict detection failed:', error)
      return []
    }
  }

  /**
   * Run rsync --dry-run to get list of files that would be changed.
   */
  private async getRsyncDryRunFiles(
    remotePath: string,
    localPath: string,
    sshHost: string,
    sshUser: string
  ): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const allExcludes = [...DEFAULT_EXCLUDES, ...this.excludePatterns]
      const excludeArgs = allExcludes.flatMap((pattern) => ['--exclude', pattern])

      const args = [
        '--dry-run',
        '--itemize-changes',
        '-avz',
        '--delete',
        ...excludeArgs,
        '-e',
        'ssh -o StrictHostKeyChecking=no',
        `${sshUser}@${sshHost}:${remotePath}`,
        localPath
      ]

      const rsync = spawn('rsync', args, { shell: true })
      let stdout = ''
      let stderr = ''

      rsync.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      rsync.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      rsync.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`rsync dry-run failed: ${stderr}`))
          return
        }

        // Parse itemize-changes output
        // Format: YXcstpoguax  path/to/file
        // Y is the type of update (e.g., '>' for received file, 'c' for changed)
        const files: string[] = []
        const lines = stdout.split('\n')

        for (const line of lines) {
          // Match lines that indicate file changes
          // '>f' = file received, 'cf' = changed file
          const match = line.match(/^[>.c]f[^ ]+ (.+)$/)
          if (match) {
            files.push(match[1])
          }
        }

        resolve(files)
      })
    })
  }

  /**
   * Get list of files with uncommitted changes from git.
   */
  private async getUncommittedFiles(localPath: string): Promise<Set<string>> {
    return new Promise((resolve) => {
      const git = spawn('git', ['status', '--porcelain'], {
        cwd: localPath,
        shell: true
      })

      let stdout = ''

      git.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      git.on('close', (code) => {
        if (code !== 0) {
          // Not a git repo or git failed
          resolve(new Set())
          return
        }

        // Parse git status output
        // Format: XY filename
        const files = new Set<string>()
        const lines = stdout.split('\n')

        for (const line of lines) {
          if (line.trim()) {
            // Extract filename (after status codes)
            const match = line.match(/^..\s+(.+)$/)
            if (match) {
              files.add(match[1])
            }
          }
        }

        resolve(files)
      })
    })
  }

  /**
   * Sync inbound but exclude specific files.
   */
  private async syncInboundWithExclusions(
    remotePath: string,
    localPath: string,
    sshHost: string,
    sshUser: string,
    excludeFiles: string[]
  ): Promise<RsyncResult> {
    const syncId = `inbound:${localPath}`
    this.activeSyncs.add(syncId)
    this.emit('sync:started', { direction: 'inbound', localPath, remotePath })

    try {
      // Temporarily add files to exclude patterns
      const originalExcludes = [...this.excludePatterns]
      this.excludePatterns = [...this.excludePatterns, ...excludeFiles]

      const result = await this.executeRsync(remotePath, localPath, sshHost, sshUser, 'inbound')

      // Restore original excludes
      this.excludePatterns = originalExcludes

      this.emit('sync:complete', { direction: 'inbound', result })
      return result
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      console.warn('[Tangent] Inbound sync with exclusions failed:', err.message)
      this.emit('sync:error', { direction: 'inbound', error: err })
      return { success: false, bytesTransferred: 0, filesSynced: 0, error: err.message }
    } finally {
      this.activeSyncs.delete(syncId)
    }
  }

  /**
   * Set conflict resolution choice for a pending sync.
   */
  setConflictResolution(syncId: string, resolution: SyncConflictResolution): void {
    this.conflictResolutions.set(syncId, resolution)
  }

  /**
   * Wait for conflict resolution to be set.
   * Returns after resolution is provided or times out after 5 minutes.
   */
  private async waitForConflictResolution(syncId: string): Promise<SyncConflictResolution> {
    const timeout = 5 * 60 * 1000 // 5 minutes
    const startTime = Date.now()

    while (Date.now() - startTime < timeout) {
      const resolution = this.conflictResolutions.get(syncId)
      if (resolution) {
        this.conflictResolutions.delete(syncId)
        return resolution
      }
      // Poll every 100ms
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    // Default to keep-local on timeout
    console.warn('[Tangent] Conflict resolution timed out, defaulting to keep-local')
    return 'keep-local'
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
      console.warn('[Tangent] Failed to load sync config, using defaults:', error)
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
