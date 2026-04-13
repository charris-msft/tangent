import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type {
  AcpSessionConfig,
  AcpSession,
  AcpPermissionRequest,
  AcpPermissionResponse,
  AcpAgentResponse
} from '@shared/acp-types'
import type * as schema from '@agentclientprotocol/sdk'
import type { Stream } from '@agentclientprotocol/sdk'

// Mock functions need to be hoisted
const mockMethods = {
  initialize: vi.fn(),
  newSession: vi.fn(),
  loadSession: vi.fn(),
  unstable_resumeSession: vi.fn(),
  unstable_closeSession: vi.fn(),
  prompt: vi.fn()
}

let closedPromiseResolve: (() => void) | null = null
let closedPromiseReject: ((err: Error) => void) | null = null

vi.mock('@agentclientprotocol/sdk', () => ({
  ClientSideConnection: vi.fn(function (this: any) {
    Object.assign(this, mockMethods)
    this.closed = new Promise<void>((resolve, reject) => {
      closedPromiseResolve = resolve
      closedPromiseReject = reject
    })
  }),
  ndJsonStream: vi.fn((writable, readable) => ({ writable, readable }))
}))

// === Imports after mocks ===
import { AcpClient } from '../AcpClient'

describe('ACP Integration', () => {
  let client: AcpClient
  let mockStream: Stream
  let clientHandler: any

  beforeEach(() => {
    vi.clearAllMocks()
    mockMethods.initialize.mockResolvedValue({
      protocolVersion: '1.0',
      serverInfo: { name: 'Copilot CLI', version: '1.0.0' }
    })
    mockMethods.unstable_closeSession.mockResolvedValue({})
    client = new AcpClient()
    mockStream = { writable: {} as any, readable: {} as any }
    closedPromiseResolve = null
    closedPromiseReject = null
  })

  afterEach(async () => {
    await client.disconnect()
  })

  // ============================================================================
  // Connection Lifecycle
  // ============================================================================

  describe('Connection Lifecycle', () => {
    it('connects and initializes ACP protocol', async () => {
      await client.connectWithStream(mockStream)

      expect(mockMethods.initialize).toHaveBeenCalledWith({
        protocolVersion: '1.0',
        clientInfo: {
          name: 'Tangent',
          version: '2.0.0'
        },
        capabilities: {
          experimental: {}
        }
      })
      expect(client.getState()).toBe('connected')
    })

    it('handles connection failure gracefully', async () => {
      mockMethods.initialize.mockRejectedValue(new Error('Network timeout'))
      const errorHandler = vi.fn()
      client.on('acp:error', errorHandler)

      await expect(client.connectWithStream(mockStream)).rejects.toThrow(/Network timeout/)

      expect(client.getState()).toBe('failed')
      expect(errorHandler).toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringContaining('Network timeout')
      }))
    })

    it('disconnects and cleans up resources', async () => {
      await client.connectWithStream(mockStream)
      mockMethods.newSession.mockResolvedValue({ sessionId: 'acp-sess-1' })
      await client.newSession({ cwd: 'D:\\projects', sessionId: 'tangent-sess-1' })

      const disconnectedHandler = vi.fn()
      client.on('acp:disconnected', disconnectedHandler)

      await client.disconnect()

      expect(client.getState()).toBe('disconnected')
      expect(disconnectedHandler).toHaveBeenCalled()
      expect(client.getSessions()).toHaveLength(0)
      expect(client.getSession('tangent-sess-1')).toBeUndefined()
    })

    it('prevents multiple simultaneous connections', async () => {
      await client.connectWithStream(mockStream)
      mockMethods.initialize.mockClear()

      await client.connectWithStream(mockStream)

      expect(mockMethods.initialize).not.toHaveBeenCalled()
    })

    it('handles connection closed gracefully', async () => {
      await client.connectWithStream(mockStream)
      const disconnectedHandler = vi.fn()
      client.on('acp:disconnected', disconnectedHandler)

      closedPromiseResolve!()
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(client.getState()).toBe('disconnected')
      expect(disconnectedHandler).toHaveBeenCalled()
    })

    it('handles connection closed with error', async () => {
      await client.connectWithStream(mockStream)
      const errorHandler = vi.fn()
      client.on('acp:error', errorHandler)

      closedPromiseReject!(new Error('Connection lost'))
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(client.getState()).toBe('failed')
      expect(errorHandler).toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringContaining('Connection lost')
      }))
    })
  })

  // ============================================================================
  // Session Management
  // ============================================================================

  describe('Session Management', () => {
    beforeEach(async () => {
      await client.connectWithStream(mockStream)
    })

    it('creates session with workspace config', async () => {
      const config: AcpSessionConfig = {
        cwd: 'D:\\projects\\myapp',
        env: { NODE_ENV: 'production', API_KEY: 'secret' },
        mcpServers: {
          github: { enabled: true },
          azure: { region: 'eastus' }
        },
        sessionId: 'tangent-sess-1'
      }

      mockMethods.newSession.mockResolvedValue({ sessionId: 'acp-sess-1' })
      const sessionCreatedHandler = vi.fn()
      client.on('acp:session-created', sessionCreatedHandler)

      const session = await client.newSession(config)

      expect(mockMethods.newSession).toHaveBeenCalledWith({
        cwd: 'D:\\projects\\myapp',
        env: { NODE_ENV: 'production', API_KEY: 'secret' },
        mcpServers: {
          github: { enabled: true },
          azure: { region: 'eastus' }
        }
      })
      expect(session.id).toBe('acp-sess-1')
      expect(session.state).toBe('connected')
      expect(session.config).toEqual(config)
      expect(sessionCreatedHandler).toHaveBeenCalledWith(session)
    })

    it('resumes session with unstable_resumeSession', async () => {
      mockMethods.unstable_resumeSession.mockResolvedValue({})

      const session = await client.resumeSession('session-123')

      expect(mockMethods.unstable_resumeSession).toHaveBeenCalledWith({
        sessionId: 'session-123'
      })
      expect(mockMethods.loadSession).not.toHaveBeenCalled()
      expect(session.id).toBe('session-123')
      expect(session.state).toBe('connected')
    })

    it('resumes session with loadSession fallback', async () => {
      // Create a new client with only loadSession support
      const fallbackClient = new AcpClient()
      
      // Mock connection with loadSession but no unstable_resumeSession
      const ClientSideConnection = (await import('@agentclientprotocol/sdk')).ClientSideConnection as any
      ClientSideConnection.mockImplementationOnce(function (this: any) {
        this.initialize = mockMethods.initialize
        this.newSession = mockMethods.newSession
        this.prompt = mockMethods.prompt
        this.loadSession = mockMethods.loadSession
        this.unstable_closeSession = mockMethods.unstable_closeSession
        // Deliberately omit unstable_resumeSession
        this.closed = new Promise<void>(() => {})
      })

      await fallbackClient.connectWithStream(mockStream)
      mockMethods.loadSession.mockResolvedValue({})

      const session = await fallbackClient.resumeSession('session-123')

      expect(mockMethods.loadSession).toHaveBeenCalledWith({
        sessionId: 'session-123'
      })
      expect(mockMethods.unstable_resumeSession).not.toHaveBeenCalled()
      expect(session.id).toBe('session-123')
      expect(session.state).toBe('connected')

      await fallbackClient.disconnect()
    })

    it('throws error when agent does not support session resumption', async () => {
      // Create a new client without resume support
      const noResumeClient = new AcpClient()
      
      // Mock connection without resume methods
      const ClientSideConnection = (await import('@agentclientprotocol/sdk')).ClientSideConnection as any
      ClientSideConnection.mockImplementationOnce(function (this: any) {
        this.initialize = mockMethods.initialize
        this.newSession = mockMethods.newSession
        this.prompt = mockMethods.prompt
        // Deliberately omit unstable_resumeSession and loadSession
        this.closed = new Promise<void>(() => {})
      })

      await noResumeClient.connectWithStream(mockStream)
      
      await expect(noResumeClient.resumeSession('session-123')).rejects.toThrow(
        /does not support session resumption/
      )

      await noResumeClient.disconnect()
    })

    it('closes session and removes mappings', async () => {
      mockMethods.newSession.mockResolvedValue({ sessionId: 'acp-sess-1' })
      await client.newSession({ cwd: 'D:\\projects', sessionId: 'tangent-sess-1' })

      await client.closeSession('tangent-sess-1')

      expect(mockMethods.unstable_closeSession).toHaveBeenCalledWith({
        sessionId: 'acp-sess-1'
      })
      expect(client.getSession('tangent-sess-1')).toBeUndefined()
      expect(client.getSessions()).toHaveLength(0)
    })

    it('tracks multiple sessions independently', async () => {
      mockMethods.newSession.mockResolvedValueOnce({ sessionId: 'acp-sess-1' })
      mockMethods.newSession.mockResolvedValueOnce({ sessionId: 'acp-sess-2' })
      mockMethods.newSession.mockResolvedValueOnce({ sessionId: 'acp-sess-3' })

      await client.newSession({ cwd: 'D:\\projects\\app1', sessionId: 'tangent-sess-1' })
      await client.newSession({ cwd: 'D:\\projects\\app2', sessionId: 'tangent-sess-2' })
      await client.newSession({ cwd: 'D:\\projects\\app3', sessionId: 'tangent-sess-3' })

      const sessions = client.getSessions()
      expect(sessions).toHaveLength(3)
      expect(sessions.map(s => s.id)).toEqual(['acp-sess-1', 'acp-sess-2', 'acp-sess-3'])
      expect(client.getSession('tangent-sess-1')?.id).toBe('acp-sess-1')
      expect(client.getSession('tangent-sess-2')?.id).toBe('acp-sess-2')
      expect(client.getSession('tangent-sess-3')?.id).toBe('acp-sess-3')
    })

    it('maps Tangent session IDs to ACP session IDs bidirectionally', async () => {
      mockMethods.newSession.mockResolvedValue({ sessionId: 'acp-sess-1' })

      await client.newSession({ cwd: 'D:\\projects', sessionId: 'tangent-sess-1' })

      // Forward mapping: Tangent → ACP
      const session = client.getSession('tangent-sess-1')
      expect(session?.id).toBe('acp-sess-1')

      // Session is stored with ACP ID
      expect(client.getSessions()[0].id).toBe('acp-sess-1')
    })

    it('sends prompt to correct ACP session', async () => {
      mockMethods.newSession.mockResolvedValue({ sessionId: 'acp-sess-1' })
      mockMethods.prompt.mockResolvedValue(undefined)
      await client.newSession({ cwd: 'D:\\projects', sessionId: 'tangent-sess-1' })

      await client.sendPrompt('tangent-sess-1', 'Write a test')

      expect(mockMethods.prompt).toHaveBeenCalledWith({
        sessionId: 'acp-sess-1',
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Write a test' }]
          }
        ]
      })
    })

    it('updates lastActiveAt on prompt send', async () => {
      mockMethods.newSession.mockResolvedValue({ sessionId: 'acp-sess-1' })
      mockMethods.prompt.mockResolvedValue(undefined)
      await client.newSession({ cwd: 'D:\\projects', sessionId: 'tangent-sess-1' })
      const beforeTime = Date.now()

      await client.sendPrompt('tangent-sess-1', 'Write a test')

      const session = client.getSession('tangent-sess-1')
      expect(session?.lastActiveAt).toBeGreaterThanOrEqual(beforeTime)
    })
  })

  // ============================================================================
  // Permission Bridge
  // ============================================================================

  describe('Permission Bridge', () => {
    let requestPermissionHandler: (params: schema.RequestPermissionRequest) => Promise<schema.RequestPermissionResponse>

    beforeEach(async () => {
      // Capture the requestPermission handler during connection
      const ClientSideConnection = (await import('@agentclientprotocol/sdk')).ClientSideConnection as any
      ClientSideConnection.mockImplementationOnce(function (this: any, clientFactory: any) {
        Object.assign(this, mockMethods)
        this.closed = new Promise<void>(() => {})
        const clientImpl = clientFactory()
        requestPermissionHandler = clientImpl.requestPermission
        return this
      })

      await client.connectWithStream(mockStream)
      mockMethods.newSession.mockResolvedValue({ sessionId: 'acp-sess-1' })
      await client.newSession({ cwd: 'D:\\projects', sessionId: 'tangent-sess-1' })
    })

    it('forwards permission request from ACP to client', async () => {
      const permissionHandler = vi.fn()
      client.on('acp:permission-request', permissionHandler)

      const requestPromise = requestPermissionHandler({
        sessionId: 'acp-sess-1',
        action: 'execute',
        resource: 'file:///D:/projects/script.sh',
        toolName: 'bash',
        args: { command: 'rm -rf /' }
      })

      // Wait for event emission
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(permissionHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'tangent-sess-1',
          action: 'execute',
          resource: 'file:///D:/projects/script.sh',
          toolName: 'bash',
          toolArgs: { command: 'rm -rf /' }
        })
      )
    })

    it('sends approval back to ACP', async () => {
      const permissionHandler = vi.fn((request: AcpPermissionRequest) => {
        client.respondToPermission({
          requestId: request.id,
          approved: true,
          rememberChoice: false
        })
      })
      client.on('acp:permission-request', permissionHandler)

      const response = await requestPermissionHandler({
        sessionId: 'acp-sess-1',
        action: 'execute',
        resource: 'file:///D:/projects/safe-script.sh'
      })

      expect(response).toEqual({ outcome: 'allow' })
    })

    it('sends approval with remember choice', async () => {
      const permissionHandler = vi.fn((request: AcpPermissionRequest) => {
        client.respondToPermission({
          requestId: request.id,
          approved: true,
          rememberChoice: true
        })
      })
      client.on('acp:permission-request', permissionHandler)

      const response = await requestPermissionHandler({
        sessionId: 'acp-sess-1',
        action: 'read',
        resource: 'file:///D:/projects/data.json'
      })

      expect(response).toEqual({ outcome: 'allow_always' })
    })

    it('sends denial back to ACP', async () => {
      const permissionHandler = vi.fn((request: AcpPermissionRequest) => {
        client.respondToPermission({
          requestId: request.id,
          approved: false,
          rememberChoice: false
        })
      })
      client.on('acp:permission-request', permissionHandler)

      const response = await requestPermissionHandler({
        sessionId: 'acp-sess-1',
        action: 'execute',
        resource: 'file:///D:/projects/dangerous.sh'
      })

      expect(response).toEqual({ outcome: 'deny' })
    })

    it('sends denial with remember choice', async () => {
      const permissionHandler = vi.fn((request: AcpPermissionRequest) => {
        client.respondToPermission({
          requestId: request.id,
          approved: false,
          rememberChoice: true
        })
      })
      client.on('acp:permission-request', permissionHandler)

      const response = await requestPermissionHandler({
        sessionId: 'acp-sess-1',
        action: 'execute',
        resource: 'file:///etc/passwd'
      })

      expect(response).toEqual({ outcome: 'deny_always' })
    })

    it('handles permission timeout with deny', async () => {
      vi.useFakeTimers()

      const responsePromise = requestPermissionHandler({
        sessionId: 'acp-sess-1',
        action: 'execute',
        resource: 'file:///D:/projects/script.sh'
      })

      // Fast-forward 60 seconds
      vi.advanceTimersByTime(60000)

      const response = await responsePromise
      expect(response).toEqual({ outcome: 'deny' })

      vi.useRealTimers()
    })

    it('denies permission for unknown session', async () => {
      const response = await requestPermissionHandler({
        sessionId: 'unknown-session',
        action: 'execute',
        resource: 'file:///D:/projects/script.sh'
      })

      expect(response).toEqual({ outcome: 'deny' })
    })
  })

  // ============================================================================
  // Error Recovery
  // ============================================================================

  describe('Error Recovery', () => {
    beforeEach(async () => {
      await client.connectWithStream(mockStream)
    })

    it('reconnects after tunnel drop', async () => {
      const disconnectedHandler = vi.fn()
      const connectedHandler = vi.fn()
      client.on('acp:disconnected', disconnectedHandler)
      client.on('acp:error', vi.fn()) // Silence error logs

      // Simulate tunnel drop
      closedPromiseReject!(new Error('Tunnel closed'))
      await new Promise(resolve => setTimeout(resolve, 50))

      expect(client.getState()).toBe('failed')

      // Create new client and reconnect
      const newClient = new AcpClient()
      newClient.on('acp:connected', connectedHandler)
      mockMethods.initialize.mockResolvedValue({
        protocolVersion: '1.0',
        serverInfo: {}
      })

      await newClient.connectWithStream(mockStream)

      expect(connectedHandler).toHaveBeenCalled()
      expect(newClient.getState()).toBe('connected')

      await newClient.disconnect()
    })

    it('retries failed operations', async () => {
      mockMethods.newSession.mockRejectedValueOnce(new Error('Temporary failure'))
      mockMethods.newSession.mockResolvedValueOnce({ sessionId: 'acp-sess-1' })

      // First attempt fails
      await expect(client.newSession({ cwd: 'D:\\projects' })).rejects.toThrow(/Temporary failure/)

      // Second attempt succeeds
      const session = await client.newSession({ cwd: 'D:\\projects' })
      expect(session.id).toBe('acp-sess-1')
    })

    it('reports unrecoverable errors', async () => {
      const errorClient = new AcpClient()
      mockMethods.initialize.mockRejectedValueOnce(new Error('Protocol version mismatch'))
      const errorHandler = vi.fn()
      errorClient.on('acp:error', errorHandler)

      await expect(errorClient.connectWithStream(mockStream)).rejects.toThrow(/Protocol version mismatch/)

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Protocol version mismatch')
        })
      )
      expect(errorClient.getState()).toBe('failed')
    })

    it('handles session creation errors gracefully', async () => {
      mockMethods.newSession.mockRejectedValue(new Error('Invalid workspace path'))
      const errorHandler = vi.fn()
      client.on('acp:error', errorHandler)

      await expect(client.newSession({ cwd: '//invalid//path' })).rejects.toThrow(/Invalid workspace path/)

      expect(errorHandler).toHaveBeenCalled()
      expect(client.getSessions()).toHaveLength(0)
    })

    it('handles prompt send errors gracefully', async () => {
      mockMethods.newSession.mockResolvedValue({ sessionId: 'acp-sess-1' })
      await client.newSession({ cwd: 'D:\\projects', sessionId: 'tangent-sess-1' })
      mockMethods.prompt.mockRejectedValue(new Error('Session terminated'))
      const errorHandler = vi.fn()
      client.on('acp:error', errorHandler)

      await expect(client.sendPrompt('tangent-sess-1', 'Test')).rejects.toThrow(/Session terminated/)

      expect(errorHandler).toHaveBeenCalled()
    })

    it('handles session close errors gracefully', async () => {
      mockMethods.newSession.mockResolvedValue({ sessionId: 'acp-sess-1' })
      await client.newSession({ cwd: 'D:\\projects', sessionId: 'tangent-sess-1' })
      mockMethods.unstable_closeSession.mockRejectedValueOnce(new Error('Close failed'))
      const errorHandler = vi.fn()
      client.on('acp:error', errorHandler)

      await expect(client.closeSession('tangent-sess-1')).rejects.toThrow(/Close failed/)

      expect(errorHandler).toHaveBeenCalled()
    })

    it('continues disconnect even if session close fails', async () => {
      mockMethods.newSession.mockResolvedValue({ sessionId: 'acp-sess-1' })
      await client.newSession({ cwd: 'D:\\projects', sessionId: 'tangent-sess-1' })
      mockMethods.unstable_closeSession.mockRejectedValueOnce(new Error('Close failed'))

      await client.disconnect()

      expect(client.getState()).toBe('disconnected')
      expect(client.getSessions()).toHaveLength(0)
    })
  })

  // ============================================================================
  // Session Updates & Messages
  // ============================================================================

  describe('Session Updates & Messages', () => {
    let sessionUpdateHandler: (notification: schema.SessionNotification) => Promise<void>

    beforeEach(async () => {
      // Capture the sessionUpdate handler during connection
      const ClientSideConnection = (await import('@agentclientprotocol/sdk')).ClientSideConnection as any
      ClientSideConnection.mockImplementationOnce(function (this: any, clientFactory: any) {
        Object.assign(this, mockMethods)
        this.closed = new Promise<void>(() => {})
        const clientImpl = clientFactory()
        sessionUpdateHandler = clientImpl.sessionUpdate
        return this
      })

      await client.connectWithStream(mockStream)
      mockMethods.newSession.mockResolvedValue({ sessionId: 'acp-sess-1' })
      await client.newSession({ cwd: 'D:\\projects', sessionId: 'tangent-sess-1' })
    })

    it('processes session update with text messages', async () => {
      const messageHandler = vi.fn()
      client.on('acp:message', messageHandler)

      await sessionUpdateHandler({
        sessionId: 'acp-sess-1',
        update: {
          messages: [
            {
              role: 'assistant',
              content: [{ type: 'text', text: 'Hello from agent' }]
            }
          ]
        }
      })

      expect(messageHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'tangent-sess-1',
          text: 'Hello from agent'
        })
      )
    })

    it('processes session update with tool executions', async () => {
      const messageHandler = vi.fn()
      client.on('acp:message', messageHandler)

      await sessionUpdateHandler({
        sessionId: 'acp-sess-1',
        update: {
          toolCalls: [
            {
              id: 'tool-1',
              name: 'bash',
              input: { command: 'ls -la' },
              status: 'completed'
            }
          ]
        }
      })

      expect(messageHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'tangent-sess-1',
          toolExecutions: [
            expect.objectContaining({
              id: 'tool-1',
              name: 'bash',
              status: 'success',
              args: { command: 'ls -la' }
            })
          ]
        })
      )
    })

    it('maps stop reason to status', async () => {
      const messageHandler = vi.fn()
      client.on('acp:message', messageHandler)

      await sessionUpdateHandler({
        sessionId: 'acp-sess-1',
        update: {
          messages: [
            {
              role: 'assistant',
              content: [{ type: 'text', text: 'Done' }]
            }
          ],
          stopReason: 'end_turn'
        }
      })

      expect(messageHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'tangent-sess-1',
          status: 'completed'
        })
      )
    })

    it('updates session metrics from usage data', async () => {
      await sessionUpdateHandler({
        sessionId: 'acp-sess-1',
        update: {
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 200,
            cacheWriteTokens: 75
          }
        }
      })

      const session = client.getSession('tangent-sess-1')
      expect(session?.metrics).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 200,
        cacheWriteTokens: 75,
        cost: 0,
        totalPremiumRequests: 0
      })
    })

    it('updates lastActiveAt on session update', async () => {
      const beforeTime = Date.now()

      await sessionUpdateHandler({
        sessionId: 'acp-sess-1',
        update: {
          messages: [
            {
              role: 'assistant',
              content: [{ type: 'text', text: 'Update' }]
            }
          ]
        }
      })

      const session = client.getSession('tangent-sess-1')
      expect(session?.lastActiveAt).toBeGreaterThanOrEqual(beforeTime)
    })

    it('handles session update for unknown session gracefully', async () => {
      await sessionUpdateHandler({
        sessionId: 'unknown-session',
        update: {
          messages: [
            {
              role: 'assistant',
              content: [{ type: 'text', text: 'Hello' }]
            }
          ]
        }
      })

      // Should not throw, just log warning
    })
  })

  // ============================================================================
  // End-to-End Workflow
  // ============================================================================

  describe('End-to-End Workflow', () => {
    it('completes full session lifecycle', async () => {
      // Connect
      await client.connectWithStream(mockStream)
      expect(client.getState()).toBe('connected')

      // Create session
      mockMethods.newSession.mockResolvedValue({ sessionId: 'acp-sess-1' })
      const session = await client.newSession({
        cwd: 'D:\\projects\\myapp',
        sessionId: 'tangent-sess-1'
      })
      expect(session.id).toBe('acp-sess-1')

      // Send prompt
      mockMethods.prompt.mockResolvedValue(undefined)
      await client.sendPrompt('tangent-sess-1', 'Write a function')
      expect(mockMethods.prompt).toHaveBeenCalled()

      // Close session
      await client.closeSession('tangent-sess-1')
      expect(client.getSession('tangent-sess-1')).toBeUndefined()

      // Disconnect
      await client.disconnect()
      expect(client.getState()).toBe('disconnected')
    })

    it('manages multiple concurrent sessions', async () => {
      await client.connectWithStream(mockStream)

      // Create 3 sessions
      mockMethods.newSession.mockResolvedValueOnce({ sessionId: 'acp-sess-1' })
      mockMethods.newSession.mockResolvedValueOnce({ sessionId: 'acp-sess-2' })
      mockMethods.newSession.mockResolvedValueOnce({ sessionId: 'acp-sess-3' })

      await client.newSession({ cwd: 'D:\\app1', sessionId: 'tangent-1' })
      await client.newSession({ cwd: 'D:\\app2', sessionId: 'tangent-2' })
      await client.newSession({ cwd: 'D:\\app3', sessionId: 'tangent-3' })

      expect(client.getSessions()).toHaveLength(3)

      // Send prompts to each
      mockMethods.prompt.mockResolvedValue(undefined)
      await client.sendPrompt('tangent-1', 'Task 1')
      await client.sendPrompt('tangent-2', 'Task 2')
      await client.sendPrompt('tangent-3', 'Task 3')

      expect(mockMethods.prompt).toHaveBeenCalledTimes(3)

      // Close one session
      await client.closeSession('tangent-2')

      expect(client.getSessions()).toHaveLength(2)
      expect(client.getSession('tangent-1')).toBeDefined()
      expect(client.getSession('tangent-2')).toBeUndefined()
      expect(client.getSession('tangent-3')).toBeDefined()

      await client.disconnect()
    })
  })
})
