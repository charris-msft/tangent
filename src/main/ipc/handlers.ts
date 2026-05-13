import { ipcMain, BrowserWindow, dialog, shell } from 'electron'
import { spawn } from 'child_process'
import { readdirSync, statSync } from 'fs'
import { join, dirname, basename } from 'path'
import type { SessionManager } from '../session/SessionManager'
import type { SessionStore } from '../session/SessionStore'
import type { ContextStore } from '../session/ContextStore'
import type { TaskTimelineStore } from '../session/TaskTimelineStore'
import type { PtyManager } from '../pty/PtyManager'
import type { AgentStore } from '../agents/AgentStore'
import type { AgentLauncher } from '../agents/AgentLauncher'
import type { ConfigStore } from '../config/ConfigStore'
import type { DevBoxManager } from '../devbox/DevBoxManager'
import type { DevTunnelManager } from '../devbox/DevTunnelManager'
import type { AcpClient } from '../devbox/AcpClient'
import type { DevBoxProvisioningState } from '../../shared/devbox-types'
import type { AcpPermissionResponse } from '../../shared/acp-types'
import { windowManager } from '../window'
import { TerminalPromptBuffer } from '../session/TerminalPromptBuffer'

export function registerIpcHandlers(deps: {
  sessionManager: SessionManager
  sessionStore: SessionStore
  contextStore: ContextStore
  taskTimelineStore: TaskTimelineStore
  ptyManager: PtyManager
  agentStore: AgentStore
  agentLauncher: AgentLauncher
  configStore: ConfigStore
  devBoxManager?: DevBoxManager
  devTunnelManager?: DevTunnelManager
  acpClient?: AcpClient
  remoteSessionManager?: any
  getWindow: () => BrowserWindow | null
}): void {
  const { sessionManager, sessionStore, contextStore, taskTimelineStore, ptyManager, agentStore, agentLauncher, configStore, devBoxManager, devTunnelManager, acpClient, remoteSessionManager, getWindow } = deps

  // --- Sessions ---
  ipcMain.handle('session:getAll', () => sessionStore.getAll())
  ipcMain.handle('session:create', () => sessionManager.create(configStore.getStartFolder()))
  ipcMain.handle('session:close', (_, id: string) => sessionManager.close(id))
  ipcMain.handle('session:select', (_, id: string) => sessionManager.select(id))
  ipcMain.handle('session:rename', (_, id: string, name: string) => sessionStore.rename(id, name))
  ipcMain.handle('session:scanExternal', () => sessionManager.scanExternal())
  ipcMain.handle('session:reconnect', async (_, id: string) => {
    if (!remoteSessionManager) {
      throw new Error('RemoteSessionManager not available')
    }
    try {
      const newId = await remoteSessionManager.reconnectRemoteSession(id)
      return { success: true, sessionId: newId }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[Tangent] session:reconnect failed:`, message)
      return { success: false, error: message }
    }
  })

  // Forward store events to renderer (and to popout windows where relevant)
  sessionStore.on('created', (session) => {
    windowManager.broadcast('session:created', session)
  })
  sessionStore.on('updated', (session) => {
    windowManager.sendToSession(session.id, 'session:updated', session)
  })
  sessionStore.on('closed', (sessionId) => {
    windowManager.broadcast('session:closed', sessionId)
  })

  // Forward tool-use events to renderer
  sessionStore.on('tool-use', (entry) => {
    windowManager.sendToSession(entry.sessionId, 'tooluse:entry', entry)
  })

  // Tool use query
  ipcMain.handle('tooluse:getAll', (_, sessionId: string) => sessionStore.getToolUse(sessionId))

  // --- Timeline ---
  ipcMain.handle('timeline:get', (_, sessionId: string, opts?: { limit?: number; offset?: number }) =>
    taskTimelineStore.getTimeline(sessionId, opts)
  )

  // Forward timeline events to renderer
  taskTimelineStore.on('item-added', (item) => {
    windowManager.sendToSession(item.sessionId, 'timeline:item-added', item)
  })
  taskTimelineStore.on('item-updated', (item) => {
    windowManager.sendToSession(item.sessionId, 'timeline:item-updated', item)
  })

  // Clear timeline when session closes
  sessionStore.on('closed', (sessionId: string) => {
    taskTimelineStore.clearSession(sessionId)
  })

  // --- Terminal ---
  // Input buffer for remote ACP sessions (accumulates characters until Enter)
  const remoteInputBuffers = new Map<string, string>()
  // Input buffer for timeline prompt capture (accumulates characters until Enter)
  const timelineInputBuffers = new Map<string, TerminalPromptBuffer>()
  sessionStore.on('closed', (sessionId: string) => {
    timelineInputBuffers.delete(sessionId)
  })

  const captureTimelineInput = (sessionId: string, data: string): void => {
    const session = sessionStore.get(sessionId)
    if (!session || session.agentType === 'shell' || session.status === 'needs_input') return

    const buffer = timelineInputBuffers.get(sessionId) ?? new TerminalPromptBuffer()
    timelineInputBuffers.set(sessionId, buffer)

    for (const prompt of buffer.process(data)) {
      taskTimelineStore.recordPrompt(sessionId, prompt, 'terminal', session.agentType)
    }
  }

  ipcMain.on('terminal:write', (_, sessionId: string, data: string) => {
    const session = sessionStore.get(sessionId)
    if (!session) return

    captureTimelineInput(sessionId, data)

    // Remote sessions: route based on mode (PTY vs ACP)
    if (session.kind === 'remote-agent' && remoteSessionManager) {
      // PTY mode: forward raw bytes directly to bridge socket (full TUI)
      if (remoteSessionManager.isPtyMode(sessionId)) {
        remoteSessionManager.writePty(sessionId, data)
        return
      }

      // ACP mode: accumulate input, send as prompt on Enter
      windowManager.sendToSession(sessionId, `terminal:data:${sessionId}`, data)

      let buffer = remoteInputBuffers.get(sessionId) || ''

      for (const ch of data) {
        if (ch === '\r' || ch === '\n') {
          const text = buffer.trim()
          if (text) {
            console.log(`[Tangent] Routing terminal input to ACP prompt: "${text.substring(0, 80)}"`)
            windowManager.sendToSession(sessionId, `terminal:data:${sessionId}`, '\r\n')
            remoteSessionManager.sendPrompt(sessionId, text).catch((err: Error) => {
              console.warn('[Tangent] Failed to send ACP prompt:', err.message)
              windowManager.sendToSession(sessionId, `terminal:data:${sessionId}`, `\r\n\x1b[31m❌ ${err.message}\x1b[0m\r\n`)
            })
          }
          buffer = ''
        } else if (ch === '\x7f' || ch === '\b') {
          buffer = buffer.slice(0, -1)
        } else if (ch.charCodeAt(0) >= 32) {
          buffer += ch
        }
      }

      remoteInputBuffers.set(sessionId, buffer)
      return
    }

    // Local sessions: write to PTY as usual
    if (session.ptyId) ptyManager.write(session.ptyId, data)
  })

  ipcMain.on('terminal:resize', (_, sessionId: string, cols: number, rows: number) => {
    const session = sessionStore.get(sessionId)
    if (!session) return

    // Remote PTY sessions: send resize control frame
    if (session.kind === 'remote-agent' && remoteSessionManager?.isPtyMode(sessionId)) {
      remoteSessionManager.resizePty(sessionId, cols, rows)
      return
    }

    // Local sessions: resize PTY
    if (session.ptyId) ptyManager.resize(session.ptyId, cols, rows)
  })

  // PTY data -> renderer (set up per session when created)
  ipcMain.handle('terminal:attach', (_, sessionId: string) => {
    const session = sessionStore.get(sessionId)
    if (!session) return
    const proc = ptyManager.get(session.ptyId)
    if (!proc) return
    proc.onData((data) => {
      windowManager.sendToSession(sessionId, `terminal:data:${sessionId}`, data)
    })
  })

  // --- Agents ---
  ipcMain.handle('agents:getGroups', () => agentStore.getGroups())
  ipcMain.handle('agents:saveGroups', async (_, groups) => {
    await agentStore.save(groups)
    windowManager.broadcast('agents:updated', groups)
  })
  ipcMain.handle('agents:launch', (_, agentId: string, sessionId: string) => {
    const agent = agentStore.findAgent(agentId)
    if (!agent) {
      console.warn(`[Tangent] agents:launch: agent "${agentId}" not found`)
      return { launched: false, error: `Agent not found: ${agentId}` }
    }
    try {
      const targetSessionId = agentLauncher.launch(agent, sessionId)
      return { launched: true, sessionId: targetSessionId, agentId, agentName: agent.name }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[Tangent] agents:launch: launch threw for "${agent.name}":`, message)
      return { launched: false, error: message }
    }
  })

  // Forward async remote-launch failures to the renderer so the UI can
  // surface an actionable message. Remote launches are long-running and
  // return 'launched: true' immediately; this event fires later if the
  // connect/tunnel/ACP steps fail.
  agentLauncher.on('launch:failed', (payload) => {
    windowManager.broadcast('agents:launchFailed', payload)
  })

  // Test helper: launch agent by name (for e2e tests that don't know IDs)
  ipcMain.handle('agents:launchByName', (_, agentName: string, sessionId?: string) => {
    const groups = agentStore.getGroups()
    for (const group of groups) {
      for (const agent of group.agents) {
        if (agent.name.toLowerCase().includes(agentName.toLowerCase())) {
          console.log(`[Tangent] Test helper: launching agent "${agent.name}" (${agent.id})`)
          const targetSessionId = agentLauncher.launch(agent, sessionId ?? '')
          return { launched: true, sessionId: targetSessionId, agentId: agent.id, agentName: agent.name }
        }
      }
    }
    return { launched: false, error: `Agent "${agentName}" not found` }
  })

  // Test helper: get all session states (for e2e assertions)
  ipcMain.handle('test:getSessionStates', () => {
    const sessions = sessionStore.getAll()
    return sessions.map(s => ({
      id: s.id,
      name: s.name,
      status: s.status,
      kind: s.kind,
      agentType: s.agentType,
      remoteState: s.remoteState,
      devBoxName: s.devBoxName,
      devBoxProject: s.devBoxProject
    }))
  })

  // Test helper: put a session into a UI-observable state without launching a real agent.
  ipcMain.handle('test:setSessionState', (_, sessionId: string, patch: {
    name?: string
    kind?: string
    agentType?: string
    status?: string
    lastActivity?: string
  }) => {
    if (process.env.NODE_ENV !== 'test') {
      return { ok: false, error: 'test:setSessionState is only available in NODE_ENV=test' }
    }

    const session = sessionStore.get(sessionId)
    if (!session) {
      return { ok: false, error: `Session not found: ${sessionId}` }
    }

    const statuses = new Set(['shell_ready', 'agent_launching', 'agent_ready', 'processing', 'tool_executing', 'needs_input', 'failed', 'exited'])
    const agentTypes = new Set(['copilot-cli', 'claude-code', 'shell'])
    const kinds = new Set(['shell', 'copilot-sdk', 'pty-agent', 'remote-agent'])

    if (patch.status !== undefined) {
      if (!statuses.has(patch.status)) return { ok: false, error: `Invalid status: ${patch.status}` }
      session.status = patch.status as any
    }
    if (patch.agentType !== undefined) {
      if (!agentTypes.has(patch.agentType)) return { ok: false, error: `Invalid agentType: ${patch.agentType}` }
      session.agentType = patch.agentType as any
    }
    if (patch.kind !== undefined) {
      if (!kinds.has(patch.kind)) return { ok: false, error: `Invalid kind: ${patch.kind}` }
      session.kind = patch.kind as any
    }
    if (patch.name !== undefined) {
      session.name = patch.name
      session.isRenamed = true
    }
    if (patch.lastActivity !== undefined) {
      session.lastActivity = patch.lastActivity
    }

    session.updatedAt = Date.now()
    sessionStore.emit('updated', session)

    return { ok: true }
  })

  // Test helper: inject a timeline item without launching a real agent.
  ipcMain.handle('test:recordTimelineItem', (_, sessionId: string, promptText: string, responseText?: string) => {
    const session = sessionStore.get(sessionId)
    if (!session) {
      return { ok: false, error: `Session not found: ${sessionId}` }
    }

    const item = taskTimelineStore.recordPrompt(sessionId, promptText, 'terminal', session.agentType)
    if (responseText) {
      taskTimelineStore.appendOutput(sessionId, responseText)
      taskTimelineStore.completeLatest(sessionId, 'success')
    }

    return { ok: true, itemId: item.id }
  })

  // --- Session Metrics ---
  ipcMain.handle('session:getMetrics', (_, sessionId: string) => {
    const session = sessionStore.get(sessionId)
    return session?.metrics ?? null
  })

  // --- Config ---
  ipcMain.handle('config:get', () => configStore.getAll())
  ipcMain.handle('config:update', (_, { key, value }: { key: string; value: unknown }) => {
    configStore.set(key, value)
    return configStore.getAll()
  })
  ipcMain.handle('config:openFile', () => {
    const editor = configStore.getEditor()
    spawn(editor, [configStore.getConfigPath()], { shell: true, detached: true, stdio: 'ignore' }).unref()
  })

  // Forward config file changes to renderer
  configStore.on('changed', (config) => {
    windowManager.broadcast('config:changed', config)
  })

  // --- Config Import/Export ---
  ipcMain.handle('config:export', async () => {
    const config = configStore.getAll()
    const agents = agentStore.getGroups()
    return { version: 1, config, agents }
  })

  ipcMain.handle('config:import', async (_, bundle: { version?: number; config?: any; agents?: any }) => {
    if (bundle.config && typeof bundle.config === 'object') {
      configStore.save(bundle.config)
    }
    if (bundle.agents && Array.isArray(bundle.agents)) {
      await agentStore.save(bundle.agents)
      windowManager.broadcast('agents:updated', bundle.agents)
    }
    const config = configStore.getAll()
    windowManager.broadcast('config:changed', config)
    return { config, agents: agentStore.getGroups() }
  })

  ipcMain.handle('config:writeExport', async (_, filePath: string, bundle: any) => {
    const { writeFile } = await import('fs/promises')
    await writeFile(filePath, JSON.stringify(bundle, null, 2), 'utf-8')
  })

  ipcMain.handle('config:readImport', async (_, filePath: string) => {
    const { readFile } = await import('fs/promises')
    const raw = await readFile(filePath, 'utf-8')
    return JSON.parse(raw)
  })

  // --- Dialog ---
  ipcMain.handle('dialog:saveFile', async (_, options?: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => {
    const win = getWindow()
    if (!win) return null
    const result = await dialog.showSaveDialog(win, {
      defaultPath: options?.defaultPath,
      filters: options?.filters || [],
      title: 'Save file'
    })
    if (result.canceled || !result.filePath) return null
    return result.filePath
  })

  ipcMain.handle('dialog:openFolder', async () => {
    const win = getWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select folder'
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:openFile', async (_, filters) => {
    const win = getWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: filters || [],
      title: 'Select file'
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // --- Shell ---
  ipcMain.handle('shell:openInVSCode', (_, folderPath: string) => {
    spawn('code-insiders', [folderPath], { shell: true, detached: true, stdio: 'ignore' }).unref()
  })

  ipcMain.handle('shell:openInExplorer', (_, folderPath: string) => {
    shell.openPath(folderPath)
  })

  ipcMain.handle('shell:openExternal', (_, url: string) => {
    shell.openExternal(url)
  })

  ipcMain.handle('shell:openEditor', (_, { folderPath }: { folderPath: string }) => {
    const editor = configStore.getEditor()
    spawn(editor, [folderPath], { shell: true, detached: true, stdio: 'ignore' }).unref()
  })

  ipcMain.handle('shell:getEditor', () => configStore.getEditor())

  ipcMain.handle('shell:setEditor', (_, { editor }: { editor: string }) => {
    configStore.setEditor(editor)
  })

  // --- App ---
  let zoomLevel = 14
  ipcMain.handle('app:getZoom', () => zoomLevel)
  ipcMain.handle('app:setZoom', (_, level: number) => {
    zoomLevel = Math.max(8, Math.min(32, level))
    windowManager.broadcast('app:zoomChanged', zoomLevel)
    return zoomLevel
  })

  // --- File system ---
  ipcMain.handle('fs:suggestDirs', (_, partial: string): string[] => {
    try {
      if (!partial) return []
      const normalized = partial.replace(/\//g, '\\')
      // If ends with separator, list children of that directory
      if (normalized.endsWith('\\')) {
        const entries = readdirSync(normalized, { withFileTypes: true })
        return entries
          .filter(e => e.isDirectory())
          .map(e => join(normalized, e.name))
          .slice(0, 20)
      }
      // Otherwise, list siblings matching the typed prefix
      const dir = dirname(normalized)
      const prefix = basename(normalized).toLowerCase()
      const entries = readdirSync(dir, { withFileTypes: true })
      return entries
        .filter(e => e.isDirectory() && e.name.toLowerCase().startsWith(prefix))
        .map(e => join(dir, e.name))
        .slice(0, 20)
    } catch {
      return []
    }
  })

  // --- Human Context ---
  ipcMain.handle('context:get', (_, sessionId: string) => contextStore.getContext(sessionId))
  ipcMain.handle('context:getPrompts', (_, sessionId: string) => contextStore.getPrompts(sessionId))

  // Allow renderer to record SDK prompts (since SDK input goes through line buffer in renderer)
  ipcMain.on('context:recordPrompt', (_, sessionId: string, text: string, source: string) => {
    contextStore.addPrompt(sessionId, text, source as 'terminal' | 'sdk')
  })

  // Forward context updates to renderer
  contextStore.on('context-updated', (ctx) => {
    windowManager.sendToSession(ctx.sessionId, 'context:updated', ctx)
  })

  // Re-emit context when session status changes (updates resume suggestion)
  sessionStore.on('updated', (session) => {
    const ctx = contextStore.getContext(session.id)
    if (ctx) {
      windowManager.sendToSession(session.id, 'context:updated', ctx)
    }
  })

  // --- DevBox ---
  ipcMain.handle('devbox:list', async () => {
    if (!devBoxManager) throw new Error('DevBox manager not available')
    if (!devBoxManager.isConfigured) throw new Error('DevBox not configured. Create ~/.tangent/devbox-config.json with your Dev Center endpoint and project name.')
    return devBoxManager.listDevBoxes()
  })

  ipcMain.handle('devbox:hasSshConfig', async (_, devBoxName: string) => {
    if (!devBoxManager) return false
    return devBoxManager.hasSshConfig(devBoxName)
  })

  ipcMain.handle('devbox:start', async (_, projectName: string, devBoxName: string) => {
    if (!devBoxManager) return false
    return devBoxManager.startDevBox(projectName, devBoxName)
  })

  ipcMain.handle('devbox:stop', async (_, projectName: string, devBoxName: string) => {
    if (!devBoxManager) return false
    return devBoxManager.stopDevBox(projectName, devBoxName)
  })

  ipcMain.handle('devbox:getConnectionInfo', async (_, projectName: string, devBoxName: string) => {
    if (!devBoxManager) return null
    return devBoxManager.getConnectionInfo(projectName, devBoxName)
  })

  ipcMain.handle('devbox:checkHealth', async (_, projectName: string, devBoxName: string) => {
    if (!devBoxManager) {
      return {
        isHealthy: false,
        sshReachable: false,
        acpReachable: false,
        lastCheckAt: Date.now(),
        error: 'DevBoxManager not initialized'
      }
    }
    return devBoxManager.checkHealth(projectName, devBoxName)
  })

  ipcMain.handle('devbox:autoStart', async (
    _,
    projectName: string,
    devBoxName: string,
    reportProgress: boolean
  ) => {
    if (!devBoxManager) return false

    const progressCallback = reportProgress
      ? (state: DevBoxProvisioningState, elapsed: number) => {
          windowManager.broadcast('devbox:autoStartProgress', {
            projectName,
            devBoxName,
            state,
            elapsed
          })
        }
      : undefined

    return devBoxManager.autoStart(projectName, devBoxName, progressCallback)
  })

  // Forward DevBox events to renderer
  if (devBoxManager) {
    devBoxManager.on('devbox:state-changed', (devBoxName, state) => {
      windowManager.broadcast('devbox:stateChanged', { devBoxName, state })
    })

    devBoxManager.on('devbox:health-updated', (devBoxName, health) => {
      windowManager.broadcast('devbox:healthUpdated', { devBoxName, health })
    })

    devBoxManager.on('devbox:error', (devBoxName, error) => {
      windowManager.broadcast('devbox:error', { devBoxName, error })
    })
  }

  // --- DevTunnel sign-in ---
  // Interactive GitHub sign-in for dev tunnels. Opens a browser via
  // `devtunnel user login -g` so the user can complete OAuth.
  ipcMain.handle('devbox:signIn', async () => {
    if (!devTunnelManager) {
      return { ok: false, message: 'DevTunnelManager not available' }
    }
    return devTunnelManager.signIn()
  })

  // Preflight check: returns a snapshot of everything we need to make a
  // remote session succeed. The renderer calls this before launching a
  // remote agent and can present clear guidance (start Dev Box, sign in,
  // run setup script) before any connect attempt times out.
  ipcMain.handle('devbox:preflight', async (_, projectName: string, devBoxName: string) => {
    const report: {
      ok: boolean
      devBoxName: string
      configured: boolean
      hasSshConfig: boolean
      devBoxState?: string
      tunnelId?: string
      tunnelAuth: { signedIn: boolean; identity?: string; message?: string }
      issues: string[]
      actions: { id: string; label: string; hint: string }[]
    } = {
      ok: false,
      devBoxName,
      configured: false,
      hasSshConfig: false,
      tunnelAuth: { signedIn: false },
      issues: [],
      actions: []
    }

    if (!devBoxManager || !devBoxManager.isConfigured) {
      report.issues.push('DevBox is not configured. Create ~/.tangent/devbox-config.json.')
      return report
    }
    report.configured = true

    report.hasSshConfig = devBoxManager.hasSshConfig(devBoxName)
    if (!report.hasSshConfig) {
      report.issues.push(`No dev tunnel configured for "${devBoxName}". Run the setup script on the Dev Box.`)
      report.actions.push({
        id: 'setup',
        label: 'Open setup instructions',
        hint: 'Run assets/devbox-setup.ps1 on the Dev Box via RDP.'
      })
    } else {
      const tunnelCfg = devBoxManager.getTunnelConfig?.(devBoxName)
      report.tunnelId = tunnelCfg?.tunnelId
    }

    if (devTunnelManager) {
      report.tunnelAuth = await devTunnelManager.checkAuth()
      if (!report.tunnelAuth.signedIn) {
        report.issues.push('Not signed in to dev tunnels.')
        report.actions.push({
          id: 'signIn',
          label: 'Sign in to dev tunnels',
          hint: 'Runs `devtunnel user login -g` to open a browser OAuth flow.'
        })
      }
    }

    try {
      const devBox = await devBoxManager.getDevBox(projectName, devBoxName)
      if (devBox) {
        report.devBoxState = devBox.state
        if (devBox.state !== 'Running') {
          report.issues.push(`Dev Box is ${devBox.state}. It will be auto-started when you launch.`)
          report.actions.push({
            id: 'start',
            label: `Start Dev Box (${devBox.state} → Running)`,
            hint: 'Kicks off Azure Dev Box start; this can take 1-2 minutes.'
          })
        }
      } else {
        report.issues.push(`Dev Box "${devBoxName}" not found in project "${projectName}".`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      report.issues.push(`Failed to query Dev Box state: ${msg}`)
    }

    report.ok = report.issues.length === 0
    return report
  })

  // Forward DevTunnel auth events to renderer so the UI can show a
  // "Sign in to dev tunnels" banner when a remote agent launch fails
  // because the user isn't signed in.
  if (devTunnelManager) {
    devTunnelManager.on('auth:required', (payload) => {
      windowManager.broadcast('devbox:authRequired', payload)
    })
    devTunnelManager.on('auth:signin-started', () => {
      windowManager.broadcast('devbox:signInStarted', {})
    })
    devTunnelManager.on('auth:signin-complete', (payload) => {
      windowManager.broadcast('devbox:signInComplete', payload)
    })
    devTunnelManager.on('auth:signin-failed', (payload) => {
      windowManager.broadcast('devbox:signInFailed', payload)
    })
  }

  // --- ACP ---
  ipcMain.on('acp:permission-response', (_, response: AcpPermissionResponse) => {
    if (acpClient) {
      acpClient.respondToPermission(response)
    }
  })

  // Forward ACP permission requests to renderer
  if (acpClient) {
    acpClient.on('acp:permission-request', (request) => {
      windowManager.broadcast('acp:permission-request', request)
    })

    acpClient.on('acp:connected', () => {
      windowManager.broadcast('acp:connected')
    })

    acpClient.on('acp:disconnected', () => {
      windowManager.broadcast('acp:disconnected')
    })

    acpClient.on('acp:session-created', (session) => {
      windowManager.broadcast('acp:session-created', session)
    })

    acpClient.on('acp:message', (response) => {
      windowManager.broadcast('acp:message', response)

      // Format and forward as terminal output
      const formattedOutput = formatAcpResponseForTerminal(response)
      if (formattedOutput) {
        windowManager.broadcast('acp:output', {
          sessionId: response.sessionId,
          text: formattedOutput
        })
      }
    })

    acpClient.on('acp:error', (error) => {
      windowManager.broadcast('acp:error', {
        message: error.message,
        stack: error.stack
      })
    })
  }
}

/**
 * Format ACP agent response as human-readable terminal text.
 * Converts JSON protocol messages to readable output for xterm.js.
 */
function formatAcpResponseForTerminal(response: any): string {
  const lines: string[] = []

  // Add agent text response
  if (response.text) {
    lines.push(response.text)
  }

  // Add tool execution updates
  if (response.toolExecutions && response.toolExecutions.length > 0) {
    for (const tool of response.toolExecutions) {
      const statusIcon = tool.status === 'success' ? '✓' :
                        tool.status === 'error' ? '✗' :
                        '⋯'

      let toolLine = `${statusIcon} Tool: ${tool.name}`

      if (tool.source === 'mcp' && tool.mcpServerName) {
        toolLine += ` (${tool.mcpServerName})`
      }

      if (tool.status === 'running' && tool.progressMessage) {
        toolLine += ` - ${tool.progressMessage}`
      } else if (tool.status === 'error' && tool.error) {
        toolLine += ` - Error: ${tool.error}`
      }

      lines.push(toolLine)
    }
  }

  // Add status updates
  if (response.status) {
    const statusMessages: Record<string, string> = {
      'processing': '🤔 Processing...',
      'tool_executing': '🔧 Executing tools...',
      'needs_input': '⌨️  Waiting for input...',
      'completed': '✓ Completed',
      'error': '✗ Error'
    }

    const statusMessage = statusMessages[response.status]
    if (statusMessage) {
      lines.push(statusMessage)
    }
  }

  // Add error details
  if (response.error) {
    lines.push(`Error: ${response.error}`)
  }

  return lines.length > 0 ? lines.join('\n') + '\n' : ''
}
