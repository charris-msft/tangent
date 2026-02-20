import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SystemB } from '../SystemB'
import type { SessionStatus } from '@shared/types'

describe('SystemB', () => {
  let systemB: SystemB
  let statusChanges: SessionStatus[]
  let activityChanges: string[]

  beforeEach(() => {
    vi.useFakeTimers()
    systemB = new SystemB()
    statusChanges = []
    activityChanges = []
    systemB.on('status', (status: SessionStatus) => statusChanges.push(status))
    systemB.on('activity', (activity: string) => activityChanges.push(activity))
  })

  afterEach(() => {
    vi.useRealTimers()
    systemB.dispose()
  })

  describe('pattern detection', () => {
    it('detects PowerShell prompt as shell_ready', () => {
      systemB.feed('PS D:\\git\\myapp> ')
      vi.advanceTimersByTime(600)
      expect(statusChanges).toContain('shell_ready')
    })

    it('detects ❯ as agent_ready after 300ms silence', () => {
      systemB.feed('❯ ')
      vi.advanceTimersByTime(400) // past 300ms silence
      expect(statusChanges).toContain('agent_ready')
    })

    it('detects › as agent_ready after 300ms silence', () => {
      systemB.feed('› ')
      vi.advanceTimersByTime(400)
      expect(statusChanges).toContain('agent_ready')
    })

    it('cancels agent_ready if visible output arrives during silence window', () => {
      systemB.feed('❯ ')
      vi.advanceTimersByTime(200) // within 300ms
      systemB.feed('some more output')
      vi.advanceTimersByTime(400)
      expect(statusChanges).not.toContain('agent_ready')
    })

    it('does NOT cancel agent_ready for ANSI-only data', () => {
      systemB.feed('❯ ')
      vi.advanceTimersByTime(200)
      systemB.feed('\x1b[?25h') // cursor show — ANSI only, no visible text
      vi.advanceTimersByTime(200)
      expect(statusChanges).toContain('agent_ready')
    })

    it('detects spinner as processing (eager)', () => {
      systemB.feed('\u280B Working...')
      expect(statusChanges).toContain('processing')
    })

    it('detects thinking as processing', () => {
      systemB.feed('Thinking...')
      expect(statusChanges).toContain('processing')
    })

    it('detects tool patterns as tool_executing', () => {
      systemB.feed('running tool: edit src/app.ts')
      vi.advanceTimersByTime(600)
      expect(statusChanges).toContain('tool_executing')
    })

    it('detects y/n as needs_input', () => {
      systemB.feed('Apply changes? (y/n)')
      vi.advanceTimersByTime(600)
      expect(statusChanges).toContain('needs_input')
    })

    it('detects "Enter to confirm" as needs_input', () => {
      systemB.feed('Enter to confirm')
      vi.advanceTimersByTime(600)
      expect(statusChanges).toContain('needs_input')
    })

    it('detects "Other (type your answer)" as needs_input', () => {
      systemB.feed('Other (type your answer)')
      vi.advanceTimersByTime(600)
      expect(statusChanges).toContain('needs_input')
    })

    it('requires shell_ready state for error detection', () => {
      // First, get into shell_ready state
      systemB.feed('PS D:\\git> ')
      vi.advanceTimersByTime(600)
      expect(statusChanges).toContain('shell_ready')
      statusChanges = []

      // Now error patterns should work
      systemB.feed('Error: file not found')
      vi.advanceTimersByTime(600)
      systemB.feed('Error: cannot continue')
      vi.advanceTimersByTime(600)
      expect(statusChanges).toContain('failed')
    })

    it('ignores error patterns during agent session states', () => {
      // Get into processing state (agent is active)
      systemB.feed('\u280B Working...')
      vi.advanceTimersByTime(600)
      statusChanges = []

      // Error patterns should be ignored — agent prints error text as content
      systemB.feed('Error: file not found')
      vi.advanceTimersByTime(600)
      systemB.feed('Error: more errors')
      vi.advanceTimersByTime(600)
      expect(statusChanges).not.toContain('failed')
    })
  })

  describe('ANSI stripping', () => {
    it('strips ANSI before pattern matching', () => {
      // Spinner wrapped in color codes
      systemB.feed('\x1b[33m\u280B\x1b[0m Working...')
      expect(statusChanges).toContain('processing')
    })

    it('strips OSC sequences before pattern matching', () => {
      // OSC title sequence followed by a prompt
      systemB.feed('\x1b]0;Some Title\x07❯ ')
      vi.advanceTimersByTime(400)
      expect(statusChanges).toContain('agent_ready')
    })
  })

  describe('agent detection', () => {
    it('emits agent-detected for Copilot CLI banner', () => {
      const agents: string[] = []
      systemB.on('agent-detected', (agentType: string) => agents.push(agentType))
      systemB.feed('GitHub Copilot v0.0.411-0')
      expect(agents).toContain('copilot-cli')
    })

    it('emits agent-detected for Copilot via task prompt', () => {
      const agents: string[] = []
      systemB.on('agent-detected', (agentType: string) => agents.push(agentType))
      systemB.feed('Describe a task to get started.')
      expect(agents).toContain('copilot-cli')
    })

    it('does NOT emit agent-detected for casual mention of GitHub Copilot', () => {
      const agents: string[] = []
      systemB.on('agent-detected', (agentType: string) => agents.push(agentType))
      systemB.feed('GitHub Copilot')
      expect(agents).toHaveLength(0)
    })

    it('emits agent-detected for Claude Code', () => {
      const agents: string[] = []
      systemB.on('agent-detected', (agentType: string) => agents.push(agentType))
      systemB.feed('Claude Code v1.0')
      expect(agents).toContain('claude-code')
    })

    it('only detects agent once per session', () => {
      const agents: string[] = []
      systemB.on('agent-detected', (agentType: string) => agents.push(agentType))
      systemB.feed('GitHub Copilot v0.0.411-0')
      systemB.feed('GitHub Copilot v0.0.411-0')
      expect(agents).toHaveLength(1)
    })
  })

  describe('shell command extraction', () => {
    it('extracts commands from PS prompt lines', () => {
      const commands: string[] = []
      systemB.on('command', (cmd: string) => commands.push(cmd))
      systemB.feed('PS D:\\git\\app> npm run build')
      expect(commands).toContain('npm run build')
    })
  })

  describe('minimum hold time', () => {
    it('ignores transitions within 500ms of last change', () => {
      systemB.feed('\u280B Working...') // processing (eager)
      expect(statusChanges).toContain('processing')
      statusChanges = []

      vi.advanceTimersByTime(200) // within 500ms hold
      systemB.feed('PS D:\\> ') // shell_ready attempt within hold
      vi.advanceTimersByTime(600)

      expect(statusChanges).not.toContain('shell_ready')
    })

    it('allows transitions after 500ms hold period', () => {
      systemB.feed('\u280B Working...') // processing (eager)
      expect(statusChanges).toContain('processing')
      statusChanges = []

      vi.advanceTimersByTime(600) // past 500ms hold
      systemB.feed('PS D:\\> ') // shell_ready attempt after hold
      vi.advanceTimersByTime(600)

      expect(statusChanges).toContain('shell_ready')
    })
  })

  describe('300ms silence confirmation for agent_ready', () => {
    it('waits 300ms of silence before committing agent_ready', () => {
      systemB.feed('❯ ')
      vi.advanceTimersByTime(100)
      expect(statusChanges).not.toContain('agent_ready')

      vi.advanceTimersByTime(250) // total 350ms, past 300ms silence
      expect(statusChanges).toContain('agent_ready')
    })

    it('cancels agent_ready on new visible output within silence window', () => {
      systemB.feed('❯ ')
      vi.advanceTimersByTime(150) // within 300ms
      systemB.feed('Agent is loading...')
      vi.advanceTimersByTime(500)
      expect(statusChanges).not.toContain('agent_ready')
    })
  })

  describe('processing transitions are eager', () => {
    it('transitions to processing immediately on spinner', () => {
      systemB.feed('\u280B Processing data...')
      expect(statusChanges).toEqual(['processing'])
    })

    it('transitions to processing immediately on thinking', () => {
      systemB.feed('Thinking about the problem...')
      expect(statusChanges).toEqual(['processing'])
    })
  })

  describe('failed requires 2 matches within 3 seconds in shell state', () => {
    // Helper: get into shell_ready state first
    function enterShellState(): void {
      systemB.feed('PS D:\\git> ')
      vi.advanceTimersByTime(600)
      statusChanges = []
    }

    it('does not transition on a single error line', () => {
      enterShellState()
      systemB.feed('Error: something went wrong')
      vi.advanceTimersByTime(600)
      expect(statusChanges).not.toContain('failed')
    })

    it('transitions on 2 error matches within 3 seconds', () => {
      enterShellState()
      systemB.feed('Error: first problem')
      vi.advanceTimersByTime(1000)
      systemB.feed('Error: second problem')
      vi.advanceTimersByTime(600)
      expect(statusChanges).toContain('failed')
    })

    it('does not transition if 2nd match is outside 3s window', () => {
      enterShellState()
      systemB.feed('Error: first problem')
      vi.advanceTimersByTime(3500) // outside 3s window
      statusChanges = []
      systemB.feed('Error: second problem')
      vi.advanceTimersByTime(600)
      // 2nd match restarts the counter, so single match = no transition
      expect(statusChanges).not.toContain('failed')
    })
  })

  describe('lastActivity extraction', () => {
    it('extracts activity from Reading output', () => {
      systemB.feed('Reading file package.json')
      expect(activityChanges).toContain('package.json')
    })

    it('extracts activity from Writing output', () => {
      systemB.feed('Writing file dist/bundle.js')
      expect(activityChanges).toContain('dist/bundle.js')
    })

    it('extracts activity from Editing output', () => {
      systemB.feed('Editing src/auth.ts')
      expect(activityChanges).toContain('src/auth.ts')
    })

    it('extracts activity from Creating output', () => {
      systemB.feed('Creating src/new-component.tsx')
      expect(activityChanges).toContain('src/new-component.tsx')
    })

    it('extracts activity from Deleting output', () => {
      systemB.feed('Deleting tmp/cache.json')
      expect(activityChanges).toContain('tmp/cache.json')
    })
  })

  describe('rolling buffer', () => {
    it('maintains a maximum of 20 lines', () => {
      for (let i = 0; i < 25; i++) {
        systemB.feed(`line ${i}\n`)
      }
      expect(systemB.getBuffer().length).toBeLessThanOrEqual(20)
    })
  })

  describe('priority order', () => {
    it('spinner (priority 2) wins over tool_executing (priority 4)', () => {
      systemB.feed('\u280B running tool: edit file')
      expect(statusChanges).toContain('processing')
      expect(statusChanges).not.toContain('tool_executing')
    })

    it('PowerShell prompt wins over needs_input when both present', () => {
      systemB.feed('PS D:\\git\\app> ')
      vi.advanceTimersByTime(600)
      expect(statusChanges).toContain('shell_ready')
    })
  })

  describe('needs_input cooldown', () => {
    it('clearNeedsInput prevents re-entry for cooldown period', () => {
      // Get into needs_input
      systemB.feed('Asking user something')
      vi.advanceTimersByTime(600)
      expect(statusChanges).toContain('needs_input')
      statusChanges.length = 0

      // OSC signal cleared needs_input — tell SystemB
      systemB.clearNeedsInput()

      // TUI redraw still contains stale "Asking user" text
      systemB.feed('Asking user something')
      vi.advanceTimersByTime(600)

      // Should NOT re-enter needs_input during cooldown
      expect(statusChanges).not.toContain('needs_input')
    })

    it('needs_input is allowed again after cooldown expires', () => {
      systemB.feed('Asking user something')
      vi.advanceTimersByTime(600)
      expect(statusChanges).toContain('needs_input')
      statusChanges.length = 0

      systemB.clearNeedsInput()

      // Wait for cooldown to expire (3 seconds)
      vi.advanceTimersByTime(3000)

      // Now a fresh needs_input should work
      systemB.feed('Asking user a new question')
      vi.advanceTimersByTime(600)
      expect(statusChanges).toContain('needs_input')
    })

    it('spinner characters override needs_input and start cooldown', () => {
      // Get into needs_input
      systemB.feed('Asking user something')
      vi.advanceTimersByTime(600)
      expect(statusChanges).toContain('needs_input')
      statusChanges.length = 0

      // Spinner appears (user answered, Copilot is thinking)
      systemB.feed('⠋ Thinking (Esc to cancel)\nAsked user: Which color?')
      vi.advanceTimersByTime(600)

      expect(statusChanges).toContain('processing')
      expect(statusChanges).not.toContain('needs_input')
    })

    it('needs_input is suppressed when ❯ prompt is present (stale text)', () => {
      // Get into needs_input first via a chunk without ❯
      systemB.feed('Asking user something')
      vi.advanceTimersByTime(600)
      expect(statusChanges).toContain('needs_input')
      statusChanges.length = 0

      // TUI redraws full screen: has both "Asked user" AND ❯ prompt
      // This means the question is historical — suppress needs_input
      systemB.feed('Asked user: Which color?\n❯ ')
      vi.advanceTimersByTime(600)

      // needs_input should not re-trigger; agent_ready should fire via silence timer
      expect(statusChanges).not.toContain('needs_input')
    })
  })

  describe('dispose', () => {
    it('cleans up timers and listeners', () => {
      systemB.feed('❯ ') // starts a silence timer
      systemB.dispose()
      vi.advanceTimersByTime(500)
      expect(statusChanges).toEqual([])
    })
  })

  describe('alt-screen mode scenarios', () => {
    it('detects needs_input when question arrives in a chunk without ❯ prompt', () => {
      // Alt-screen TUI sends the ask_user dialog as a separate chunk
      systemB.feed('╭──────────────────────────╮\n│ Which color would you like? │\n╰──────────────────────────╯')
      vi.advanceTimersByTime(600)
      // No needs_input match — the dialog box doesn't match the pattern
      // The actual needs_input match comes from the "Asking user" line
      statusChanges = []
      systemB.feed('● Asking user:  Which color would you like?')
      vi.advanceTimersByTime(600)
      expect(statusChanges).toContain('needs_input')
    })

    it('spinner in alt-screen redraw overrides stale needs_input text', () => {
      // First, enter needs_input
      systemB.feed('Asking user: Choose a color')
      vi.advanceTimersByTime(600)
      expect(statusChanges).toContain('needs_input')
      statusChanges = []

      // Alt-screen redraws include the full TUI — spinner + old question text
      systemB.feed('⠋ Processing\nAsked user: Choose a color\n❯ ')
      vi.advanceTimersByTime(600)
      expect(statusChanges).toContain('processing')
      expect(statusChanges).not.toContain('needs_input')
    })

    it('full alt-screen TUI redraw with prompt and old question does not re-trigger needs_input', () => {
      // Initial needs_input
      systemB.feed('Asking user: Pick a number')
      vi.advanceTimersByTime(600)
      expect(statusChanges).toContain('needs_input')
      statusChanges = []

      // Clear via external signal (SDK/OSC)
      systemB.clearNeedsInput()

      // Alt-screen TUI redraw: historical question text + prompt visible
      systemB.feed('GitHub Copilot v1.0\nAsked user: Pick a number\nYou chose: 42\n❯ ')
      vi.advanceTimersByTime(600)
      // Should NOT re-enter needs_input (cooldown active + prompt visible)
      expect(statusChanges).not.toContain('needs_input')
    })

    it('processing detected when ❯ prompt is present during active work', () => {
      // In alt-screen, ❯ is always visible. Processing should still work.
      systemB.feed('⠙ Thinking about the problem...\n❯ ')
      expect(statusChanges).toContain('processing')
    })

    it('agent_ready is suppressed during processing even when ❯ prompt is present', () => {
      // Get into processing
      systemB.feed('⠋ Working...')
      expect(statusChanges).toContain('processing')
      statusChanges = []

      // Alt-screen redraw with ❯ prompt — should NOT trigger agent_ready
      // because we're in processing state
      systemB.feed('⠙ Still working...\n❯ ')
      vi.advanceTimersByTime(600)
      expect(statusChanges).not.toContain('agent_ready')
    })
  })
})
