import type { AgentProfile } from '@shared/types'
import type { PtyManager } from '../pty/PtyManager'
import type { SessionStore } from '../session/SessionStore'
import type { SessionManager } from '../session/SessionManager'

function psEscape(value: string): string {
  return value.replace(/'/g, "''")
}

/** Check if an agent profile is a Copilot CLI agent. */
function isCopilotAgent(agent: AgentProfile): boolean {
  return agent.command.includes('copilot')
}

export class AgentLauncher {
  constructor(
    private ptyManager: PtyManager,
    private sessionStore: SessionStore,
    private sessionManager: SessionManager
  ) {}

  launch(agent: AgentProfile, sessionId: string): void {
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
    const isCopilot = isCopilotAgent(agent)
    const extraArgs = isCopilot ? ['--ui-server', '--port', '0'] : []

    const allArgs = [...agent.args, ...extraArgs]
    const args = allArgs.map(a => `'${psEscape(a)}'`).join(' ')
    const cmd = args ? `${agent.command} ${args}` : agent.command
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
      this.sessionStore.setAgentLaunchInfo(targetSessionId, agent.command, allArgs, agent.env)
    }

    // For Copilot, attach the SDK to watch for the ui-server port
    if (isCopilot && this.sessionManager.sdkManager) {
      this.sessionManager.sdkManager.attachToSession(targetSessionId, targetSession.ptyId)
    }
  }
}
