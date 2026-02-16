import { v4 as uuid } from 'uuid'
import path from 'path'
import fs from 'fs'
import os from 'os'
import type { Session } from '@shared/types'

interface ExternalSessionInfo {
  folderPath: string
  agentType: 'copilot-cli' | 'claude-code'
  sourceFile: string
}

export class ExternalScanner {
  private homeDir: string

  constructor() {
    this.homeDir = os.homedir()
  }

  /**
   * Scan for externally-launched Copilot CLI and Claude Code sessions.
   * Returns Session objects with isExternal: true.
   */
  scan(knownFolderPaths: Set<string>): Session[] {
    const discovered: ExternalSessionInfo[] = []

    discovered.push(...this.scanClaudeCode())
    discovered.push(...this.scanCopilotCli())

    // Deduplicate against already-known sessions by folderPath
    const newSessions = discovered.filter(
      (info) => !knownFolderPaths.has(info.folderPath)
    )

    return newSessions.map((info) => this.createExternalSession(info))
  }

  /**
   * Scan Claude Code project directories.
   * Claude Code stores project data in ~/.claude/projects/<encoded-path>/
   */
  private scanClaudeCode(): ExternalSessionInfo[] {
    const results: ExternalSessionInfo[] = []
    const claudeDir = path.join(this.homeDir, '.claude', 'projects')

    if (!this.isDirectory(claudeDir)) return results

    try {
      const entries = fs.readdirSync(claudeDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        // Claude Code encodes the project path in the directory name
        // The directory name is the absolute path with path separators replaced
        const decodedPath = this.decodeClaudeProjectPath(entry.name)
        if (decodedPath && this.isDirectory(decodedPath)) {
          results.push({
            folderPath: decodedPath,
            agentType: 'claude-code',
            sourceFile: path.join(claudeDir, entry.name)
          })
        }
      }
    } catch {
      // Silently ignore scan errors (permissions, missing dirs, etc.)
    }

    return results
  }

  /**
   * Scan for Copilot CLI sessions.
   * Copilot CLI may store data in ~/.copilot-cli/ or similar locations.
   */
  private scanCopilotCli(): ExternalSessionInfo[] {
    const results: ExternalSessionInfo[] = []

    // Check common Copilot CLI paths
    const copilotDirs = [
      path.join(this.homeDir, '.copilot-cli'),
      path.join(this.homeDir, '.github-copilot', 'cli')
    ]

    for (const copilotDir of copilotDirs) {
      if (!this.isDirectory(copilotDir)) continue

      try {
        const entries = fs.readdirSync(copilotDir, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isDirectory()) continue

          // Attempt to interpret directory names as project paths
          const potentialPath = this.decodeCopilotProjectPath(entry.name)
          if (potentialPath && this.isDirectory(potentialPath)) {
            results.push({
              folderPath: potentialPath,
              agentType: 'copilot-cli',
              sourceFile: path.join(copilotDir, entry.name)
            })
          }
        }
      } catch {
        // Silently ignore scan errors
      }
    }

    return results
  }

  /**
   * Decode a Claude Code project directory name back to the original path.
   * Claude Code uses a dash-separated encoding of the path components.
   * Example: "D-git-myproject" -> "D:/git/myproject" (Windows)
   */
  private decodeClaudeProjectPath(dirName: string): string | null {
    try {
      // Claude Code encodes paths by replacing path separators with dashes
      // On Windows, "D:\git\project" becomes something like "D-git-project"
      const parts = dirName.split('-')
      if (parts.length < 2) return null

      if (process.platform === 'win32') {
        // First part is drive letter, rest are path segments
        const driveLetter = parts[0]
        if (driveLetter.length === 1 && /^[a-zA-Z]$/.test(driveLetter)) {
          const reconstructed = `${driveLetter}:${path.sep}${parts.slice(1).join(path.sep)}`
          return reconstructed
        }
      }

      // Unix-style: join with path separator, prepend /
      return `/${parts.join(path.sep)}`
    } catch {
      return null
    }
  }

  /**
   * Decode a Copilot CLI project directory name back to the original path.
   */
  private decodeCopilotProjectPath(dirName: string): string | null {
    // Similar encoding strategy to Claude Code
    return this.decodeClaudeProjectPath(dirName)
  }

  /**
   * Create a Session object for an externally-discovered agent.
   */
  private createExternalSession(info: ExternalSessionInfo): Session {
    const folderName = path.basename(info.folderPath)

    return {
      id: uuid(),
      kind: 'pty-agent',
      agentType: info.agentType,
      name: folderName,
      folderName,
      folderPath: info.folderPath,
      isRenamed: false,
      status: 'agent_ready',
      lastActivity: '',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      ptyId: '', // External sessions have no PTY
      isExternal: true,
      sourceFile: info.sourceFile
    }
  }

  private isDirectory(dirPath: string): boolean {
    try {
      return fs.statSync(dirPath).isDirectory()
    } catch {
      return false
    }
  }
}
