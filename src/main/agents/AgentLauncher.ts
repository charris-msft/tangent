import type { AgentProfile } from '@shared/types'
import type { PtyManager } from '../pty/PtyManager'
import type { SessionStore } from '../session/SessionStore'
import type { SessionManager } from '../session/SessionManager'
import type { RemoteSessionManager } from '../session/RemoteSessionManager'
import { existsSync } from 'fs'

function psEscape(value: string): string {
  return value.replace(/'/g, "''")
}

// Local dev build of Copilot CLI — used by Tangent only, not installed globally
const LOCAL_CLI_PATH = 'D:\\git\\tools\\copilot-agent-runtime\\dist-cli\\index.js'

function isCopilotAgent(agent: AgentProfile): boolean {
  return agent.command.includes('copilot')
}

function resolveCopilotCommand(agent: AgentProfile): string {
  // Use local dev build if available
  if (isCopilotAgent(agent) && existsSync(LOCAL_CLI_PATH)) {
    return `node '${psEscape(LOCAL_CLI_PATH)}'`
  }
  return agent.command
}

export class AgentLauncher {
  constructor(
    private ptyManager: PtyManager,
    private sessionStore: SessionStore,
    private sessionManager: SessionManager,
    private remoteSessionManager?: RemoteSessionManager
  ) {}

  launch(agent: AgentProfile, sessionId: string): void {
    // P4.6: Check if this is a remote agent and delegate to RemoteSessionManager
    if (agent.remote?.enabled) {
      this._launchRemote(agent, sessionId)
      return
    }

    // Original local launch path
    this._launchLocal(agent, sessionId)
  }

  private _launchLocal(agent: AgentProfile, sessionId: string): void {
    let targetSessionId = sessionId

    if (agent.launchTarget === 'newTab') {
      const currentSession = this.sessionStore.get(sessionId)
      if (!currentSession) return
      const newSession = this.sessionManager.create(currentSession.folderPath)
      targetSessionId = newSession.id
    } else if (agent.launchTarget === 'path' && agent.cwdPath) {
      const newSession = this.sessionManager.create(agent.cwdPath)
      targetSessionId = newSession.id
    }

    const targetSession = this.sessionStore.get(targetSessionId)
    if (!targetSession) return

    const lines: string[] = []

    if (agent.env) {
      for (const [key, value] of Object.entries(agent.env)) {
        lines.push(`$env:${key} = '${psEscape(value)}'`)
      }
    }

    // For Copilot agents, append --ui-server --port 0 to enable hybrid PTY+SDK mode
    // These flags are added to the PTY command only, NOT saved in launch info
    const isCopilot = isCopilotAgent(agent)
    const extraArgs = isCopilot ? ['--ui-server', '--port', '0'] : []
    const cmdArgs = [...agent.args, ...extraArgs]

    const resolvedCmd = resolveCopilotCommand(agent)
    const args = cmdArgs.map(a => `'${psEscape(a)}'`).join(' ')
    const cmd = args ? `${resolvedCmd} ${args}` : resolvedCmd
    lines.push(cmd)

    const payload = lines.join('\r') + '\r'
    this.ptyManager.write(targetSession.ptyId, payload)

    const agentType = isCopilot ? 'copilot-cli' as const
                    : agent.command.includes('claude') ? 'claude-code' as const
                    : 'shell' as const

    // Name the session after the agent shortcut (sticky so CWD changes don't override)
    this.sessionStore.rename(targetSessionId, agent.name)

    if (agentType !== 'shell') {
      this.sessionStore.promoteToAgent(targetSessionId, agentType)
      // Save original args (without --ui-server flags) for display and restore
      this.sessionStore.setAgentLaunchInfo(targetSessionId, agent.command, agent.args, agent.env)
    }

    // For Copilot, attach the SDK to watch for the ui-server port
    if (isCopilot && this.sessionManager.sdkManager) {
      this.sessionManager.sdkManager.attachToSession(targetSessionId, targetSession.ptyId)
    }
  }

  /**
   * Launch an agent remotely on a Dev Box via RemoteSessionManager.
   * P4.6: Remote agent routing
   */
  private async _launchRemote(agent: AgentProfile, sessionId: string): Promise<void> {
    if (!this.remoteSessionManager) {
      console.warn('[Tangent 2] AgentLauncher: Remote agent requested but RemoteSessionManager not available')
      return
    }

    if (!agent.remote?.enabled) {
      console.warn('[Tangent 2] AgentLauncher: _launchRemote called without remote.enabled')
      return
    }

    // Determine target workspace path
    let localPath: string

    if (agent.launchTarget === 'path' && agent.cwdPath) {
      // Use explicit path from agent profile
      localPath = agent.cwdPath
    } else {
      // Use current session's folder path
      const currentSession = this.sessionStore.get(sessionId)
      if (!currentSession) {
        console.warn('[Tangent 2] AgentLauncher: Current session not found for remote launch')
        return
      }
      localPath = currentSession.folderPath
    }

    try {
      console.log(`[Tangent 2] AgentLauncher: Launching remote agent ${agent.name} at ${localPath}`)
      
      // RemoteSessionManager handles full lifecycle:
      // - Dev Box start
      // - Provisioning check
      // - Workspace sync
      // - ACP session creation
      await this.remoteSessionManager.createRemoteSession(agent, localPath)
      
      console.log(`[Tangent 2] AgentLauncher: Remote agent ${agent.name} launched successfully`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[Tangent 2] AgentLauncher: Remote launch failed:`, message)
    }
  }
}
