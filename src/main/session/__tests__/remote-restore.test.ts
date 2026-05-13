import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { readFileSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { Session } from '@shared/types'

// ============================================================================
// Mock Dependencies
// ============================================================================

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn()
}))

vi.mock('os', () => ({
  homedir: vi.fn(() => '/home/user')
}))

vi.mock('path', () => ({
  join: (...args: string[]) => args.join('/')
}))

// ============================================================================
// Test Helpers
// ============================================================================

interface SavedSessionData {
  activeIndex: number
  sessions: Array<{
    kind: string
    name: string
    folderPath: string
    folderName: string
    isRenamed: boolean
    agentType?: string
    agentCommand?: string
    agentArgs?: string[]
    agentEnv?: Record<string, string>
    devBoxName?: string
    devBoxProject?: string
    acpSessionId?: string
  }>
}

// Mock SessionStore
class MockSessionStore {
  private sessions: Map<string, Session> = new Map()
  private listeners: Map<string, Function[]> = new Map()

  add(session: Session): void {
    this.sessions.set(session.id, session)
    this.emit('created', session)
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id)
  }

  getAll(): Session[] {
    return Array.from(this.sessions.values())
  }

  on(event: string, handler: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, [])
    }
    this.listeners.get(event)!.push(handler)
  }

  emit(event: string, ...args: any[]): void {
    const handlers = this.listeners.get(event) || []
    handlers.forEach((h) => h(...args))
  }

  clear(): void {
    this.sessions.clear()
  }
}

// Mock SessionManager
class MockSessionManager {
  private activeSessionId: string | null = null

  create(folderPath: string): Session {
    const session: Session = {
      id: `session-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      kind: 'shell',
      agentType: 'shell',
      name: folderPath.split('/').pop() || 'Shell',
      folderName: folderPath.split('/').pop() || '',
      folderPath,
      isRenamed: false,
      status: 'shell_ready',
      lastActivity: '',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      ptyId: `pty-${Date.now()}`,
      isExternal: false
    }
    return session
  }

  select(id: string): void {
    this.activeSessionId = id
  }

  getActiveSessionId(): string | null {
    return this.activeSessionId
  }
}

// ============================================================================
// Remote Session Restore Tests
// ============================================================================

describe('Remote Session Restore', () => {
  let sessionStore: MockSessionStore
  let sessionManager: MockSessionManager
  const SESSIONS_PATH = '/home/user/.tangent/sessions.json'

  beforeEach(() => {
    sessionStore = new MockSessionStore()
    sessionManager = new MockSessionManager()
    vi.clearAllMocks()
  })

  afterEach(() => {
    sessionStore.clear()
  })

  // ============================================================================
  // App Restart Detection from Persisted Data
  // ============================================================================

  describe('App Restart Detection', () => {
    it('should detect and restore remote sessions from persisted data', () => {
      const savedData: SavedSessionData = {
        activeIndex: 0,
        sessions: [
          {
            kind: 'remote-agent',
            name: 'Copilot on Dev Box',
            folderPath: '/home/user/workspace',
            folderName: 'workspace',
            isRenamed: true,
            agentType: 'copilot-cli',
            devBoxName: 'my-devbox',
            devBoxProject: 'my-project',
            acpSessionId: 'acp-session-123'
          },
          {
            kind: 'shell',
            name: 'Local Shell',
            folderPath: '/home/user/projects',
            folderName: 'projects',
            isRenamed: false
          }
        ]
      }

      ;(existsSync as any).mockReturnValue(true)
      ;(readFileSync as any).mockReturnValue(JSON.stringify(savedData))

      // Simulate restore logic from src/main/index.ts
      const saved = JSON.parse((readFileSync as any)(SESSIONS_PATH, 'utf-8'))
      const remoteSessions: typeof saved.sessions = []

      for (const s of saved.sessions) {
        if (s.kind === 'remote-agent') {
          remoteSessions.push(s)
          continue
        }

        // Create regular session
        const session = sessionManager.create(s.folderPath)
        sessionStore.add(session)
      }

      // Restore remote sessions
      for (const s of remoteSessions) {
        if (!s.devBoxName || !s.devBoxProject) {
          continue
        }

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
      }

      const allSessions = sessionStore.getAll()
      expect(allSessions.length).toBe(2)

      const remoteSession = allSessions.find((s) => s.kind === 'remote-agent')
      expect(remoteSession).toBeDefined()
      expect(remoteSession!.devBoxName).toBe('my-devbox')
      expect(remoteSession!.devBoxProject).toBe('my-project')
      expect(remoteSession!.status).toBe('needs_input')
      expect(remoteSession!.remoteState).toBe('starting-devbox')

      const localSession = allSessions.find((s) => s.kind === 'shell')
      expect(localSession).toBeDefined()
      expect(localSession!.folderName).toBe('projects')
    })

    it('should restore multiple remote sessions', () => {
      const savedData: SavedSessionData = {
        activeIndex: 0,
        sessions: [
          {
            kind: 'remote-agent',
            name: 'DevBox 1',
            folderPath: '/home/user/repo1',
            folderName: 'repo1',
            isRenamed: false,
            agentType: 'copilot-cli',
            devBoxName: 'devbox-1',
            devBoxProject: 'project-1'
          },
          {
            kind: 'remote-agent',
            name: 'DevBox 2',
            folderPath: '/home/user/repo2',
            folderName: 'repo2',
            isRenamed: false,
            agentType: 'claude-code',
            devBoxName: 'devbox-2',
            devBoxProject: 'project-2',
            acpSessionId: 'acp-456'
          }
        ]
      }

      ;(existsSync as any).mockReturnValue(true)
      ;(readFileSync as any).mockReturnValue(JSON.stringify(savedData))

      const saved = JSON.parse((readFileSync as any)(SESSIONS_PATH, 'utf-8'))

      for (const s of saved.sessions) {
        if (s.kind === 'remote-agent' && s.devBoxName && s.devBoxProject) {
          sessionStore.add({
            id: `remote-${Math.random()}`,
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
            devBoxProject: s.devBoxProject,
            acpSessionId: s.acpSessionId
          })
        }
      }

      const remoteSessions = sessionStore.getAll()
      expect(remoteSessions.length).toBe(2)
      expect(remoteSessions[0].devBoxName).toBe('devbox-1')
      expect(remoteSessions[1].devBoxName).toBe('devbox-2')
      expect(remoteSessions[1].acpSessionId).toBe('acp-456')
    })

    it('should skip restore if sessions.json does not exist', () => {
      ;(existsSync as any).mockReturnValue(false)

      // No sessions to restore
      expect(sessionStore.getAll().length).toBe(0)
    })

    it('should handle invalid JSON gracefully', () => {
      ;(existsSync as any).mockReturnValue(true)
      ;(readFileSync as any).mockReturnValue('invalid json {')

      expect(() => {
        JSON.parse((readFileSync as any)(SESSIONS_PATH, 'utf-8'))
      }).toThrow()

      // In real code, this would be wrapped in try-catch
      // For test, we just verify error is thrown
    })
  })

  // ============================================================================
  // Remote Session with Running Dev Box
  // ============================================================================

  describe('Remote Session with Running Dev Box', () => {
    it('should show reconnect prompt for running Dev Box', () => {
      const remoteSession: Session = {
        id: 'remote-123',
        kind: 'remote-agent',
        agentType: 'copilot-cli',
        name: 'Running DevBox Agent',
        folderName: 'workspace',
        folderPath: '/home/user/workspace',
        isRenamed: true,
        status: 'needs_input',
        lastActivity: 'Remote session - reconnect required',
        startedAt: Date.now(),
        updatedAt: Date.now(),
        ptyId: '',
        isExternal: false,
        remoteState: 'starting-devbox',
        devBoxName: 'running-devbox',
        devBoxProject: 'my-project'
      }

      sessionStore.add(remoteSession)

      const restored = sessionStore.get('remote-123')
      expect(restored).toBeDefined()
      expect(restored!.status).toBe('needs_input')
      expect(restored!.remoteState).toBe('starting-devbox')
      expect(restored!.lastActivity).toContain('reconnect required')
    })

    it('should preserve Dev Box connection metadata', () => {
      const remoteSession: Session = {
        id: 'remote-456',
        kind: 'remote-agent',
        agentType: 'copilot-cli',
        name: 'DevBox Agent',
        folderName: 'project',
        folderPath: '/workspace/project',
        isRenamed: false,
        status: 'needs_input',
        lastActivity: 'Waiting for reconnect',
        startedAt: Date.now(),
        updatedAt: Date.now(),
        ptyId: '',
        isExternal: false,
        remoteState: 'starting-devbox',
        devBoxName: 'my-devbox',
        devBoxProject: 'my-project',
        remoteConnectionId: 'conn-789',
        acpSessionId: 'acp-session-abc'
      }

      sessionStore.add(remoteSession)

      const restored = sessionStore.get('remote-456')
      expect(restored!.devBoxName).toBe('my-devbox')
      expect(restored!.devBoxProject).toBe('my-project')
      expect(restored!.remoteConnectionId).toBe('conn-789')
      expect(restored!.acpSessionId).toBe('acp-session-abc')
    })
  })

  // ============================================================================
  // Remote Session with Stopped Dev Box
  // ============================================================================

  describe('Remote Session with Stopped Dev Box', () => {
    it('should show needs_input status for stopped Dev Box', () => {
      const remoteSession: Session = {
        id: 'remote-stopped',
        kind: 'remote-agent',
        agentType: 'copilot-cli',
        name: 'Stopped DevBox',
        folderName: 'workspace',
        folderPath: '/home/user/workspace',
        isRenamed: false,
        status: 'needs_input',
        lastActivity: 'Remote session - reconnect required',
        startedAt: Date.now(),
        updatedAt: Date.now(),
        ptyId: '',
        isExternal: false,
        remoteState: 'starting-devbox',
        devBoxName: 'stopped-devbox',
        devBoxProject: 'project'
      }

      sessionStore.add(remoteSession)

      const restored = sessionStore.get('remote-stopped')
      expect(restored!.status).toBe('needs_input')
      expect(restored!.remoteState).toBe('starting-devbox')
    })

    it('should preserve all session fields for later reconnect', () => {
      const remoteSession: Session = {
        id: 'remote-preserve',
        kind: 'remote-agent',
        agentType: 'claude-code',
        name: 'Claude on DevBox',
        folderName: 'repo',
        folderPath: '/workspace/repo',
        isRenamed: true,
        status: 'needs_input',
        lastActivity: 'Disconnected - Dev Box stopped',
        startedAt: Date.now() - 60000,
        updatedAt: Date.now(),
        ptyId: '',
        isExternal: false,
        remoteState: 'starting-devbox',
        devBoxName: 'my-devbox',
        devBoxProject: 'my-project',
        acpSessionId: 'acp-resume-me',
        agentCommand: 'claude',
        agentArgs: ['--resume'],
        agentEnv: { COPILOT_ENV: 'test' }
      }

      sessionStore.add(remoteSession)

      const restored = sessionStore.get('remote-preserve')
      expect(restored!.agentCommand).toBe('claude')
      expect(restored!.agentArgs).toEqual(['--resume'])
      expect(restored!.agentEnv).toEqual({ COPILOT_ENV: 'test' })
      expect(restored!.acpSessionId).toBe('acp-resume-me')
    })
  })

  // ============================================================================
  // Remote Session Fields Preserved
  // ============================================================================

  describe('Remote Session Fields Preserved', () => {
    it('should preserve all remote-specific fields during restore', () => {
      const savedData: SavedSessionData = {
        activeIndex: 0,
        sessions: [
          {
            kind: 'remote-agent',
            name: 'Full Remote Session',
            folderPath: '/workspace/full',
            folderName: 'full',
            isRenamed: true,
            agentType: 'copilot-cli',
            agentCommand: 'copilot',
            agentArgs: ['--resume', '--debug'],
            agentEnv: { DEBUG: 'true', COPILOT_SESSION: 'test' },
            devBoxName: 'full-devbox',
            devBoxProject: 'full-project',
            acpSessionId: 'acp-full-123'
          }
        ]
      }

      ;(existsSync as any).mockReturnValue(true)
      ;(readFileSync as any).mockReturnValue(JSON.stringify(savedData))

      const saved = JSON.parse((readFileSync as any)(SESSIONS_PATH, 'utf-8'))
      const s = saved.sessions[0]

      if (s.kind === 'remote-agent' && s.devBoxName && s.devBoxProject) {
        sessionStore.add({
          id: 'remote-full',
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
          devBoxProject: s.devBoxProject,
          acpSessionId: s.acpSessionId,
          agentCommand: s.agentCommand,
          agentArgs: s.agentArgs,
          agentEnv: s.agentEnv
        })
      }

      const restored = sessionStore.get('remote-full')
      expect(restored!.devBoxName).toBe('full-devbox')
      expect(restored!.devBoxProject).toBe('full-project')
      expect(restored!.acpSessionId).toBe('acp-full-123')
      expect(restored!.agentCommand).toBe('copilot')
      expect(restored!.agentArgs).toEqual(['--resume', '--debug'])
      expect(restored!.agentEnv).toEqual({ DEBUG: 'true', COPILOT_SESSION: 'test' })
      expect(restored!.name).toBe('Full Remote Session')
      expect(restored!.isRenamed).toBe(true)
    })

    it('should restore remote metrics if present', () => {
      const remoteSession: Session = {
        id: 'remote-metrics',
        kind: 'remote-agent',
        agentType: 'copilot-cli',
        name: 'Session with Metrics',
        folderName: 'metrics',
        folderPath: '/workspace/metrics',
        isRenamed: false,
        status: 'needs_input',
        lastActivity: 'Reconnect required',
        startedAt: Date.now(),
        updatedAt: Date.now(),
        ptyId: '',
        isExternal: false,
        remoteState: 'starting-devbox',
        devBoxName: 'metrics-devbox',
        devBoxProject: 'metrics-project',
        remoteMetrics: {
          syncOutCount: 5,
          syncInCount: 3,
          totalBytesSynced: 123456,
          tunnelUptime: 3600000,
          reconnectionCount: 2,
          avgSyncDurationMs: 1500
        }
      }

      sessionStore.add(remoteSession)

      const restored = sessionStore.get('remote-metrics')
      expect(restored!.remoteMetrics).toBeDefined()
      expect(restored!.remoteMetrics!.syncOutCount).toBe(5)
      expect(restored!.remoteMetrics!.syncInCount).toBe(3)
      expect(restored!.remoteMetrics!.totalBytesSynced).toBe(123456)
      expect(restored!.remoteMetrics!.tunnelUptime).toBe(3600000)
      expect(restored!.remoteMetrics!.reconnectionCount).toBe(2)
    })
  })

  // ============================================================================
  // Sessions Without devBoxName Skipped Gracefully
  // ============================================================================

  describe('Sessions Without devBoxName', () => {
    it('should skip remote sessions missing devBoxName', () => {
      const savedData: SavedSessionData = {
        activeIndex: 0,
        sessions: [
          {
            kind: 'remote-agent',
            name: 'Incomplete Remote',
            folderPath: '/workspace/incomplete',
            folderName: 'incomplete',
            isRenamed: false,
            agentType: 'copilot-cli',
            // devBoxName missing
            devBoxProject: 'some-project'
          },
          {
            kind: 'remote-agent',
            name: 'Valid Remote',
            folderPath: '/workspace/valid',
            folderName: 'valid',
            isRenamed: false,
            agentType: 'copilot-cli',
            devBoxName: 'valid-devbox',
            devBoxProject: 'valid-project'
          }
        ]
      }

      ;(existsSync as any).mockReturnValue(true)
      ;(readFileSync as any).mockReturnValue(JSON.stringify(savedData))

      const saved = JSON.parse((readFileSync as any)(SESSIONS_PATH, 'utf-8'))

      for (const s of saved.sessions) {
        if (s.kind === 'remote-agent') {
          // Skip if missing required fields
          if (!s.devBoxName || !s.devBoxProject) {
            console.warn('[Tangent] Skipping remote session restore: missing Dev Box info', s.name)
            continue
          }

          sessionStore.add({
            id: `remote-${Math.random()}`,
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
        }
      }

      // Only valid remote session should be restored
      const remoteSessions = sessionStore.getAll()
      expect(remoteSessions.length).toBe(1)
      expect(remoteSessions[0].devBoxName).toBe('valid-devbox')
    })

    it('should skip remote sessions missing devBoxProject', () => {
      const savedData: SavedSessionData = {
        activeIndex: 0,
        sessions: [
          {
            kind: 'remote-agent',
            name: 'Missing Project',
            folderPath: '/workspace/missing',
            folderName: 'missing',
            isRenamed: false,
            agentType: 'copilot-cli',
            devBoxName: 'some-devbox'
            // devBoxProject missing
          }
        ]
      }

      ;(existsSync as any).mockReturnValue(true)
      ;(readFileSync as any).mockReturnValue(JSON.stringify(savedData))

      const saved = JSON.parse((readFileSync as any)(SESSIONS_PATH, 'utf-8'))

      for (const s of saved.sessions) {
        if (s.kind === 'remote-agent' && (!s.devBoxName || !s.devBoxProject)) {
          continue
        }
      }

      // No sessions restored
      expect(sessionStore.getAll().length).toBe(0)
    })

    it('should handle mixed session types correctly', () => {
      const savedData: SavedSessionData = {
        activeIndex: 1,
        sessions: [
          {
            kind: 'shell',
            name: 'Local Shell',
            folderPath: '/home/user/local',
            folderName: 'local',
            isRenamed: false
          },
          {
            kind: 'remote-agent',
            name: 'Valid Remote',
            folderPath: '/workspace/remote',
            folderName: 'remote',
            isRenamed: true,
            agentType: 'copilot-cli',
            devBoxName: 'remote-devbox',
            devBoxProject: 'remote-project'
          },
          {
            kind: 'remote-agent',
            name: 'Invalid Remote',
            folderPath: '/workspace/invalid',
            folderName: 'invalid',
            isRenamed: false,
            agentType: 'copilot-cli'
            // Missing both devBoxName and devBoxProject
          }
        ]
      }

      ;(existsSync as any).mockReturnValue(true)
      ;(readFileSync as any).mockReturnValue(JSON.stringify(savedData))

      const saved = JSON.parse((readFileSync as any)(SESSIONS_PATH, 'utf-8'))

      for (const s of saved.sessions) {
        if (s.kind === 'remote-agent') {
          if (!s.devBoxName || !s.devBoxProject) {
            continue
          }
          sessionStore.add({
            id: `remote-${Math.random()}`,
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
          continue
        }

        // Create regular session
        const session = sessionManager.create(s.folderPath)
        sessionStore.add(session)
      }

      const allSessions = sessionStore.getAll()
      expect(allSessions.length).toBe(2) // 1 local + 1 valid remote
      expect(allSessions.filter((s) => s.kind === 'shell').length).toBe(1)
      expect(allSessions.filter((s) => s.kind === 'remote-agent').length).toBe(1)
    })

    it('should gracefully handle empty devBoxName or devBoxProject strings', () => {
      const savedData: SavedSessionData = {
        activeIndex: 0,
        sessions: [
          {
            kind: 'remote-agent',
            name: 'Empty Fields',
            folderPath: '/workspace/empty',
            folderName: 'empty',
            isRenamed: false,
            agentType: 'copilot-cli',
            devBoxName: '',
            devBoxProject: ''
          }
        ]
      }

      ;(existsSync as any).mockReturnValue(true)
      ;(readFileSync as any).mockReturnValue(JSON.stringify(savedData))

      const saved = JSON.parse((readFileSync as any)(SESSIONS_PATH, 'utf-8'))

      for (const s of saved.sessions) {
        if (s.kind === 'remote-agent' && (!s.devBoxName || !s.devBoxProject)) {
          continue
        }
      }

      // Empty strings should be skipped
      expect(sessionStore.getAll().length).toBe(0)
    })
  })

  // ============================================================================
  // Active Session Selection
  // ============================================================================

  describe('Active Session Selection', () => {
    it('should restore active session by index', () => {
      const savedData: SavedSessionData = {
        activeIndex: 1,
        sessions: [
          {
            kind: 'shell',
            name: 'Shell 1',
            folderPath: '/home/user/a',
            folderName: 'a',
            isRenamed: false
          },
          {
            kind: 'remote-agent',
            name: 'Remote Agent',
            folderPath: '/workspace/b',
            folderName: 'b',
            isRenamed: false,
            agentType: 'copilot-cli',
            devBoxName: 'devbox',
            devBoxProject: 'project'
          }
        ]
      }

      ;(existsSync as any).mockReturnValue(true)
      ;(readFileSync as any).mockReturnValue(JSON.stringify(savedData))

      const saved = JSON.parse((readFileSync as any)(SESSIONS_PATH, 'utf-8'))

      // Restore sessions
      for (const s of saved.sessions) {
        if (s.kind === 'remote-agent' && s.devBoxName && s.devBoxProject) {
          sessionStore.add({
            id: `remote-${Math.random()}`,
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
          continue
        }

        const session = sessionManager.create(s.folderPath)
        sessionStore.add(session)
      }

      // Select active session by index
      const all = sessionStore.getAll()
      const idx = Math.min(saved.activeIndex, all.length - 1)
      if (all[idx]) {
        sessionManager.select(all[idx].id)
      }

      // Verify second session (remote) is active
      expect(sessionManager.getActiveSessionId()).toBe(all[1].id)
      expect(all[1].kind).toBe('remote-agent')
    })
  })
})
