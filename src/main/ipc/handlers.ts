import { ipcMain, BrowserWindow, dialog, shell } from 'electron'
import { spawn } from 'child_process'
import { readdirSync, statSync } from 'fs'
import { join, dirname, basename } from 'path'
import type { SessionManager } from '../session/SessionManager'
import type { SessionStore } from '../session/SessionStore'
import type { ContextStore } from '../session/ContextStore'
import type { PtyManager } from '../pty/PtyManager'
import type { AgentStore } from '../agents/AgentStore'
import type { AgentLauncher } from '../agents/AgentLauncher'
import type { ConfigStore } from '../config/ConfigStore'
import type { DevBoxManager } from '../devbox/DevBoxManager'
import type { AcpClient } from '../devbox/AcpClient'
import type { DevBoxProvisioningState } from '../../shared/devbox-types'
import type { AcpPermissionResponse } from '../../shared/acp-types'

export function registerIpcHandlers(deps: {
  sessionManager: SessionManager
  sessionStore: SessionStore
  contextStore: ContextStore
  ptyManager: PtyManager
  agentStore: AgentStore
  agentLauncher: AgentLauncher
  configStore: ConfigStore
  devBoxManager?: DevBoxManager
  acpClient?: AcpClient
  getWindow: () => BrowserWindow | null
}): void {
  const { sessionManager, sessionStore, contextStore, ptyManager, agentStore, agentLauncher, configStore, devBoxManager, acpClient, getWindow } = deps

  // --- Sessions ---
  ipcMain.handle('session:getAll', () => sessionStore.getAll())
  ipcMain.handle('session:create', () => sessionManager.create(configStore.getStartFolder()))
  ipcMain.handle('session:close', (_, id: string) => sessionManager.close(id))
  ipcMain.handle('session:select', (_, id: string) => sessionManager.select(id))
  ipcMain.handle('session:rename', (_, id: string, name: string) => sessionStore.rename(id, name))
  ipcMain.handle('session:scanExternal', () => sessionManager.scanExternal())

  // Forward store events to renderer
  sessionStore.on('created', (session) => {
    getWindow()?.webContents.send('session:created', session)
  })
  sessionStore.on('updated', (session) => {
    getWindow()?.webContents.send('session:updated', session)
  })
  sessionStore.on('closed', (sessionId) => {
    getWindow()?.webContents.send('session:closed', sessionId)
  })

  // Forward tool-use events to renderer
  sessionStore.on('tool-use', (entry) => {
    getWindow()?.webContents.send('tooluse:entry', entry)
  })

  // Tool use query
  ipcMain.handle('tooluse:getAll', (_, sessionId: string) => sessionStore.getToolUse(sessionId))

  // --- Terminal ---
  ipcMain.on('terminal:write', (_, sessionId: string, data: string) => {
    const session = sessionStore.get(sessionId)
    if (session) ptyManager.write(session.ptyId, data)
  })

  ipcMain.on('terminal:resize', (_, sessionId: string, cols: number, rows: number) => {
    const session = sessionStore.get(sessionId)
    if (session) ptyManager.resize(session.ptyId, cols, rows)
  })

  // PTY data -> renderer (set up per session when created)
  ipcMain.handle('terminal:attach', (_, sessionId: string) => {
    const session = sessionStore.get(sessionId)
    if (!session) return
    const proc = ptyManager.get(session.ptyId)
    if (!proc) return
    proc.onData((data) => {
      getWindow()?.webContents.send(`terminal:data:${sessionId}`, data)
    })
  })

  // --- Agents ---
  ipcMain.handle('agents:getGroups', () => agentStore.getGroups())
  ipcMain.handle('agents:saveGroups', async (_, groups) => {
    await agentStore.save(groups)
    getWindow()?.webContents.send('agents:updated', groups)
  })
  ipcMain.handle('agents:launch', (_, agentId: string, sessionId: string) => {
    const agent = agentStore.findAgent(agentId)
    if (agent) agentLauncher.launch(agent, sessionId)
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
    getWindow()?.webContents.send('config:changed', config)
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
      getWindow()?.webContents.send('agents:updated', bundle.agents)
    }
    const config = configStore.getAll()
    getWindow()?.webContents.send('config:changed', config)
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
    getWindow()?.webContents.send('app:zoomChanged', zoomLevel)
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
    getWindow()?.webContents.send('context:updated', ctx)
  })

  // Re-emit context when session status changes (updates resume suggestion)
  sessionStore.on('updated', (session) => {
    const ctx = contextStore.getContext(session.id)
    if (ctx) {
      getWindow()?.webContents.send('context:updated', ctx)
    }
  })

  // --- DevBox ---
  ipcMain.handle('devbox:list', async () => {
    if (!devBoxManager) return []
    return devBoxManager.listDevBoxes()
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
          getWindow()?.webContents.send('devbox:autoStartProgress', {
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
      getWindow()?.webContents.send('devbox:stateChanged', { devBoxName, state })
    })

    devBoxManager.on('devbox:health-updated', (devBoxName, health) => {
      getWindow()?.webContents.send('devbox:healthUpdated', { devBoxName, health })
    })

    devBoxManager.on('devbox:error', (devBoxName, error) => {
      getWindow()?.webContents.send('devbox:error', { devBoxName, error })
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
      getWindow()?.webContents.send('acp:permission-request', request)
    })

    acpClient.on('acp:connected', () => {
      getWindow()?.webContents.send('acp:connected')
    })

    acpClient.on('acp:disconnected', () => {
      getWindow()?.webContents.send('acp:disconnected')
    })

    acpClient.on('acp:session-created', (session) => {
      getWindow()?.webContents.send('acp:session-created', session)
    })

    acpClient.on('acp:message', (response) => {
      getWindow()?.webContents.send('acp:message', response)
      
      // Format and forward as terminal output
      const formattedOutput = formatAcpResponseForTerminal(response)
      if (formattedOutput) {
        getWindow()?.webContents.send('acp:output', {
          sessionId: response.sessionId,
          text: formattedOutput
        })
      }
    })

    acpClient.on('acp:error', (error) => {
      getWindow()?.webContents.send('acp:error', {
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
