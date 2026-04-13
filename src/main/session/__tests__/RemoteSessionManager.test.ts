import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'events'
import { RemoteSessionManager } from '../RemoteSessionManager'
import type { DevBoxConnector } from '../../devbox/DevBoxConnector'
import type { DevBoxProvisioner } from '../../devbox/DevBoxProvisioner'
import type { AcpClient } from '../../devbox/AcpClient'
import type { RsyncManager } from '../../devbox/RsyncManager'
import type { SessionStore } from '../SessionStore'
import type { AgentProfile } from '@shared/types'
import type { AcpSessionConfig } from '@shared/acp-types'

describe('RemoteSessionManager', () => {
  let manager: RemoteSessionManager
  let mockDevBoxConnector: DevBoxConnector
  let mockDevBoxProvisioner: DevBoxProvisioner
  let mockAcpClient: AcpClient
  let mockRsyncManager: RsyncManager
  let mockSessionStore: SessionStore

  const testAgentProfile: AgentProfile = {
    id: 'test-agent',
    name: 'Test Agent',
    command: 'gh',
    args: ['copilot'],
    cwdMode: 'activeSession',
    launchTarget: 'currentTab',
    remote: {
      enabled: true,
      devBoxProject: 'test-project',
      devBoxName: 'test-devbox',
      repoPath: '/home/workspace',
      sshUser: 'testuser'
    }
  }

  beforeEach(() => {
    // Mock DevBoxConnector
    mockDevBoxConnector = new EventEmitter() as any
    mockDevBoxConnector.connect = vi.fn().mockResolvedValue('conn-123')
    mockDevBoxConnector.disconnect = vi.fn().mockResolvedValue(undefined)
    mockDevBoxConnector.syncWorkspaceOut = vi.fn().mockResolvedValue({
      success: true,
      bytesTransferred: 1024,
      filesSynced: 10
    })
    mockDevBoxConnector.getStatus = vi.fn().mockReturnValue({
      id: 'conn-123',
      devBoxName: 'test-devbox',
      projectName: 'test-project',
      state: 'ready',
      connectionInfo: {
        sshHost: 'test-host',
        sshPort: 22,
        sshUser: 'testuser'
      },
      startedAt: Date.now()
    })

    // Mock DevBoxProvisioner
    mockDevBoxProvisioner = new EventEmitter() as any
    mockDevBoxProvisioner.isProvisioned = vi.fn().mockResolvedValue(true)
    mockDevBoxProvisioner.markProvisioned = vi.fn().mockResolvedValue(undefined)
    mockDevBoxProvisioner.provision = vi.fn().mockResolvedValue(true)

    // Mock AcpClient
    mockAcpClient = new EventEmitter() as any
    mockAcpClient.connect = vi.fn().mockResolvedValue(undefined)
    mockAcpClient.newSession = vi.fn().mockResolvedValue({
      id: 'acp-session-123',
      state: 'connected',
      config: { cwd: '/home/workspace' },
      createdAt: Date.now(),
      lastActiveAt: Date.now()
    })
    mockAcpClient.sendPrompt = vi.fn().mockResolvedValue(undefined)
    mockAcpClient.closeSession = vi.fn().mockResolvedValue(undefined)
    mockAcpClient.resumeSession = vi.fn().mockResolvedValue(undefined)

    // Mock RsyncManager
    mockRsyncManager = new EventEmitter() as any
    mockRsyncManager.syncInbound = vi.fn().mockResolvedValue({
      success: true,
      bytesTransferred: 2048,
      filesSynced: 15
    })

    // Mock SessionStore
    mockSessionStore = new EventEmitter() as any
    mockSessionStore.add = vi.fn()
    mockSessionStore.get = vi.fn().mockReturnValue({
      id: 'test-session',
      kind: 'remote-agent',
      agentType: 'copilot-cli',
      name: 'Test Agent',
      folderName: 'workspace',
      folderPath: '/local/path',
      isRenamed: false,
      status: 'agent_launching',
      lastActivity: 'Starting...',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      ptyId: '',
      isExternal: false,
      remoteState: 'starting-devbox'
    })
    mockSessionStore.remove = vi.fn()
    mockSessionStore.updateStatus = vi.fn()
    mockSessionStore.updateActivity = vi.fn()

    manager = new RemoteSessionManager(
      mockDevBoxConnector,
      mockDevBoxProvisioner,
      mockAcpClient,
      mockRsyncManager,
      mockSessionStore
    )
  })

  describe('createRemoteSession - Happy Path', () => {
    it('should orchestrate full remote session creation successfully', async () => {
      const sessionId = await manager.createRemoteSession(testAgentProfile, '/local/path')

      expect(sessionId).toMatch(/^remote-/)
      expect(mockDevBoxConnector.connect).toHaveBeenCalledWith('test-devbox', 'test-project')
      expect(mockDevBoxProvisioner.isProvisioned).toHaveBeenCalledWith('test-devbox')
      expect(mockDevBoxConnector.syncWorkspaceOut).toHaveBeenCalledWith(
        'conn-123',
        '/local/path',
        '/home/workspace'
      )
      expect(mockAcpClient.newSession).toHaveBeenCalled()
      expect(mockSessionStore.add).toHaveBeenCalled()
      expect(mockSessionStore.updateStatus).toHaveBeenCalledWith(
        expect.any(String),
        'agent_ready'
      )
      expect(mockSessionStore.updateActivity).toHaveBeenCalledWith(expect.any(String), 'Ready')

      const handle = manager.getRemoteSession(sessionId)
      expect(handle).toBeDefined()
      expect(handle?.state).toBe('running')
      expect(handle?.readyAt).toBeDefined()
    })

    it('should emit state change events during orchestration', async () => {
      const stateChanges: string[] = []
      manager.on('remote:state-changed', (_sessionId, state) => {
        stateChanges.push(state)
      })

      await manager.createRemoteSession(testAgentProfile, '/local/path')

      expect(stateChanges).toEqual([
        'starting-devbox',
        'syncing-out',
        'tunneling',
        'verifying-acp',
        'running'
      ])
    })

    it('should add session to SessionStore with correct properties', async () => {
      await manager.createRemoteSession(testAgentProfile, '/local/path')

      expect(mockSessionStore.add).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'remote-agent',
          agentType: 'copilot-cli',
          name: 'Test Agent',
          folderName: 'path', // Last segment of /local/path
          folderPath: '/local/path',
          status: 'agent_launching',
          remoteState: 'starting-devbox',
          devBoxName: 'test-devbox',
          devBoxProject: 'test-project'
        })
      )
    })

    it('should pass ACP session config with correct workspace path', async () => {
      await manager.createRemoteSession(testAgentProfile, '/local/path')

      expect(mockAcpClient.newSession).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: '/home/workspace',
          env: testAgentProfile.env
        })
      )
    })
  })

  describe('createRemoteSession - Error Handling', () => {
    it('should fail if remote is not enabled on agent profile', async () => {
      const noRemoteProfile: AgentProfile = {
        ...testAgentProfile,
        remote: { enabled: false }
      }

      await expect(manager.createRemoteSession(noRemoteProfile, '/local/path')).rejects.toThrow(
        'Agent profile does not have remote execution enabled'
      )
    })

    it('should fail if Dev Box connection fails', async () => {
      mockDevBoxConnector.connect = vi
        .fn()
        .mockRejectedValue(new Error('Connection timeout'))

      await expect(manager.createRemoteSession(testAgentProfile, '/local/path')).rejects.toThrow(
        'Connection timeout'
      )

      expect(mockSessionStore.updateStatus).toHaveBeenCalledWith(
        expect.any(String),
        'failed'
      )
    })

    it('should auto-mark as provisioned when setup script was run externally', async () => {
      mockDevBoxProvisioner.isProvisioned = vi.fn().mockResolvedValue(false)

      const sessionId = await manager.createRemoteSession(testAgentProfile, '/local/path')
      expect(sessionId).toBeTruthy()
      expect(mockDevBoxProvisioner.markProvisioned).toHaveBeenCalledWith(
        'test-devbox',
        expect.any(Array)
      )
    })

    it('should continue if workspace sync fails (non-fatal)', async () => {
      mockDevBoxConnector.syncWorkspaceOut = vi.fn().mockResolvedValue({
        success: false,
        bytesTransferred: 0,
        filesSynced: 0,
        error: 'rsync command failed'
      })

      // Should still succeed — sync failure is non-fatal
      const sessionId = await manager.createRemoteSession(testAgentProfile, '/local/path')
      expect(sessionId).toBeTruthy()
    })

    it('should fail if ACP session creation fails', async () => {
      mockAcpClient.newSession = vi
        .fn()
        .mockRejectedValue(new Error('ACP connection refused'))

      await expect(manager.createRemoteSession(testAgentProfile, '/local/path')).rejects.toThrow(
        'ACP connection refused'
      )
    })

    it('should emit error event on failure', async () => {
      mockDevBoxConnector.connect = vi.fn().mockRejectedValue(new Error('Network error'))

      let errorEmitted = false
      manager.on('remote:error', () => {
        errorEmitted = true
      })

      await expect(
        manager.createRemoteSession(testAgentProfile, '/local/path')
      ).rejects.toThrow()
      expect(errorEmitted).toBe(true)
    })
  })

  describe('sendPrompt', () => {
    it('should forward prompt to ACP client', async () => {
      const sessionId = await manager.createRemoteSession(testAgentProfile, '/local/path')

      await manager.sendPrompt(sessionId, 'test prompt')

      expect(mockAcpClient.sendPrompt).toHaveBeenCalledWith(sessionId, 'test prompt')
      expect(mockSessionStore.updateStatus).toHaveBeenCalledWith(sessionId, 'processing')
      expect(mockSessionStore.updateActivity).toHaveBeenCalledWith(sessionId, 'Processing...')
    })

    it('should fail if session not found', async () => {
      await expect(manager.sendPrompt('nonexistent-session', 'test')).rejects.toThrow(
        'Remote session nonexistent-session not found'
      )
    })

    it('should fail if session has no ACP session', async () => {
      const sessionId = await manager.createRemoteSession(testAgentProfile, '/local/path')
      const handle = manager.getRemoteSession(sessionId)
      if (handle) {
        handle.acpSessionId = undefined
      }

      await expect(manager.sendPrompt(sessionId, 'test')).rejects.toThrow(
        'has no ACP session'
      )
    })

    it('should fail if session is not running', async () => {
      const sessionId = await manager.createRemoteSession(testAgentProfile, '/local/path')
      const handle = manager.getRemoteSession(sessionId)
      if (handle) {
        handle.state = 'syncing-out'
      }

      await expect(manager.sendPrompt(sessionId, 'test')).rejects.toThrow('is not running')
    })
  })

  describe('closeRemoteSession', () => {
    it('should sync workspace back, close ACP, and disconnect', async () => {
      const sessionId = await manager.createRemoteSession(testAgentProfile, '/local/path')

      await manager.closeRemoteSession(sessionId)

      expect(mockRsyncManager.syncInbound).toHaveBeenCalledWith(
        '/home/workspace',
        '/local/path',
        'test-host',
        'testuser'
      )
      expect(mockAcpClient.closeSession).toHaveBeenCalledWith(sessionId)
      expect(mockDevBoxConnector.disconnect).toHaveBeenCalledWith('conn-123', {
        stopDevBox: undefined
      })
      expect(mockSessionStore.remove).toHaveBeenCalledWith(sessionId)
    })

    it('should optionally stop Dev Box on close', async () => {
      const sessionId = await manager.createRemoteSession(testAgentProfile, '/local/path')

      await manager.closeRemoteSession(sessionId, { stopDevBox: true })

      expect(mockDevBoxConnector.disconnect).toHaveBeenCalledWith('conn-123', {
        stopDevBox: true
      })
    })

    it('should handle sync failure gracefully during close', async () => {
      const sessionId = await manager.createRemoteSession(testAgentProfile, '/local/path')

      mockRsyncManager.syncInbound = vi.fn().mockResolvedValue({
        success: false,
        bytesTransferred: 0,
        filesSynced: 0,
        error: 'Network timeout'
      })

      // Should not throw
      await expect(manager.closeRemoteSession(sessionId)).resolves.toBeUndefined()

      // Should still close ACP and disconnect
      expect(mockAcpClient.closeSession).toHaveBeenCalled()
      expect(mockDevBoxConnector.disconnect).toHaveBeenCalled()
    })

    it('should handle ACP close failure gracefully', async () => {
      const sessionId = await manager.createRemoteSession(testAgentProfile, '/local/path')

      mockAcpClient.closeSession = vi.fn().mockRejectedValue(new Error('ACP timeout'))

      // Should not throw
      await expect(manager.closeRemoteSession(sessionId)).resolves.toBeUndefined()

      // Should still disconnect
      expect(mockDevBoxConnector.disconnect).toHaveBeenCalled()
    })

    it('should do nothing if session not found', async () => {
      await expect(manager.closeRemoteSession('nonexistent')).resolves.toBeUndefined()
      expect(mockRsyncManager.syncInbound).not.toHaveBeenCalled()
    })

    it('should update state to syncing-back', async () => {
      const sessionId = await manager.createRemoteSession(testAgentProfile, '/local/path')

      const stateChanges: string[] = []
      manager.on('remote:state-changed', (_sid, state) => {
        stateChanges.push(state)
      })

      await manager.closeRemoteSession(sessionId)

      expect(stateChanges).toContain('syncing-back')
    })
  })

  describe('ACP message forwarding', () => {
    it('should forward ACP messages to remote:message event', async () => {
      const sessionId = await manager.createRemoteSession(testAgentProfile, '/local/path')

      let receivedMessage = ''
      manager.on('remote:message', (_sid, text) => {
        receivedMessage = text
      })

      // Simulate ACP message
      mockAcpClient.emit('acp:message', {
        sessionId,
        text: 'Hello from agent',
        timestamp: Date.now()
      })

      expect(receivedMessage).toBe('Hello from agent')
    })

    it('should ignore messages for unknown sessions', () => {
      let messageReceived = false
      manager.on('remote:message', () => {
        messageReceived = true
      })

      // Simulate ACP message for unknown session
      mockAcpClient.emit('acp:message', {
        sessionId: 'unknown-session',
        text: 'Hello',
        timestamp: Date.now()
      })

      expect(messageReceived).toBe(false)
    })
  })

  describe('getRemoteSession', () => {
    it('should return session handle for existing session', async () => {
      const sessionId = await manager.createRemoteSession(testAgentProfile, '/local/path')

      const handle = manager.getRemoteSession(sessionId)

      expect(handle).toBeDefined()
      expect(handle?.sessionId).toBe(sessionId)
      expect(handle?.agentProfile).toEqual(testAgentProfile)
      expect(handle?.localPath).toBe('/local/path')
      expect(handle?.state).toBe('running')
    })

    it('should return undefined for nonexistent session', () => {
      const handle = manager.getRemoteSession('nonexistent')
      expect(handle).toBeUndefined()
    })
  })

  describe('State Transitions', () => {
    it('should progress through all states in correct order', async () => {
      const stateChanges: string[] = []
      manager.on('remote:state-changed', (_sessionId, state) => {
        stateChanges.push(state)
      })

      await manager.createRemoteSession(testAgentProfile, '/local/path')

      expect(stateChanges).toEqual([
        'starting-devbox',
        'syncing-out',
        'tunneling',
        'verifying-acp',
        'running'
      ])
    })

    it('should track timing metrics', async () => {
      const startTime = Date.now()
      const sessionId = await manager.createRemoteSession(testAgentProfile, '/local/path')
      const handle = manager.getRemoteSession(sessionId)

      expect(handle?.startedAt).toBeGreaterThanOrEqual(startTime)
      expect(handle?.readyAt).toBeDefined()
      expect(handle?.readyAt).toBeGreaterThanOrEqual(handle!.startedAt)
    })
  })

  describe('P4.10: Auto-Reconnection', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should trigger reconnection on connection failure', async () => {
      const sessionId = await manager.createRemoteSession(testAgentProfile, '/local/path')

      // Simulate connection failure
      mockDevBoxConnector.emit('connection:failed', 'conn-123', 'SSH tunnel dropped')

      // Should update activity to show reconnecting
      expect(mockSessionStore.updateActivity).toHaveBeenCalledWith(
        sessionId,
        expect.stringContaining('Reconnecting (attempt 1/3)')
      )
    })

    it('should use exponential backoff for reconnection attempts', async () => {
      const sessionId = await manager.createRemoteSession(testAgentProfile, '/local/path')

      // Mock successful connection for reconnect
      mockDevBoxConnector.connect = vi.fn().mockResolvedValue('conn-456')
      mockDevBoxConnector.getStatus = vi.fn().mockReturnValue({
        id: 'conn-456',
        state: 'ready',
        connectionInfo: { sshHost: 'test-host', sshPort: 22, sshUser: 'testuser' }
      })
      mockAcpClient.resumeSession = vi.fn().mockResolvedValue(undefined)

      // First attempt - 1s delay
      mockDevBoxConnector.emit('connection:failed', 'conn-123', 'Connection lost')
      vi.advanceTimersByTime(1000)
      await vi.runAllTimersAsync()

      expect(mockDevBoxConnector.connect).toHaveBeenCalledTimes(1)

      // Simulate another failure - 2s delay
      mockDevBoxConnector.emit('connection:failed', 'conn-456', 'Connection lost')
      vi.advanceTimersByTime(2000)
      await vi.runAllTimersAsync()

      expect(mockDevBoxConnector.connect).toHaveBeenCalledTimes(2)
    })

    it('should close stale connection before reconnecting', async () => {
      const sessionId = await manager.createRemoteSession(testAgentProfile, '/local/path')

      mockDevBoxConnector.connect = vi.fn().mockResolvedValue('conn-456')
      mockDevBoxConnector.getStatus = vi.fn().mockReturnValue({
        id: 'conn-456',
        state: 'ready',
        connectionInfo: { sshHost: 'test-host', sshPort: 22, sshUser: 'testuser' }
      })
      mockAcpClient.resumeSession = vi.fn().mockResolvedValue(undefined)

      mockDevBoxConnector.emit('connection:failed', 'conn-123', 'Connection lost')
      vi.advanceTimersByTime(1000)
      await vi.runAllTimersAsync()

      // Should disconnect old connection without stopping Dev Box
      expect(mockDevBoxConnector.disconnect).toHaveBeenCalledWith('conn-123', {
        stopDevBox: false
      })

      // Should establish new connection
      expect(mockDevBoxConnector.connect).toHaveBeenCalledWith('test-devbox', 'test-project')
    })

    it('should re-sync workspace during reconnection', async () => {
      const sessionId = await manager.createRemoteSession(testAgentProfile, '/local/path')

      mockDevBoxConnector.connect = vi.fn().mockResolvedValue('conn-456')
      mockDevBoxConnector.getStatus = vi.fn().mockReturnValue({
        id: 'conn-456',
        state: 'ready',
        connectionInfo: { sshHost: 'test-host', sshPort: 22, sshUser: 'testuser' }
      })
      mockAcpClient.resumeSession = vi.fn().mockResolvedValue(undefined)

      mockDevBoxConnector.emit('connection:failed', 'conn-123', 'Connection lost')
      vi.advanceTimersByTime(1000)
      await vi.runAllTimersAsync()

      expect(mockDevBoxConnector.syncWorkspaceOut).toHaveBeenCalledWith(
        'conn-456',
        '/local/path',
        '/home/workspace'
      )
    })

    it('should resume ACP session after reconnection', async () => {
      const sessionId = await manager.createRemoteSession(testAgentProfile, '/local/path')

      mockDevBoxConnector.connect = vi.fn().mockResolvedValue('conn-456')
      mockDevBoxConnector.getStatus = vi.fn().mockReturnValue({
        id: 'conn-456',
        state: 'ready',
        connectionInfo: { sshHost: 'test-host', sshPort: 22, sshUser: 'testuser' }
      })
      mockAcpClient.resumeSession = vi.fn().mockResolvedValue(undefined)

      mockDevBoxConnector.emit('connection:failed', 'conn-123', 'Connection lost')
      vi.advanceTimersByTime(1000)
      await vi.runAllTimersAsync()

      expect(mockAcpClient.resumeSession).toHaveBeenCalledWith(sessionId)
    })

    it('should reset reconnection attempts counter on successful reconnect', async () => {
      const sessionId = await manager.createRemoteSession(testAgentProfile, '/local/path')

      mockDevBoxConnector.connect = vi.fn().mockResolvedValue('conn-456')
      mockDevBoxConnector.getStatus = vi.fn().mockReturnValue({
        id: 'conn-456',
        state: 'ready',
        connectionInfo: { sshHost: 'test-host', sshPort: 22, sshUser: 'testuser' }
      })
      mockAcpClient.resumeSession = vi.fn().mockResolvedValue(undefined)

      // First failure and reconnect
      mockDevBoxConnector.emit('connection:failed', 'conn-123', 'Connection lost')
      vi.advanceTimersByTime(1000)
      await vi.runAllTimersAsync()

      const handle = manager.getRemoteSession(sessionId)
      expect(handle?.reconnectionAttempts).toBe(0) // Reset after success
    })

    it('should stop reconnecting after max attempts (3)', async () => {
      const sessionId = await manager.createRemoteSession(testAgentProfile, '/local/path')

      // Always fail reconnection attempts
      mockDevBoxConnector.connect = vi.fn().mockRejectedValue(new Error('Still unreachable'))

      // Attempt 1
      mockDevBoxConnector.emit('connection:failed', 'conn-123', 'Connection lost')
      vi.advanceTimersByTime(1000)
      await vi.runAllTimersAsync()

      // Attempt 2
      vi.advanceTimersByTime(2000)
      await vi.runAllTimersAsync()

      // Attempt 3
      vi.advanceTimersByTime(4000)
      await vi.runAllTimersAsync()

      // Should have tried 3 times
      expect(mockDevBoxConnector.connect).toHaveBeenCalledTimes(3)

      // Should mark as failed
      expect(mockSessionStore.updateStatus).toHaveBeenCalledWith(sessionId, 'failed')
      expect(mockSessionStore.updateActivity).toHaveBeenCalledWith(
        sessionId,
        expect.stringContaining('max reconnection attempts')
      )
    })

    it('should emit error event after max reconnection attempts', async () => {
      const sessionId = await manager.createRemoteSession(testAgentProfile, '/local/path')

      let errorEmitted = false
      manager.on('remote:error', (sid, error) => {
        if (sid === sessionId && error.includes('Max reconnection attempts')) {
          errorEmitted = true
        }
      })

      mockDevBoxConnector.connect = vi.fn().mockRejectedValue(new Error('Unreachable'))

      // Trigger max attempts
      mockDevBoxConnector.emit('connection:failed', 'conn-123', 'Connection lost')
      for (let i = 0; i < 3; i++) {
        vi.advanceTimersByTime(Math.pow(2, i) * 1000)
        await vi.runAllTimersAsync()
      }

      expect(errorEmitted).toBe(true)
    })

    it('should transition through reconnection states', async () => {
      const sessionId = await manager.createRemoteSession(testAgentProfile, '/local/path')

      const stateChanges: string[] = []
      manager.on('remote:state-changed', (_sid, state) => {
        stateChanges.push(state)
      })

      mockDevBoxConnector.connect = vi.fn().mockResolvedValue('conn-456')
      mockDevBoxConnector.getStatus = vi.fn().mockReturnValue({
        id: 'conn-456',
        state: 'ready',
        connectionInfo: { sshHost: 'test-host', sshPort: 22, sshUser: 'testuser' }
      })
      mockAcpClient.resumeSession = vi.fn().mockResolvedValue(undefined)

      stateChanges.length = 0 // Clear initial states

      mockDevBoxConnector.emit('connection:failed', 'conn-123', 'Connection lost')
      vi.advanceTimersByTime(1000)
      await vi.runAllTimersAsync()

      // Should go through: starting-devbox → syncing-out → verifying-acp → running
      expect(stateChanges).toEqual([
        'starting-devbox',
        'syncing-out',
        'verifying-acp',
        'running'
      ])
    })

    it('should clear reconnection timer on session close', async () => {
      const sessionId = await manager.createRemoteSession(testAgentProfile, '/local/path')

      mockDevBoxConnector.connect = vi.fn().mockResolvedValue('conn-456')

      // Trigger reconnection
      mockDevBoxConnector.emit('connection:failed', 'conn-123', 'Connection lost')

      // Close session before timer fires
      await manager.closeRemoteSession(sessionId)

      // Advance timer
      vi.advanceTimersByTime(5000)
      await vi.runAllTimersAsync()

      // Should not attempt reconnection after close
      expect(mockDevBoxConnector.connect).not.toHaveBeenCalled()
    })

    it('should not reconnect if session was not in running state', async () => {
      const sessionId = await manager.createRemoteSession(testAgentProfile, '/local/path')

      // Reset the connect call count after initial session creation
      mockDevBoxConnector.connect = vi.fn().mockResolvedValue('conn-456')

      const handle = manager.getRemoteSession(sessionId)
      if (handle) {
        handle.state = 'syncing-out' // Set to non-running state
      }

      mockDevBoxConnector.emit('connection:failed', 'conn-123', 'Connection lost')
      vi.advanceTimersByTime(5000)
      await vi.runAllTimersAsync()

      // Should not attempt reconnection
      expect(mockDevBoxConnector.connect).toHaveBeenCalledTimes(0)
    })
  })
})
