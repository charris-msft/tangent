import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EventEmitter } from 'events'
import { AgentLauncher } from '../AgentLauncher'
import type { PtyManager } from '../../pty/PtyManager'
import type { SessionStore } from '../../session/SessionStore'
import type { SessionManager } from '../../session/SessionManager'
import type { RemoteSessionManager } from '../../session/RemoteSessionManager'
import type { AgentProfile } from '@shared/types'

describe('AgentLauncher', () => {
  let launcher: AgentLauncher
  let mockPtyManager: PtyManager
  let mockSessionStore: SessionStore
  let mockSessionManager: SessionManager
  let mockRemoteSessionManager: RemoteSessionManager

  const localAgentProfile: AgentProfile = {
    id: 'local-agent',
    name: 'Local Agent',
    command: 'gh copilot',
    args: [],
    cwdMode: 'activeSession',
    launchTarget: 'currentTab'
  }

  const remoteAgentProfile: AgentProfile = {
    id: 'remote-agent',
    name: 'Remote Agent',
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
    // Mock PtyManager
    mockPtyManager = new EventEmitter() as any
    mockPtyManager.write = vi.fn()
    mockPtyManager.get = vi.fn().mockReturnValue({
      id: 'pty-123',
      write: vi.fn()
    })

    // Mock SessionStore
    mockSessionStore = new EventEmitter() as any
    mockSessionStore.get = vi.fn().mockReturnValue({
      id: 'test-session',
      kind: 'shell',
      agentType: 'shell',
      name: 'Shell Session',
      folderName: 'workspace',
      folderPath: '/local/workspace',
      isRenamed: false,
      status: 'shell_ready',
      lastActivity: 'Ready',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      ptyId: 'pty-123',
      isExternal: false
    })
    mockSessionStore.rename = vi.fn()
    mockSessionStore.promoteToAgent = vi.fn()
    mockSessionStore.setAgentLaunchInfo = vi.fn()

    // Mock SessionManager
    mockSessionManager = new EventEmitter() as any
    mockSessionManager.create = vi.fn().mockReturnValue({
      id: 'new-session',
      kind: 'shell',
      agentType: 'shell',
      name: 'New Session',
      folderName: 'workspace',
      folderPath: '/local/workspace',
      isRenamed: false,
      status: 'shell_ready',
      lastActivity: 'Ready',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      ptyId: 'pty-456',
      isExternal: false
    })
    mockSessionManager.sdkManager = null

    // Mock RemoteSessionManager
    mockRemoteSessionManager = new EventEmitter() as any
    mockRemoteSessionManager.createRemoteSession = vi.fn().mockResolvedValue('remote-session-123')
  })

  describe('P4.6: Remote Agent Routing', () => {
    it('should delegate to RemoteSessionManager when remote.enabled is true', async () => {
      launcher = new AgentLauncher(
        mockPtyManager,
        mockSessionStore,
        mockSessionManager,
        mockRemoteSessionManager
      )

      launcher.launch(remoteAgentProfile, 'test-session')

      // Give async operation time to execute
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(mockRemoteSessionManager.createRemoteSession).toHaveBeenCalledWith(
        remoteAgentProfile,
        '/local/workspace'
      )
      expect(mockPtyManager.write).not.toHaveBeenCalled()
    })

    it('should use explicit cwdPath when launchTarget is path', async () => {
      const pathAgent: AgentProfile = {
        ...remoteAgentProfile,
        launchTarget: 'path',
        cwdPath: '/explicit/path'
      }

      launcher = new AgentLauncher(
        mockPtyManager,
        mockSessionStore,
        mockSessionManager,
        mockRemoteSessionManager
      )

      launcher.launch(pathAgent, 'test-session')
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(mockRemoteSessionManager.createRemoteSession).toHaveBeenCalledWith(
        pathAgent,
        '/explicit/path'
      )
    })

    it('should use local PTY launch for non-remote agents', () => {
      launcher = new AgentLauncher(
        mockPtyManager,
        mockSessionStore,
        mockSessionManager,
        mockRemoteSessionManager
      )

      launcher.launch(localAgentProfile, 'test-session')

      expect(mockPtyManager.write).toHaveBeenCalled()
      expect(mockRemoteSessionManager.createRemoteSession).not.toHaveBeenCalled()
    })

    it('should use local PTY launch when remote.enabled is false', () => {
      const notEnabledAgent: AgentProfile = {
        ...remoteAgentProfile,
        remote: {
          ...remoteAgentProfile.remote!,
          enabled: false
        }
      }

      launcher = new AgentLauncher(
        mockPtyManager,
        mockSessionStore,
        mockSessionManager,
        mockRemoteSessionManager
      )

      launcher.launch(notEnabledAgent, 'test-session')

      expect(mockPtyManager.write).toHaveBeenCalled()
      expect(mockRemoteSessionManager.createRemoteSession).not.toHaveBeenCalled()
    })

    it('should handle missing RemoteSessionManager gracefully', async () => {
      launcher = new AgentLauncher(
        mockPtyManager,
        mockSessionStore,
        mockSessionManager
        // No RemoteSessionManager provided
      )

      // Should not throw
      launcher.launch(remoteAgentProfile, 'test-session')
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(mockRemoteSessionManager.createRemoteSession).not.toHaveBeenCalled()
    })

    it('should handle RemoteSessionManager errors gracefully', async () => {
      mockRemoteSessionManager.createRemoteSession = vi
        .fn()
        .mockRejectedValue(new Error('Dev Box not found'))

      launcher = new AgentLauncher(
        mockPtyManager,
        mockSessionStore,
        mockSessionManager,
        mockRemoteSessionManager
      )

      // Should not throw
      launcher.launch(remoteAgentProfile, 'test-session')
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(mockRemoteSessionManager.createRemoteSession).toHaveBeenCalled()
    })
  })

  describe('Local Launch (Unchanged Behavior)', () => {
    beforeEach(() => {
      launcher = new AgentLauncher(
        mockPtyManager,
        mockSessionStore,
        mockSessionManager,
        mockRemoteSessionManager
      )
    })

    it('should write agent command to PTY for local agents', () => {
      launcher.launch(localAgentProfile, 'test-session')

      expect(mockPtyManager.write).toHaveBeenCalledWith(
        'pty-123',
        expect.stringContaining('copilot')
      )
      expect(mockSessionStore.rename).toHaveBeenCalledWith('test-session', 'Local Agent')
      expect(mockSessionStore.promoteToAgent).toHaveBeenCalled()
    })

    it('should support launchTarget: newTab for local agents', () => {
      const newTabAgent: AgentProfile = {
        ...localAgentProfile,
        launchTarget: 'newTab'
      }

      // Mock get to return new session when queried
      mockSessionStore.get = vi.fn((id) => {
        if (id === 'new-session') {
          return {
            id: 'new-session',
            ptyId: 'pty-456'
          }
        }
        return {
          id: 'test-session',
          folderPath: '/local/workspace',
          ptyId: 'pty-123'
        }
      })

      launcher.launch(newTabAgent, 'test-session')

      expect(mockSessionManager.create).toHaveBeenCalledWith('/local/workspace')
      expect(mockPtyManager.write).toHaveBeenCalledWith(
        'pty-456',
        expect.stringContaining('copilot')
      )
    })

    it('should support launchTarget: path for local agents', () => {
      const pathAgent: AgentProfile = {
        ...localAgentProfile,
        launchTarget: 'path',
        cwdPath: '/custom/path'
      }

      launcher.launch(pathAgent, 'test-session')

      expect(mockSessionManager.create).toHaveBeenCalledWith('/custom/path')
      expect(mockPtyManager.write).toHaveBeenCalled()
    })

    it('should pass environment variables to PTY for local agents', () => {
      const envAgent: AgentProfile = {
        ...localAgentProfile,
        env: {
          API_KEY: 'test-key',
          DEBUG: 'true'
        }
      }

      launcher.launch(envAgent, 'test-session')

      const writeCall = vi.mocked(mockPtyManager.write).mock.calls[0][1]
      expect(writeCall).toContain("$env:API_KEY = 'test-key'")
      expect(writeCall).toContain("$env:DEBUG = 'true'")
    })

    it('should escape single quotes in PowerShell commands', () => {
      const quoteAgent: AgentProfile = {
        ...localAgentProfile,
        env: {
          MESSAGE: "it's working"
        }
      }

      launcher.launch(quoteAgent, 'test-session')

      const writeCall = vi.mocked(mockPtyManager.write).mock.calls[0][1]
      expect(writeCall).toContain("$env:MESSAGE = 'it''s working'")
    })
  })
})
