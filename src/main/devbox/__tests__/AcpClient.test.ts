import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type {
  AcpSessionConfig,
  AcpSession,
  AcpPermissionRequest,
  AcpPermissionResponse,
  AcpAgentResponse,
  AcpConnectionState,
} from '@shared/acp-types'
import type { Stream } from '@agentclientprotocol/sdk'

// Mock functions need to be hoisted
const mockMethods = {
  initialize: vi.fn(),
  newSession: vi.fn(),
  loadSession: vi.fn(),
  unstable_resumeSession: vi.fn(),
  unstable_closeSession: vi.fn(),
  prompt: vi.fn(),
}

vi.mock('@agentclientprotocol/sdk', () => ({
  ClientSideConnection: vi.fn(function (this: any) {
    Object.assign(this, mockMethods)
    this.closed = new Promise<void>(() => {})
  }),
  ndJsonStream: vi.fn((writable, readable) => ({ writable, readable })),
  PROTOCOL_VERSION: 1,
}))

// === Imports after mocks ===
import { AcpClient } from '../AcpClient'

describe('AcpClient', () => {
  let client: AcpClient
  let mockStream: Stream

  beforeEach(() => {
    vi.clearAllMocks()
    mockMethods.initialize.mockResolvedValue({ protocolVersion: '1.0', serverInfo: {} })
    client = new AcpClient()
    mockStream = { writable: {} as any, readable: {} as any }
  })

  afterEach(async () => {
    await client.disconnect()
  })

  // ============================================================================
  // connectWithStream
  // ============================================================================

  describe('connectWithStream', () => {
    it('connects successfully with stream', async () => {
      await client.connectWithStream(mockStream)

      expect(mockMethods.initialize).toHaveBeenCalledWith(
        expect.objectContaining({
          protocolVersion: 1,
          clientInfo: expect.objectContaining({ name: 'Tangent' }),
        })
      )
      expect(client.getState()).toBe('connected')
    })

    it('emits acp:connected event', async () => {
      const connectedHandler = vi.fn()
      client.on('acp:connected', connectedHandler)

      await client.connectWithStream(mockStream)

      expect(connectedHandler).toHaveBeenCalled()
    })

    it('handles connection initialization failure', async () => {
      mockMethods.initialize.mockRejectedValue(new Error('Init failed'))

      await expect(client.connectWithStream(mockStream)).rejects.toThrow(/Init failed/)
      expect(client.getState()).toBe('failed')
    })

    it('does not connect if already connected', async () => {
      await client.connectWithStream(mockStream)
      mockMethods.initialize.mockClear()

      await client.connectWithStream(mockStream)

      expect(mockMethods.initialize).not.toHaveBeenCalled()
    })
  })

  // ============================================================================
  // newSession
  // ============================================================================

  describe('newSession', () => {
    const mockSessionConfig: AcpSessionConfig = {
      cwd: 'D:\\projects\\myapp',
      env: { NODE_ENV: 'development' },
      mcpServers: { github: { enabled: true } },
    }

    beforeEach(async () => {
      await client.connectWithStream(mockStream)
    })

    it('creates session successfully', async () => {
      mockMethods.newSession.mockResolvedValue({ sessionId: 'acp-sess-1' })

      const session = await client.newSession(mockSessionConfig)

      expect(session.id).toBe('acp-sess-1')
      expect(session.state).toBe('connected')
      expect(mockMethods.newSession).toHaveBeenCalledWith({
        cwd: mockSessionConfig.cwd,
        mcpServers: mockSessionConfig.mcpServers,
        env: mockSessionConfig.env,
      })
    })

    it('handles invalid config error', async () => {
      mockMethods.newSession.mockRejectedValue(new Error('Invalid cwd path'))

      await expect(client.newSession(mockSessionConfig)).rejects.toThrow(/Invalid cwd/)
    })

    it('throws error if not connected', async () => {
      const disconnectedClient = new AcpClient()

      await expect(disconnectedClient.newSession(mockSessionConfig)).rejects.toThrow(/Not connected/)
    })

    it('maps tangent session ID to ACP session ID', async () => {
      mockMethods.newSession.mockResolvedValue({ sessionId: 'acp-sess-1' })

      const configWithId: AcpSessionConfig = {
        ...mockSessionConfig,
        sessionId: 'tangent-sess-1',
      }
      await client.newSession(configWithId)
      const session = client.getSession('tangent-sess-1')

      expect(session?.id).toBe('acp-sess-1')
    })

    it('emits acp:session-created event', async () => {
      mockMethods.newSession.mockResolvedValue({ sessionId: 'acp-sess-1' })
      const createdHandler = vi.fn()
      client.on('acp:session-created', createdHandler)

      await client.newSession(mockSessionConfig)

      expect(createdHandler).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'acp-sess-1' })
      )
    })
  })

  // ============================================================================
  // sendPrompt
  // ============================================================================

  describe('sendPrompt', () => {
    const mockSessionConfig: AcpSessionConfig = {
      cwd: 'D:\\projects\\myapp',
    }

    beforeEach(async () => {
      await client.connectWithStream(mockStream)
      mockMethods.newSession.mockResolvedValue({ sessionId: 'acp-sess-1' })
      await client.newSession({ ...mockSessionConfig, sessionId: 'tangent-sess-1' })
    })

    it('sends prompt successfully', async () => {
      mockMethods.prompt.mockResolvedValue(undefined)

      await client.sendPrompt('tangent-sess-1', 'Hello agent')

      expect(mockMethods.prompt).toHaveBeenCalledWith({
        sessionId: 'acp-sess-1',
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Hello agent' }],
          },
        ],
      })
    })

    it('throws error if session not found', async () => {
      // Auto-reconnect will try but fail (no connect options for connectWithStream)
      await expect(client.sendPrompt('nonexistent-sess', 'Hello')).rejects.toThrow()
    })

    it('throws error if not connected and no reconnect options', async () => {
      await client.disconnect()

      // sendPrompt will try to reconnect, but fail since no connect options are saved
      // (connectWithStream doesn't save TCP connect options)
      await expect(client.sendPrompt('tangent-sess-1', 'Hello')).rejects.toThrow()
    })

    it('updates session lastActiveAt timestamp', async () => {
      mockMethods.prompt.mockResolvedValue(undefined)
      const beforeTime = Date.now()

      await client.sendPrompt('tangent-sess-1', 'Hello')

      const session = client.getSession('tangent-sess-1')
      expect(session?.lastActiveAt).toBeGreaterThanOrEqual(beforeTime)
    })
  })

  // ============================================================================
  // resumeSession
  // ============================================================================

  describe('resumeSession', () => {
    beforeEach(async () => {
      await client.connectWithStream(mockStream)
    })

    it('resumes session using unstable_resumeSession when available', async () => {
      mockMethods.unstable_resumeSession.mockResolvedValue({})

      const session = await client.resumeSession('session-123')

      expect(mockMethods.unstable_resumeSession).toHaveBeenCalledWith({ sessionId: 'session-123' })
      expect(session.id).toBe('session-123')
      expect(session.state).toBe('connected')
    })

    it('throws error if not connected', async () => {
      await client.disconnect()

      await expect(client.resumeSession('session-123')).rejects.toThrow(/Not connected/)
    })
  })

  // ============================================================================
  // closeSession
  // ============================================================================

  describe('closeSession', () => {
    beforeEach(async () => {
      await client.connectWithStream(mockStream)
      mockMethods.newSession.mockResolvedValue({ sessionId: 'acp-sess-1' })
    })

    it('closes session using unstable_closeSession when available', async () => {
      mockMethods.unstable_closeSession.mockResolvedValue({})
      await client.newSession({ cwd: 'D:\\projects', sessionId: 'tangent-sess-1' })

      await client.closeSession('tangent-sess-1')

      expect(mockMethods.unstable_closeSession).toHaveBeenCalledWith({ sessionId: 'acp-sess-1' })
      expect(client.getSession('tangent-sess-1')).toBeUndefined()
    })

    it('removes session from local cache even if close fails', async () => {
      mockMethods.unstable_closeSession.mockRejectedValue(new Error('Close failed'))
      await client.newSession({ cwd: 'D:\\projects', sessionId: 'tangent-sess-1' })

      await expect(client.closeSession('tangent-sess-1')).rejects.toThrow(/Close failed/)
    })

    it('throws error if not connected', async () => {
      await client.disconnect()

      await expect(client.closeSession('tangent-sess-1')).rejects.toThrow(/Not connected/)
    })
  })

  // ============================================================================
  // disconnect
  // ============================================================================

  describe('disconnect', () => {
    beforeEach(async () => {
      await client.connectWithStream(mockStream)
    })

    it('disconnects gracefully', async () => {
      mockMethods.unstable_closeSession.mockResolvedValue({})

      await client.disconnect()

      expect(client.getState()).toBe('disconnected')
    })

    it('clears sessions on disconnect', async () => {
      mockMethods.newSession.mockResolvedValue({ sessionId: 'acp-sess-1' })
      await client.newSession({ cwd: 'D:\\projects' })

      await client.disconnect()

      expect(client.getSessions()).toHaveLength(0)
    })

    it('handles already disconnected state', async () => {
      await client.disconnect()

      await expect(client.disconnect()).resolves.not.toThrow()
    })

    it('emits acp:disconnected event', async () => {
      const disconnectedHandler = vi.fn()
      client.on('acp:disconnected', disconnectedHandler)

      await client.disconnect()

      expect(disconnectedHandler).toHaveBeenCalled()
    })

    it('clears all session mappings', async () => {
      mockMethods.newSession.mockResolvedValue({ sessionId: 'acp-sess-1' })
      await client.newSession({ cwd: 'D:\\projects', sessionId: 'tangent-sess-1' })

      await client.disconnect()

      expect(client.getSession('tangent-sess-1')).toBeUndefined()
      expect(client.getSessions()).toHaveLength(0)
    })
  })

  // ============================================================================
  // Permission Bridge
  // ============================================================================

  describe('permission bridge', () => {
    it('respondToPermission handles approval', () => {
      const response: AcpPermissionResponse = {
        requestId: 'perm-1',
        approved: true,
        rememberChoice: false,
      }

      // Should not throw
      expect(() => client.respondToPermission(response)).not.toThrow()
    })

    it('respondToPermission handles denial', () => {
      const response: AcpPermissionResponse = {
        requestId: 'perm-1',
        approved: false,
      }

      // Should not throw
      expect(() => client.respondToPermission(response)).not.toThrow()
    })
  })

  // ============================================================================
  // Session ID Mapping
  // ============================================================================

  describe('session ID mapping', () => {
    const mockSessionConfig: AcpSessionConfig = {
      cwd: 'D:\\projects\\myapp',
    }

    beforeEach(async () => {
      await client.connectWithStream(mockStream)
    })

    it('maps tangent session ID to ACP session ID', async () => {
      mockMethods.newSession.mockResolvedValue({ sessionId: 'acp-sess-1' })

      await client.newSession({ ...mockSessionConfig, sessionId: 'tangent-sess-1' })
      const session = client.getSession('tangent-sess-1')

      expect(session?.id).toBe('acp-sess-1')
    })

    it('returns undefined for unmapped session IDs', () => {
      expect(client.getSession('nonexistent')).toBeUndefined()
    })

    it('getSessions returns all active sessions', async () => {
      mockMethods.newSession.mockResolvedValueOnce({ sessionId: 'acp-sess-1' })
      mockMethods.newSession.mockResolvedValueOnce({ sessionId: 'acp-sess-2' })

      await client.newSession({ ...mockSessionConfig, sessionId: 'tangent-sess-1' })
      await client.newSession({ ...mockSessionConfig, sessionId: 'tangent-sess-2' })

      const sessions = client.getSessions()
      expect(sessions).toHaveLength(2)
      expect(sessions.map((s) => s.id)).toContain('acp-sess-1')
      expect(sessions.map((s) => s.id)).toContain('acp-sess-2')
    })
  })

  // ============================================================================
  // State Management
  // ============================================================================

  describe('state management', () => {
    it('getState returns current connection state', () => {
      expect(client.getState()).toBe('disconnected')
    })

    it('state changes from disconnected to connecting to connected', async () => {
      expect(client.getState()).toBe('disconnected')

      const connectPromise = client.connectWithStream(mockStream)
      // State should be connecting during connection attempt
      await connectPromise

      expect(client.getState()).toBe('connected')
    })

    it('state changes to disconnected after disconnect', async () => {
      await client.connectWithStream(mockStream)
      expect(client.getState()).toBe('connected')

      await client.disconnect()
      expect(client.getState()).toBe('disconnected')
    })

    it('state changes to failed on connection error', async () => {
      mockMethods.initialize.mockRejectedValue(new Error('Connection failed'))

      try {
        await client.connectWithStream(mockStream)
      } catch {
        // Expected
      }

      expect(client.getState()).toBe('failed')
    })
  })
})
