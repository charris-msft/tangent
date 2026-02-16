import { describe, it, expect, vi, beforeEach } from 'vitest'
import { canTransition } from '../../../shared/transitions'
import { SessionStore } from '../SessionStore'
import { SdkLineBuffer } from '../../../shared/SdkLineBuffer'
import type { Session, SessionStatus } from '../../../shared/types'

// === Helper: create a minimal SDK session and add it to a store ===
function createTestStore(): { store: SessionStore; session: Session } {
  const store = new SessionStore()
  const session: Session = {
    id: 'sdk-test-1',
    kind: 'copilot-sdk',
    agentType: 'copilot-cli',
    name: 'Test',
    folderName: 'test',
    folderPath: 'C:\\test',
    isRenamed: false,
    status: 'agent_launching',
    lastActivity: '',
    startedAt: Date.now(),
    updatedAt: Date.now(),
    ptyId: '',
    isExternal: false
  }
  store.add(session)
  return { store, session }
}

// ============================================================================
// SessionStore.updateMetrics — behavioral tests
// ============================================================================

describe('SessionStore.updateMetrics', () => {
  let store: SessionStore

  beforeEach(() => {
    const result = createTestStore()
    store = result.store
  })

  it('initializes metrics on first call', () => {
    const before = store.get('sdk-test-1')
    expect(before?.metrics).toBeUndefined()

    store.updateMetrics('sdk-test-1', { inputTokens: 100 })

    const after = store.get('sdk-test-1')
    expect(after?.metrics).toBeDefined()
    expect(after?.metrics?.inputTokens).toBe(100)
    expect(after?.metrics?.outputTokens).toBe(0)
    expect(after?.metrics?.cost).toBe(0)
  })

  it('accumulates token counts across multiple calls', () => {
    store.updateMetrics('sdk-test-1', { inputTokens: 100, outputTokens: 50 })
    store.updateMetrics('sdk-test-1', { inputTokens: 200, outputTokens: 75 })
    store.updateMetrics('sdk-test-1', { inputTokens: 50, outputTokens: 25 })

    const session = store.get('sdk-test-1')
    expect(session?.metrics?.inputTokens).toBe(350)
    expect(session?.metrics?.outputTokens).toBe(150)
  })

  it('accumulates cost', () => {
    store.updateMetrics('sdk-test-1', { cost: 0.01 })
    store.updateMetrics('sdk-test-1', { cost: 0.02 })
    store.updateMetrics('sdk-test-1', { cost: 0.005 })

    const session = store.get('sdk-test-1')
    expect(session?.metrics?.cost).toBeCloseTo(0.035)
  })

  it('snapshots (not accumulates) totalPremiumRequests', () => {
    store.updateMetrics('sdk-test-1', { totalPremiumRequests: 1 })
    store.updateMetrics('sdk-test-1', { totalPremiumRequests: 3 })
    store.updateMetrics('sdk-test-1', { totalPremiumRequests: 5 })

    const session = store.get('sdk-test-1')
    expect(session?.metrics?.totalPremiumRequests).toBe(5) // snapshot, not 9
  })

  it('snapshots contextTokens and contextLimit', () => {
    store.updateMetrics('sdk-test-1', { contextTokens: 4000, contextLimit: 128000 })
    store.updateMetrics('sdk-test-1', { contextTokens: 8000 })

    const session = store.get('sdk-test-1')
    expect(session?.metrics?.contextTokens).toBe(8000)
    expect(session?.metrics?.contextLimit).toBe(128000)
  })

  it('emits "updated" event on metrics change', () => {
    const handler = vi.fn()
    store.on('updated', handler)
    store.updateMetrics('sdk-test-1', { inputTokens: 100 })
    expect(handler).toHaveBeenCalledOnce()
  })

  it('emits "metrics" event on metrics change', () => {
    const handler = vi.fn()
    store.on('metrics', handler)
    store.updateMetrics('sdk-test-1', { inputTokens: 100 })
    expect(handler).toHaveBeenCalledOnce()
    expect(handler.mock.calls[0][0].metrics.inputTokens).toBe(100)
  })

  it('silently ignores unknown session IDs', () => {
    expect(() => store.updateMetrics('nonexistent', { inputTokens: 100 })).not.toThrow()
  })

  it('handles partial updates (only some fields)', () => {
    store.updateMetrics('sdk-test-1', { inputTokens: 100, outputTokens: 50 })
    store.updateMetrics('sdk-test-1', { cacheReadTokens: 30 })

    const session = store.get('sdk-test-1')
    expect(session?.metrics?.inputTokens).toBe(100) // unchanged
    expect(session?.metrics?.outputTokens).toBe(50) // unchanged
    expect(session?.metrics?.cacheReadTokens).toBe(30) // newly set
  })
})

// ============================================================================
// SessionStore — SDK session status flow
// ============================================================================

describe('SessionStore SDK status flow', () => {
  it('supports the full SDK turn lifecycle', () => {
    const { store } = createTestStore()

    store.updateStatus('sdk-test-1', 'agent_ready')
    expect(store.get('sdk-test-1')?.status).toBe('agent_ready')

    store.updateStatus('sdk-test-1', 'processing')
    expect(store.get('sdk-test-1')?.status).toBe('processing')

    store.updateStatus('sdk-test-1', 'tool_executing')
    expect(store.get('sdk-test-1')?.status).toBe('tool_executing')

    store.updateStatus('sdk-test-1', 'processing')
    expect(store.get('sdk-test-1')?.status).toBe('processing')

    store.updateStatus('sdk-test-1', 'agent_ready')
    expect(store.get('sdk-test-1')?.status).toBe('agent_ready')
  })

  it('supports permission request flow (tool → needs_input → tool)', () => {
    const { store } = createTestStore()

    store.updateStatus('sdk-test-1', 'agent_ready')
    store.updateStatus('sdk-test-1', 'processing')
    store.updateStatus('sdk-test-1', 'tool_executing')
    store.updateStatus('sdk-test-1', 'needs_input')
    expect(store.get('sdk-test-1')?.status).toBe('needs_input')

    store.updateStatus('sdk-test-1', 'tool_executing')
    expect(store.get('sdk-test-1')?.status).toBe('tool_executing')
  })

  it('supports direct agent_ready → tool_executing (SDK fast path)', () => {
    const { store } = createTestStore()

    store.updateStatus('sdk-test-1', 'agent_ready')
    store.updateStatus('sdk-test-1', 'tool_executing')
    expect(store.get('sdk-test-1')?.status).toBe('tool_executing')
  })

  it('supports error recovery (failed → agent_ready)', () => {
    const { store } = createTestStore()

    store.updateStatus('sdk-test-1', 'agent_ready')
    store.updateStatus('sdk-test-1', 'failed')
    expect(store.get('sdk-test-1')?.status).toBe('failed')

    store.updateStatus('sdk-test-1', 'agent_ready')
    expect(store.get('sdk-test-1')?.status).toBe('agent_ready')
  })

  it('supports shutdown from any active state', () => {
    const activeStates: SessionStatus[] = [
      'agent_ready', 'processing', 'tool_executing', 'needs_input', 'failed'
    ]
    for (const state of activeStates) {
      const { store } = createTestStore()
      store.updateStatus('sdk-test-1', 'agent_ready')
      if (state !== 'agent_ready') {
        // Get to the desired state via a valid path
        if (state === 'processing') {
          store.updateStatus('sdk-test-1', 'processing')
        } else if (state === 'tool_executing') {
          store.updateStatus('sdk-test-1', 'tool_executing')
        } else if (state === 'needs_input') {
          store.updateStatus('sdk-test-1', 'needs_input')
        } else if (state === 'failed') {
          store.updateStatus('sdk-test-1', 'failed')
        }
      }
      store.updateStatus('sdk-test-1', 'exited')
      expect(store.get('sdk-test-1')?.status).toBe('exited')
    }
  })

  it('rejects transitions from exited', () => {
    const { store } = createTestStore()
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    store.updateStatus('sdk-test-1', 'agent_ready')
    store.updateStatus('sdk-test-1', 'exited')
    store.updateStatus('sdk-test-1', 'agent_ready') // should be rejected

    expect(store.get('sdk-test-1')?.status).toBe('exited')
    spy.mockRestore()
  })

  it('skips no-op transitions (same status)', () => {
    const { store } = createTestStore()
    store.updateStatus('sdk-test-1', 'agent_ready')

    const handler = vi.fn()
    store.on('updated', handler)

    store.updateStatus('sdk-test-1', 'agent_ready') // same status
    expect(handler).not.toHaveBeenCalled()
  })
})

// ============================================================================
// SdkLineBuffer — line editing behavioral tests
// ============================================================================

describe('SdkLineBuffer', () => {
  let writes: string[]
  let submits: string[]
  let buffer: SdkLineBuffer

  beforeEach(() => {
    writes = []
    submits = []
    buffer = new SdkLineBuffer(
      (data) => writes.push(data),
      (line) => submits.push(line)
    )
  })

  describe('basic typing and submit', () => {
    it('echoes typed characters', () => {
      buffer.handleInput('h')
      buffer.handleInput('i')
      expect(writes).toEqual(['h', 'i'])
      expect(buffer.getLine()).toBe('hi')
    })

    it('submits on Enter and clears buffer', () => {
      buffer.handleInput('h')
      buffer.handleInput('e')
      buffer.handleInput('l')
      buffer.handleInput('l')
      buffer.handleInput('o')
      buffer.handleInput('\r')

      expect(submits).toEqual(['hello'])
      expect(buffer.getLine()).toBe('')
      expect(buffer.getCursorPos()).toBe(0)
    })

    it('does not submit empty lines', () => {
      buffer.handleInput('\r')
      expect(submits).toEqual([])
    })

    it('does not submit whitespace-only lines', () => {
      buffer.handleInput(' ')
      buffer.handleInput(' ')
      buffer.handleInput('\r')
      expect(submits).toEqual([])
    })

    it('handles \\n as submit too', () => {
      buffer.handleInput('a')
      buffer.handleInput('\n')
      expect(submits).toEqual(['a'])
    })
  })

  describe('backspace', () => {
    it('deletes character before cursor', () => {
      buffer.handleInput('a')
      buffer.handleInput('b')
      buffer.handleInput('c')
      buffer.handleInput('\x7f') // backspace

      expect(buffer.getLine()).toBe('ab')
      expect(buffer.getCursorPos()).toBe(2)
    })

    it('does nothing at beginning of line', () => {
      buffer.handleInput('\x7f')
      expect(buffer.getLine()).toBe('')
      expect(writes).toEqual([]) // no write emitted
    })

    it('handles \\b as backspace too', () => {
      buffer.handleInput('x')
      buffer.handleInput('\b')
      expect(buffer.getLine()).toBe('')
    })

    it('backspace in middle of line preserves suffix', () => {
      buffer.handleInput('a')
      buffer.handleInput('b')
      buffer.handleInput('c')
      // Move cursor left once
      buffer.handleInput('\x1b[D')
      // Now cursor is between 'b' and 'c'
      buffer.handleInput('\x7f') // delete 'b'
      expect(buffer.getLine()).toBe('ac')
      expect(buffer.getCursorPos()).toBe(1)
    })
  })

  describe('Ctrl+C', () => {
    it('clears the current line', () => {
      buffer.handleInput('h')
      buffer.handleInput('e')
      buffer.handleInput('l')
      buffer.handleInput('\x03') // Ctrl+C

      expect(buffer.getLine()).toBe('')
      expect(buffer.getCursorPos()).toBe(0)
      expect(writes).toContain('^C\r\n')
    })

    it('does nothing on empty line', () => {
      const writesBefore = writes.length
      buffer.handleInput('\x03')
      expect(writes.length).toBe(writesBefore) // no write
    })
  })

  describe('arrow keys', () => {
    it('left arrow moves cursor back', () => {
      buffer.handleInput('a')
      buffer.handleInput('b')
      buffer.handleInput('\x1b[D') // left
      expect(buffer.getCursorPos()).toBe(1)
    })

    it('left arrow does nothing at position 0', () => {
      const writesBefore = writes.length
      buffer.handleInput('\x1b[D')
      expect(buffer.getCursorPos()).toBe(0)
      expect(writes.length).toBe(writesBefore) // no write emitted
    })

    it('right arrow moves cursor forward', () => {
      buffer.handleInput('a')
      buffer.handleInput('b')
      buffer.handleInput('\x1b[D') // left
      buffer.handleInput('\x1b[C') // right
      expect(buffer.getCursorPos()).toBe(2)
    })

    it('right arrow does nothing at end', () => {
      buffer.handleInput('a')
      const writesBefore = writes.length
      buffer.handleInput('\x1b[C')
      expect(buffer.getCursorPos()).toBe(1)
      expect(writes.length).toBe(writesBefore)
    })

    it('up/down arrows are consumed but ignored', () => {
      buffer.handleInput('a')
      expect(buffer.handleInput('\x1b[A')).toBe(true) // up
      expect(buffer.handleInput('\x1b[B')).toBe(true) // down
      expect(buffer.getLine()).toBe('a') // unchanged
    })
  })

  describe('Home and End', () => {
    it('Home moves cursor to start', () => {
      buffer.handleInput('a')
      buffer.handleInput('b')
      buffer.handleInput('c')
      buffer.handleInput('\x1b[H') // Home
      expect(buffer.getCursorPos()).toBe(0)
    })

    it('End moves cursor to end', () => {
      buffer.handleInput('a')
      buffer.handleInput('b')
      buffer.handleInput('c')
      buffer.handleInput('\x1b[H') // Home
      buffer.handleInput('\x1b[F') // End
      expect(buffer.getCursorPos()).toBe(3)
    })

    it('Home at position 0 is a no-op', () => {
      const writesBefore = writes.length
      buffer.handleInput('\x1b[H')
      expect(writes.length).toBe(writesBefore)
    })

    it('End at end-of-line is a no-op', () => {
      buffer.handleInput('a')
      const writesBefore = writes.length
      buffer.handleInput('\x1b[F')
      expect(writes.length).toBe(writesBefore)
    })
  })

  describe('Delete key', () => {
    it('deletes character at cursor', () => {
      buffer.handleInput('a')
      buffer.handleInput('b')
      buffer.handleInput('c')
      buffer.handleInput('\x1b[H') // Home
      buffer.handleInput('\x1b[3~') // Delete
      expect(buffer.getLine()).toBe('bc')
      expect(buffer.getCursorPos()).toBe(0)
    })

    it('does nothing at end of line', () => {
      buffer.handleInput('a')
      buffer.handleInput('\x1b[3~')
      expect(buffer.getLine()).toBe('a')
    })
  })

  describe('insert in middle', () => {
    it('inserts character at cursor position', () => {
      buffer.handleInput('a')
      buffer.handleInput('c')
      buffer.handleInput('\x1b[D') // left, cursor after 'a'
      buffer.handleInput('b')
      expect(buffer.getLine()).toBe('abc')
      expect(buffer.getCursorPos()).toBe(2)
    })
  })

  describe('all inputs return true', () => {
    it.each([
      ['printable', 'a'],
      ['enter', '\r'],
      ['backspace', '\x7f'],
      ['ctrl+c', '\x03'],
      ['left arrow', '\x1b[D'],
      ['right arrow', '\x1b[C'],
      ['home', '\x1b[H'],
      ['end', '\x1b[F'],
      ['delete', '\x1b[3~'],
      ['up arrow', '\x1b[A'],
      ['down arrow', '\x1b[B'],
    ])('%s is consumed (returns true)', (_, input) => {
      // Need some text for backspace/arrows to work
      buffer.handleInput('x')
      expect(buffer.handleInput(input)).toBe(true)
    })
  })
})

// ============================================================================
// SDK transition validation (kept from original — still useful)
// ============================================================================

describe('SDK-specific transitions', () => {
  const sdkTransitions: [SessionStatus, SessionStatus][] = [
    ['agent_ready', 'tool_executing'],
    ['tool_executing', 'needs_input'],
    ['needs_input', 'tool_executing'],
  ]

  it.each(sdkTransitions)('%s → %s is valid', (from, to) => {
    expect(canTransition(from, to)).toBe(true)
  })
})
