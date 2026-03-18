import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SessionStore } from '../SessionStore'
import { ContextStore } from '../ContextStore'
import type { Session, HumanContext } from '../../../shared/types'

function createTestSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'ctx-test-1',
    kind: 'shell',
    agentType: 'shell',
    name: 'Test',
    folderName: 'test',
    folderPath: 'C:\\test',
    isRenamed: false,
    status: 'shell_ready',
    lastActivity: '',
    startedAt: Date.now(),
    updatedAt: Date.now(),
    ptyId: 'pty-1',
    isExternal: false,
    ...overrides,
  }
}

describe('ContextStore', () => {
  let store: SessionStore
  let contextStore: ContextStore

  beforeEach(() => {
    store = new SessionStore()
    contextStore = new ContextStore(store)
  })

  describe('addPrompt', () => {
    it('stores prompts and retrieves them via getContext', () => {
      const session = createTestSession()
      store.add(session)

      contextStore.addPrompt('ctx-test-1', 'npm test', 'terminal')
      contextStore.addPrompt('ctx-test-1', 'git status', 'terminal')

      const ctx = contextStore.getContext('ctx-test-1')
      expect(ctx).not.toBeNull()
      expect(ctx!.prompts).toHaveLength(2)
      // Chronological order (oldest first)
      expect(ctx!.prompts[0].text).toBe('npm test')
      expect(ctx!.prompts[1].text).toBe('git status')
    })

    it('deduplicates consecutive identical prompts', () => {
      const session = createTestSession()
      store.add(session)

      contextStore.addPrompt('ctx-test-1', 'npm test', 'terminal')
      contextStore.addPrompt('ctx-test-1', 'npm test', 'terminal')
      contextStore.addPrompt('ctx-test-1', 'npm test', 'terminal')

      const ctx = contextStore.getContext('ctx-test-1')
      expect(ctx!.prompts).toHaveLength(1)
    })

    it('ignores empty or very short prompts', () => {
      const session = createTestSession()
      store.add(session)

      contextStore.addPrompt('ctx-test-1', '', 'terminal')
      contextStore.addPrompt('ctx-test-1', ' ', 'terminal')
      contextStore.addPrompt('ctx-test-1', 'x', 'terminal')

      const ctx = contextStore.getContext('ctx-test-1')
      expect(ctx!.prompts).toHaveLength(0)
    })

    it('ring buffer keeps only last 10 entries', () => {
      const session = createTestSession()
      store.add(session)

      for (let i = 0; i < 15; i++) {
        contextStore.addPrompt('ctx-test-1', `command-${i}`, 'terminal')
      }

      // getContext returns only last 2 prompts
      const ctx = contextStore.getContext('ctx-test-1')
      expect(ctx!.prompts).toHaveLength(2)
      expect(ctx!.prompts[0].text).toBe('command-13')
      expect(ctx!.prompts[1].text).toBe('command-14')
    })

    it('emits context-updated event (debounced)', async () => {
      const session = createTestSession()
      store.add(session)

      const listener = vi.fn()
      contextStore.on('context-updated', listener)

      contextStore.addPrompt('ctx-test-1', 'hello world', 'sdk')

      // Debounce is 150ms
      expect(listener).not.toHaveBeenCalled()
      await new Promise(r => setTimeout(r, 200))
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener.mock.calls[0][0].sessionId).toBe('ctx-test-1')
    })
  })

  describe('getContext', () => {
    it('returns null for unknown session', () => {
      expect(contextStore.getContext('nonexistent')).toBeNull()
    })

    it('returns snapshot with correct session data', () => {
      const session = createTestSession({
        agentType: 'copilot-cli',
        status: 'agent_ready',
        folderPath: 'C:\\projects\\my-app',
        metrics: {
          inputTokens: 1000,
          outputTokens: 5000,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          cost: 0.02,
          totalPremiumRequests: 1,
        },
      })
      store.add(session)

      const ctx = contextStore.getContext('ctx-test-1')
      expect(ctx!.snapshot.agentType).toBe('copilot-cli')
      expect(ctx!.snapshot.status).toBe('agent_ready')
      expect(ctx!.snapshot.folderPath).toBe('C:\\projects\\my-app')
      expect(ctx!.snapshot.metrics?.inputTokens).toBe(1000)
    })
  })

  describe('resume suggestions', () => {
    it('suggests responding when needs_input', () => {
      const session = createTestSession({ status: 'needs_input' })
      store.add(session)

      const ctx = contextStore.getContext('ctx-test-1')
      expect(ctx!.resumeSuggestion.icon).toBe('⚡')
      expect(ctx!.resumeSuggestion.text).toContain('waiting for your response')
    })

    it('suggests agent working when processing', () => {
      const session = createTestSession({ status: 'processing' })
      store.add(session)

      const ctx = contextStore.getContext('ctx-test-1')
      expect(ctx!.resumeSuggestion.icon).toBe('⏳')
    })

    it('shows failed state with exit code', () => {
      const session = createTestSession({ status: 'failed', exitCode: 1 })
      store.add(session)

      const ctx = contextStore.getContext('ctx-test-1')
      expect(ctx!.resumeSuggestion.icon).toBe('❌')
      expect(ctx!.resumeSuggestion.text).toContain('exit code 1')
    })

    it('shows exited state', () => {
      const session = createTestSession({ status: 'exited' })
      store.add(session)

      const ctx = contextStore.getContext('ctx-test-1')
      expect(ctx!.resumeSuggestion.icon).toBe('🏁')
      expect(ctx!.resumeSuggestion.text).toContain('ended')
    })

    it('shows shell ready state', () => {
      const session = createTestSession({ status: 'shell_ready' })
      store.add(session)

      const ctx = contextStore.getContext('ctx-test-1')
      expect(ctx!.resumeSuggestion.icon).toBe('🐚')
    })

    it('includes last prompt in processing suggestion', () => {
      const session = createTestSession({ status: 'processing' })
      store.add(session)
      contextStore.addPrompt('ctx-test-1', 'Fix the auth middleware', 'sdk')

      const ctx = contextStore.getContext('ctx-test-1')
      expect(ctx!.resumeSuggestion.text).toContain('Fix the auth middleware')
    })
  })

  describe('session lifecycle', () => {
    it('cleans up prompts when session closes', () => {
      const session = createTestSession()
      store.add(session)

      contextStore.addPrompt('ctx-test-1', 'hello', 'terminal')
      expect(contextStore.getContext('ctx-test-1')!.prompts).toHaveLength(1)

      store.remove('ctx-test-1')

      // Session no longer exists
      expect(contextStore.getContext('ctx-test-1')).toBeNull()
    })
  })

  describe('dispose', () => {
    it('cleans up all state', () => {
      const session = createTestSession()
      store.add(session)
      contextStore.addPrompt('ctx-test-1', 'test', 'terminal')

      contextStore.dispose()

      // After dispose, getContext still works (reads from store) but prompts are gone
      const ctx = contextStore.getContext('ctx-test-1')
      expect(ctx!.prompts).toHaveLength(0)
    })
  })
})
