import { app, BrowserWindow, protocol, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { PtyManager } from './pty/PtyManager'
import { SessionStore } from './session/SessionStore'
import { SessionManager } from './session/SessionManager'
import { SdkSessionManager } from './session/SdkSessionManager'
import { AgentStore } from './agents/AgentStore'
import { AgentLauncher } from './agents/AgentLauncher'
import { ConfigStore } from './config/ConfigStore'
import { registerIpcHandlers } from './ipc/handlers'

const SESSIONS_PATH = join(homedir(), '.tangent', 'sessions.json')

let mainWindow: BrowserWindow | null = null

const configStore = new ConfigStore()
const ptyManager = new PtyManager()
const sessionStore = new SessionStore()
const sessionManager = new SessionManager(sessionStore, ptyManager)
const agentStore = new AgentStore()
const agentLauncher = new AgentLauncher(ptyManager, sessionStore, sessionManager)
const sdkSessionManager = new SdkSessionManager(
  sessionStore,
  ptyManager,
  () => mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
)
sessionManager.setSdkManager(sdkSessionManager)

function createWindow(): void {
  mainWindow = new BrowserWindow({
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

  registerIpcHandlers({
    sessionManager,
    sessionStore,
    ptyManager,
    agentStore,
    agentLauncher,
    configStore,
    sdkSessionManager,
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
  createWindow()

  // Restore saved sessions or create a fresh one
  let restored = false
  try {
    if (existsSync(SESSIONS_PATH)) {
      const raw = readFileSync(SESSIONS_PATH, 'utf-8')
      const saved = JSON.parse(raw)
      if (saved.sessions?.length > 0) {
        const agentSessions: Array<{ sessionId: string; ptyId: string; saved: typeof saved.sessions[0] }> = []

        for (const s of saved.sessions) {
          const session = sessionManager.create(s.folderPath)
          if (s.isRenamed && s.name) {
            sessionStore.rename(session.id, s.name)
          }
          if (s.agentCommand) {
            agentSessions.push({ sessionId: session.id, ptyId: session.ptyId, saved: s })
          }
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

            const args = [...(s.agentArgs || [])]
            // Append --resume to reconnect to the agent's prior conversation
            if (s.agentType !== 'shell' && !args.includes('--resume')) {
              args.push('--resume')
            }

            const argsStr = args.map((a: string) => `'${psEscape(a)}'`).join(' ')
            const cmd = argsStr ? `${s.agentCommand} ${argsStr}` : s.agentCommand
            lines.push(cmd)

            ptyManager.write(ptyId, lines.join('\r') + '\r')

            const agentType = s.agentType !== 'shell' ? s.agentType : undefined
            if (agentType) {
              sessionStore.promoteToAgent(sessionId, agentType)
              sessionStore.setAgentLaunchInfo(sessionId, s.agentCommand, args, s.agentEnv)
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
            console.warn(`[Tangent] Shell ready timeout for session ${sessionId}, replaying anyway`)
            replayCommand()
          }, SHELL_READY_TIMEOUT_MS)
          ptyManager.on('data', onData)
        }

        restored = true
        unlinkSync(SESSIONS_PATH)
      }
    }
  } catch (err) {
    console.warn('[Tangent] Failed to restore sessions:', err)
  }

  if (!restored) {
    sessionManager.create(configStore.getStartFolder())
  }
})

app.on('before-quit', () => {
  // Save restorable sessions to disk
  try {
    const all = sessionStore.getAll()
    const activeId = sessionManager.getActiveSessionId()
    const restorable = all.filter(s => !s.isExternal && s.status !== 'exited')
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
          agentEnv: s.agentEnv
        }))
      }
      mkdirSync(join(homedir(), '.tangent'), { recursive: true })
      writeFileSync(SESSIONS_PATH, JSON.stringify(data, null, 2), 'utf-8')
    }
  } catch (err) {
    console.warn('[Tangent] Failed to save sessions:', err)
  }
})

app.on('window-all-closed', () => {
  sdkSessionManager.dispose()
  ptyManager.dispose()
  app.quit()
})
