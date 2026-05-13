import type { AgentProfile } from '@shared/types'
import type { PtyManager } from '../pty/PtyManager'
import type { SessionStore } from '../session/SessionStore'
import type { SessionManager } from '../session/SessionManager'
import type { RemoteSessionManager } from '../session/RemoteSessionManager'
import { EventEmitter } from 'events'

function psEscape(value: string): string {
  return value.replace(/'/g, "''")
}

function isCopilotAgent(agent: AgentProfile): boolean {
  return agent.command.includes('copilot')
}

export class AgentLauncher extends EventEmitter {
  constructor(
    private ptyManager: PtyManager,
    private sessionStore: SessionStore,
    private sessionManager: SessionManager,
    private remoteSessionManager?: RemoteSessionManager
  ) { super() }

  launch(agent: AgentProfile, sessionId: string): string {
    // P4.6: Check if this is a remote agent and delegate to RemoteSessionManager
    if (agent.remote?.enabled) {
      return this._launchRemote(agent, sessionId)
    }

    // Original local launch path
    return this._launchLocal(agent, sessionId)
  }

  private _launchLocal(agent: AgentProfile, sessionId: string): string {
    let targetSessionId = sessionId

    if (agent.launchTarget === 'newTab') {
      const currentSession = this.sessionStore.get(sessionId)
      // Fall back to creating a fresh session if the provided one is gone
      const cwd = currentSession?.folderPath
      const newSession = this.sessionManager.create(cwd)
      targetSessionId = newSession.id
    } else if (agent.launchTarget === 'path' && agent.cwdPath) {
      const newSession = this.sessionManager.create(agent.cwdPath)
      targetSessionId = newSession.id
    } else {
      // currentTab (default). If no valid session, create one.
      const currentSession = this.sessionStore.get(sessionId)
      if (!currentSession) {
        console.warn(`[Tangent] AgentLauncher: no active session for agent "${agent.name}", creating one`)
        const newSession = this.sessionManager.create()
        targetSessionId = newSession.id
      }
    }

    const targetSession = this.sessionStore.get(targetSessionId)
    if (!targetSession) {
      console.warn(`[Tangent] AgentLauncher: target session ${targetSessionId} not found after creation attempt`)
      return
    }

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

    const resolvedCmd = agent.command
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

    return targetSessionId
  }

  /**
   * Launch an agent remotely on a Dev Box via RemoteSessionManager.
   * P4.6: Remote agent routing
   */
  private _launchRemote(agent: AgentProfile, sessionId: string): string {
    if (!this.remoteSessionManager) {
      console.warn('[Tangent] AgentLauncher: Remote agent requested but RemoteSessionManager not available')
      return sessionId
    }

    if (!agent.remote?.enabled) {
      console.warn('[Tangent] AgentLauncher: _launchRemote called without remote.enabled')
      return sessionId
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
        console.warn('[Tangent] AgentLauncher: Current session not found for remote launch')
        return sessionId
      }
      localPath = currentSession.folderPath
    }

    // Launch async (errors emitted via 'launch:failed' event)
    void (async () => {
      try {
        console.log(`[Tangent] AgentLauncher: Launching remote agent ${agent.name} at ${localPath}`)

        // RemoteSessionManager handles full lifecycle:
        // - Dev Box start
        // - Provisioning check
        // - Workspace sync
        // - ACP session creation
        await this.remoteSessionManager!.createRemoteSession(agent, localPath)

        console.log(`[Tangent] AgentLauncher: Remote agent ${agent.name} launched successfully`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[Tangent] AgentLauncher: Remote launch failed:`, message)
        this.emit('launch:failed', { agentId: agent.id, agentName: agent.name, error: message })
      }
    })()

    // Return the sessionId immediately (remote session will be created asynchronously)
    return sessionId
  }
}
