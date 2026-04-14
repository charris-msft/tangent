import { app, BrowserWindow, protocol, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { PtyManager } from './pty/PtyManager'
import { SessionStore } from './session/SessionStore'
import { SessionManager } from './session/SessionManager'
import { SdkSessionManager } from './session/SdkSessionManager'
import { ContextStore } from './session/ContextStore'
import { AgentStore } from './agents/AgentStore'
import { AgentLauncher } from './agents/AgentLauncher'
import { ConfigStore } from './config/ConfigStore'
import { registerIpcHandlers } from './ipc/handlers'
import { PipeServer } from './config/PipeServer'
import { DevBoxManager } from './devbox/DevBoxManager'
import { SshTunnelManager } from './devbox/SshTunnelManager'
import { DevTunnelManager } from './devbox/DevTunnelManager'
import { OpenSshProvisioner } from './devbox/OpenSshProvisioner'
import { AcpProvisioner } from './devbox/AcpProvisioner'
import { DevBoxConnector } from './devbox/DevBoxConnector'
import { DevBoxProvisioner } from './devbox/DevBoxProvisioner'
import { AcpClient } from './devbox/AcpClient'
import { RsyncManager } from './devbox/RsyncManager'
import { SyncListener } from './devbox/SyncListener'
import { RemoteSessionManager } from './session/RemoteSessionManager'

const SESSIONS_PATH = join(homedir(), '.tangent', 'sessions.json')

let mainWindow: BrowserWindow | null = null

const configStore = new ConfigStore()
const ptyManager = new PtyManager()
const sessionStore = new SessionStore()
const contextStore = new ContextStore(sessionStore)
const sessionManager = new SessionManager(sessionStore, ptyManager)
sessionManager.setContextStore(contextStore)
const sdkSessionManager = new SdkSessionManager(sessionStore, ptyManager)
sessionManager.setSdkManager(sdkSessionManager)
const agentStore = new AgentStore()
const pipeServer = new PipeServer(
  configStore,
  agentStore,
  () => mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
)

// Remote execution managers
const devBoxManager = new DevBoxManager()
const sshTunnelManager = new SshTunnelManager()
const devTunnelManager = new DevTunnelManager()
const openSshProvisioner = new OpenSshProvisioner()
const acpProvisioner = new AcpProvisioner()
const devBoxConnector = new DevBoxConnector(devBoxManager, sshTunnelManager, openSshProvisioner, devTunnelManager)
const devBoxProvisioner = new DevBoxProvisioner(openSshProvisioner, acpProvisioner)
const acpClient = new AcpClient()
const rsyncManager = new RsyncManager()
const syncListener = new SyncListener(rsyncManager)
const remoteSessionManager = new RemoteSessionManager(
  devBoxConnector, devBoxProvisioner, acpClient, rsyncManager, sessionStore, ptyManager, agentStore
)
const agentLauncher = new AgentLauncher(ptyManager, sessionStore, sessionManager, remoteSessionManager)

/** Persist restorable sessions to disk immediately. Called on every session change. */
function persistSessions(): void {
  try {
    const all = sessionStore.getAll()
    const activeId = sessionManager.getActiveSessionId()
    const restorable = all.filter(s => !s.isExternal && s.status !== 'exited')
    const dir = join(homedir(), '.tangent')
    mkdirSync(dir, { recursive: true })
    if (restorable.length > 0) {
      const activeIndex = restorable.findIndex(s => s.id === activeId)
      const data = {
        activeIndex: activeIndex >= 0 ? activeIndex : 0,
        sessions: restorable.map(s => ({
          kind: s.kind,
          name: s.name,
          folderPath: s.folderPath,
          folderName: s.folderName,
          isRenamed: s.isRenamed,
          agentType: s.agentType,
          agentCommand: s.agentCommand,
          agentArgs: s.agentArgs,
          agentEnv: s.agentEnv,
          // P4.17: Persist remote session fields
          devBoxName: s.devBoxName,
          devBoxProject: s.devBoxProject,
          acpSessionId: s.acpSessionId
        }))
      }
      writeFileSync(SESSIONS_PATH, JSON.stringify(data, null, 2), 'utf-8')
    } else {
      // No restorable sessions — remove stale file
      if (existsSync(SESSIONS_PATH)) {
        unlinkSync(SESSIONS_PATH)
      }
    }
  } catch (err) {
    console.warn('[Tangent 2] Failed to persist sessions:', err)
  }
}

// Debounced session persistence — writes at most once per second
let persistTimer: ReturnType<typeof setTimeout> | null = null
function schedulePersist(): void {
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    persistSessions()
  }, 1000)
}

function persistNow(): void {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  persistSessions()
}

// Structural changes: persist immediately
sessionStore.on('created', () => persistNow())
sessionStore.on('closed', () => persistNow())

// Other updates (status, rename, agent info, activity, metrics): debounced
sessionStore.on('updated', () => schedulePersist())

// When an agent is auto-detected from output (user typed `copilot` manually),
// attach the SDK to watch for the ui-server port
sessionStore.on('agent-promoted', ({ id, agentType, ptyId }: { id: string; agentType: string; ptyId: string }) => {
  if (agentType === 'copilot-cli' && ptyId) {
    sdkSessionManager.attachToSession(id, ptyId)
  }
})

function createWindow(): void {
  // Set app identity so Windows taskbar uses the Tangent 2 icon, not the Electron icon
  app.setAppUserModelId('com.tangent2.app')

  mainWindow = new BrowserWindow({
    title: 'Tangent 2',
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    backgroundColor: '#0d1117',
    autoHideMenuBar: true,
    icon: join(__dirname, '../../assets/tangent.ico'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // Tell Windows to relaunch via tangent.exe when pinned to taskbar
  if (process.platform === 'win32') {
    const tangentExe = join(__dirname, '../../tangent.exe')
    if (existsSync(tangentExe)) {
      mainWindow.setAppDetails({
        appId: 'com.tangent2.app',
        appIconPath: join(__dirname, '../../assets/tangent.ico'),
        appIconIndex: 0,
        relaunchCommand: `"${tangentExe}"`,
        relaunchDisplayName: 'Tangent 2'
      })
    }
  }

  registerIpcHandlers({
    sessionManager,
    sessionStore,
    contextStore,
    ptyManager,
    agentStore,
    agentLauncher,
    configStore,
    devBoxManager,
    acpClient,
    remoteSessionManager,
    getWindow: () => mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Register custom protocol to serve local files (icons) to the renderer
protocol.registerSchemesAsPrivileged([
  { scheme: 'tangent-file', privileges: { standard: false, supportFetchAPI: true, stream: true } }
])

app.whenReady().then(async () => {
  protocol.handle('tangent-file', (request) => {
    // tangent-file:///C:/path/to/file.ico -> file:///C:/path/to/file.ico
    const filePath = decodeURIComponent(request.url.replace('tangent-file:///', ''))
    return net.fetch(pathToFileURL(filePath).href)
  })

  configStore.load()
  await agentStore.load()
  pipeServer.start()
  createWindow()

  // Forward remote execution events to renderer
  const getWin = (): BrowserWindow | null =>
    mainWindow && !mainWindow.isDestroyed() ? mainWindow : null

  remoteSessionManager.on('remote:state-changed', (sessionId: string, state: string) => {
    const win = getWin()
    if (win) win.webContents.send('remote:state-changed', sessionId, state)
  })
  remoteSessionManager.on('remote:message', (sessionId: string, text: string) => {
    const win = getWin()
    if (win) {
      win.webContents.send('remote:message', sessionId, text)
      // Also push as terminal data so xterm.js renders the agent output
      win.webContents.send(`terminal:data:${sessionId}`, text + '\r\n')
    }
  })
  remoteSessionManager.on('remote:error', (sessionId: string, error: string) => {
    const win = getWin()
    if (win) {
      win.webContents.send('remote:error', sessionId, error)
      win.webContents.send(`terminal:data:${sessionId}`, `\r\n\x1b[31m❌ ${error}\x1b[0m\r\n`)
    }
  })

  devBoxConnector.on('connection:ready', (connectionId: string) => {
    const win = getWin()
    if (win) win.webContents.send('devbox:connection-ready', connectionId)
  })
  devBoxConnector.on('connection:failed', (connectionId: string, error: string) => {
    const win = getWin()
    if (win) win.webContents.send('devbox:connection-failed', connectionId, error)
  })
  devBoxConnector.on('connection:disconnected', (connectionId: string) => {
    const win = getWin()
    if (win) win.webContents.send('devbox:connection-disconnected', connectionId)
  })

  syncListener.on('sync:incoming', (data: unknown) => {
    const win = getWin()
    if (win) win.webContents.send('sync:incoming', data)
  })
  syncListener.on('sync:complete', (data: unknown) => {
    const win = getWin()
    if (win) win.webContents.send('sync:complete', data)
  })
  syncListener.on('sync:error', (data: unknown) => {
    const win = getWin()
    if (win) win.webContents.send('sync:error', data)
  })
  syncListener.on('sync:conflict', (data: unknown) => {
    const win = getWin()
    if (win) win.webContents.send('sync:conflict', data)
  })

  // Restore saved sessions or create a fresh one
  let restored = false
  try {
    if (existsSync(SESSIONS_PATH)) {
      const raw = readFileSync(SESSIONS_PATH, 'utf-8')
      const saved = JSON.parse(raw)
      if (saved.sessions?.length > 0) {
        const agentSessions: Array<{ sessionId: string; ptyId: string; saved: typeof saved.sessions[0] }> = []
        const remoteSessions: Array<typeof saved.sessions[0]> = []

        for (const s of saved.sessions) {
          // P4.17: Detect remote sessions and handle separately
          if (s.kind === 'remote-agent') {
            remoteSessions.push(s)
            continue
          }

          const session = sessionManager.create(s.folderPath)
          if (s.isRenamed && s.name) {
            sessionStore.rename(session.id, s.name)
          }
          if (s.agentCommand) {
            agentSessions.push({ sessionId: session.id, ptyId: session.ptyId, saved: s })
          }
        }

        // P4.17: Restore remote sessions
        // Remote sessions need special handling:
        // - Check if Dev Box is still running
        // - If running → attempt reconnect
        // - If stopped → show reconnect prompt (needs_input status)
        for (const s of remoteSessions) {
          if (!s.devBoxName || !s.devBoxProject) {
            console.warn(
              `[Tangent 2] Skipping remote session restore: missing Dev Box info`,
              s.name
            )
            continue
          }

          // For now, create a placeholder session with needs_input status
          // Full reconnection will be implemented once RemoteSessionManager is integrated
          const sessionId = `remote-restore-${Date.now()}-${Math.random().toString(36).substring(7)}`
          sessionStore.add({
            id: sessionId,
            kind: 'remote-agent',
            agentType: s.agentType || 'copilot-cli',
            name: s.name,
            folderName: s.folderName,
            folderPath: s.folderPath,
            isRenamed: s.isRenamed || false,
            status: 'needs_input',
            lastActivity: 'Remote session - reconnect required',
            startedAt: Date.now(),
            updatedAt: Date.now(),
            ptyId: '',
            isExternal: false,
            remoteState: 'starting-devbox',
            devBoxName: s.devBoxName,
            devBoxProject: s.devBoxProject
          })

          console.log(
            `[Tangent 2] Remote session restored (needs reconnection): ${s.devBoxName}`
          )
        }
        // Select the previously active session by index
        if (typeof saved.activeIndex === 'number') {
          const all = sessionStore.getAll()
          const idx = Math.min(saved.activeIndex, all.length - 1)
          if (all[idx]) {
            sessionManager.select(all[idx].id)
          }
        }
        // Replay agent commands once each shell's prompt is ready
        const PS_PROMPT = /PS\s+[A-Za-z]:\\[^>]*>\s*$/
        const SHELL_READY_TIMEOUT_MS = 15_000

        for (const { sessionId, ptyId, saved: s } of agentSessions) {
          const replayCommand = (): void => {
            const psEscape = (v: string): string => v.replace(/'/g, "''")
            const lines: string[] = []

            if (s.agentEnv) {
              for (const [key, value] of Object.entries(s.agentEnv)) {
                lines.push(`$env:${key} = '${psEscape(value)}'`)
              }
            }

            // Filter out any stale --ui-server/--port flags from saved args
            const cleanArgs = (s.agentArgs || []).filter((a: string) =>
              a !== '--ui-server' && a !== '--port' && a !== '0'
            )
            const args = [...cleanArgs]
            // Append --resume to reconnect to the agent's prior conversation
            if (s.agentType !== 'shell' && !args.includes('--resume')) {
              args.push('--resume')
            }

            // For Copilot, add --ui-server for SDK hybrid mode
            const isCopilot = s.agentType === 'copilot-cli'
            if (isCopilot) {
              args.push('--ui-server', '--port', '0')
            }

            const argsStr = args.map((a: string) => `'${psEscape(a)}'`).join(' ')
            const cmd = argsStr ? `${s.agentCommand} ${argsStr}` : s.agentCommand
            lines.push(cmd)

            ptyManager.write(ptyId, lines.join('\r') + '\r')

            const agentType = s.agentType !== 'shell' ? s.agentType : undefined
            if (agentType) {
              sessionStore.promoteToAgent(sessionId, agentType)
              // Save clean args (without --ui-server) for display
              sessionStore.setAgentLaunchInfo(sessionId, s.agentCommand, cleanArgs, s.agentEnv)
            }

            // Attach SDK for Copilot sessions
            if (isCopilot) {
              sdkSessionManager.attachToSession(sessionId, ptyId)
            }
          }

          // Wait for the PS prompt before replaying, with a timeout fallback
          let resolved = false
          const onData = (_emittedPtyId: string, data: string): void => {
            if (resolved || _emittedPtyId !== ptyId) return
            if (PS_PROMPT.test(data)) {
              resolved = true
              clearTimeout(timer)
              ptyManager.removeListener('data', onData)
              replayCommand()
            }
          }
          const timer = setTimeout(() => {
            if (resolved) return
            resolved = true
            ptyManager.removeListener('data', onData)
            console.warn(`[Tangent 2] Shell ready timeout for session ${sessionId}, replaying anyway`)
            replayCommand()
          }, SHELL_READY_TIMEOUT_MS)
          ptyManager.on('data', onData)
        }

        restored = true
      }
    }
  } catch (err) {
    console.warn('[Tangent 2] Failed to restore sessions:', err)
  }

  if (!restored) {
    sessionManager.create(configStore.getStartFolder())
  }
})

app.on('before-quit', () => {
  persistNow()
  syncListener.dispose()
})

app.on('window-all-closed', () => {
  pipeServer.stop()
  configStore.dispose()
  sdkSessionManager.dispose()
  ptyManager.dispose()
  app.quit()
})
