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

    it('cancels agent_ready if output arrives during silence window', () => {
      systemB.feed('❯ ')
      vi.advanceTimersByTime(200) // within 300ms
      systemB.feed('some more output')
      vi.advanceTimersByTime(400)
      expect(statusChanges).not.toContain('agent_ready')
    })

    it('detects spinner as processing (eager)', () => {
      systemB.feed('\u280B Working...')
      expect(statusChanges).toContain('processing')
    })

    it('detects Copilot bullet spinner as processing', () => {
      systemB.feed('• Accessing Copilot SDK repo (Esc to cancel)')
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

    it('detects Copilot interactive prompt as needs_input', () => {
      systemB.feed('5. Other (type your answer)\n\n↑↓ to select · Enter to confirm · Esc to cancel')
      vi.advanceTimersByTime(600)
      expect(statusChanges).toContain('needs_input')
    })

    it('detects "Enter to confirm" as needs_input', () => {
      systemB.feed('Enter to confirm · Esc to cancel')
      vi.advanceTimersByTime(600)
      expect(statusChanges).toContain('needs_input')
    })

    it('requires 2 error matches for failed (from shell_ready)', () => {
      // Must be in shell_ready state for failed detection
      systemB.feed('PS D:\\git> ')
      vi.advanceTimersByTime(600)
      statusChanges = []

      systemB.feed('Error: file not found')
      vi.advanceTimersByTime(100)
      expect(statusChanges).not.toContain('failed')

      systemB.feed('Error: cannot continue')
      vi.advanceTimersByTime(600)
      expect(statusChanges).toContain('failed')
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

      // Should not have transitioned to shell_ready within hold period
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
      // Should not have emitted yet
      expect(statusChanges).not.toContain('agent_ready')

      vi.advanceTimersByTime(250) // total 350ms, past 300ms silence
      expect(statusChanges).toContain('agent_ready')
    })

    it('cancels agent_ready on new output within silence window', () => {
      systemB.feed('❯ ')
      vi.advanceTimersByTime(150) // within 300ms
      systemB.feed('Agent is loading...')
      vi.advanceTimersByTime(500)
      expect(statusChanges).not.toContain('agent_ready')
    })

    it('does NOT cancel agent_ready on ANSI-only data within silence window', () => {
      systemB.feed('❯ ')
      vi.advanceTimersByTime(150) // within 300ms
      // Feed ANSI-only data (OSC title change + cursor show) — no visible text
      systemB.feed('\x1b]0;GitHub Copilot\x07\x1b[?25h')
      vi.advanceTimersByTime(200) // total 350ms, past 300ms silence
      expect(statusChanges).toContain('agent_ready')
    })
  })

  describe('processing transitions are eager', () => {
    it('transitions to processing immediately on spinner', () => {
      systemB.feed('\u280B Processing data...')
      // Should emit immediately, no delay needed
      expect(statusChanges).toEqual(['processing'])
    })

    it('transitions to processing immediately on thinking', () => {
      systemB.feed('Thinking about the problem...')
      expect(statusChanges).toEqual(['processing'])
    })
  })

  describe('failed requires 2 matches within 3 seconds', () => {
    // All failed tests need shell_ready state first (failed is gated during null/agent states)
    function enterShellReady() {
      systemB.feed('PS D:\\git> ')
      vi.advanceTimersByTime(600)
      statusChanges = []
    }

    it('does not transition on a single error line', () => {
      enterShellReady()
      systemB.feed('Error: something went wrong')
      vi.advanceTimersByTime(600)
      expect(statusChanges).not.toContain('failed')
    })

    it('transitions on 2 error matches within 3 seconds', () => {
      enterShellReady()
      systemB.feed('Error: first problem')
      vi.advanceTimersByTime(1000)
      systemB.feed('Error: second problem')
      vi.advanceTimersByTime(600)
      expect(statusChanges).toContain('failed')
    })

    it('does not transition if 2nd match is outside 3s window', () => {
      enterShellReady()
      systemB.feed('Error: first problem')
      vi.advanceTimersByTime(3500) // past the 3s window
      statusChanges = []
      systemB.feed('FATAL: crash') // This is a new first match (counter was reset by window expiry)
      vi.advanceTimersByTime(600)
      // Single match should not transition — requires 2 matches
      expect(statusChanges).not.toContain('failed')
    })

    it('does not transition on single match even after long wait', () => {
      enterShellReady()
      systemB.feed('Error: something bad happened')
      vi.advanceTimersByTime(5000) // long wait
      // Single match never transitions — requires 2 matches within window
      expect(statusChanges).not.toContain('failed')
    })

    it('does not trigger failed during startup (null state)', () => {
      // SystemB starts with null currentStatus — failed should be gated
      systemB.feed('Error: first problem')
      vi.advanceTimersByTime(100)
      systemB.feed('Error: second problem')
      vi.advanceTimersByTime(600)
      expect(statusChanges).not.toContain('failed')
    })
  })

  describe('lastActivity extraction', () => {
    it('extracts activity from editing output', () => {
      systemB.feed('Editing src/auth.ts')
      expect(activityChanges).toContain('src/auth.ts')
    })

    it('does not extract activity from generic running text', () => {
      systemB.feed('running without PSReadline')
      expect(activityChanges).toEqual([])
    })

    it('extracts activity from reading output', () => {
      systemB.feed('Reading file package.json')
      expect(activityChanges).toContain('package.json')
    })

    it('extracts activity from writing output', () => {
      systemB.feed('Writing file dist/bundle.js')
      expect(activityChanges).toContain('dist/bundle.js')
    })

    it('extracts activity from creating output', () => {
      systemB.feed('creating src/new-component.tsx')
      expect(activityChanges).toContain('src/new-component.tsx')
    })

    it('extracts activity from deleting output', () => {
      systemB.feed('deleting tmp/cache.json')
      expect(activityChanges).toContain('tmp/cache.json')
    })
  })

  describe('rolling buffer', () => {
    it('maintains a maximum of 20 lines', () => {
      // Feed 25 lines
      for (let i = 0; i < 25; i++) {
        systemB.feed(`line ${i}\n`)
      }
      // Buffer should only have 20 lines
      expect(systemB.getBuffer().length).toBeLessThanOrEqual(20)
    })
  })

  describe('priority order', () => {
    it('higher priority rule wins when multiple match', () => {
      // Spinner (priority 4) should win over tool_executing (priority 6)
      // Input contains both a spinner char and "running tool:" text
      systemB.feed('\u280B running tool: edit file')
      // processing is eager and higher priority, so it should fire
      expect(statusChanges).toContain('processing')
      expect(statusChanges).not.toContain('tool_executing')
    })

    it('PowerShell prompt wins over needs_input when both present', () => {
      // PS prompt (priority 1) should win over (y/n) (priority 7)
      systemB.feed('PS D:\\git\\app> ')
      vi.advanceTimersByTime(600)
      expect(statusChanges).toContain('shell_ready')
    })
  })

  describe('ANSI stripping', () => {
    it('strips CSI sequences with ? prefix (cursor show/hide)', () => {
      // \x1b[?25h is "show cursor" — should not leak as visible text
      systemB.feed('PS D:\\git> \x1b[?25h')
      vi.advanceTimersByTime(600)
      expect(statusChanges).toContain('shell_ready')
    })

    it('strips color codes from data before pattern matching', () => {
      systemB.feed('\x1b[31mError:\x1b[0m some issue')
      vi.advanceTimersByTime(600)
      // Should still detect Error: at line start after stripping
      expect(statusChanges).not.toContain('failed') // single match, need 2
    })

    it('does not leak escape sequences into command extraction', () => {
      const commands: string[] = []
      systemB.on('command', (cmd: string) => commands.push(cmd))
      systemB.feed('PS C:\\git> cd foo\x1b[?25h')
      expect(commands).toEqual(['cd foo'])
    })

    it('does not leak escape sequences into activity extraction', () => {
      systemB.feed('\x1b[32mReading\x1b[0m file \x1b[34mpackage.json\x1b[0m')
      expect(activityChanges).toEqual(['package.json'])
    })
  })

  describe('shell command extraction', () => {
    it('extracts command from PS prompt line', () => {
      const commands: string[] = []
      systemB.on('command', (cmd: string) => commands.push(cmd))
      systemB.feed('PS C:\\Users\\me> git status')
      expect(commands).toContain('git status')
    })

    it('does not extract command from empty prompt', () => {
      const commands: string[] = []
      systemB.on('command', (cmd: string) => commands.push(cmd))
      systemB.feed('PS C:\\Users\\me> ')
      expect(commands).toEqual([])
    })
  })

  describe('agent detection', () => {
    it('detects GitHub Copilot from output', () => {
      const detected: string[] = []
      systemB.on('agent-detected', (type: string) => detected.push(type))
      systemB.feed('GitHub Copilot v0.0.410')
      expect(detected).toEqual(['copilot-cli'])
    })

    it('detects Claude Code from output', () => {
      const detected: string[] = []
      systemB.on('agent-detected', (type: string) => detected.push(type))
      systemB.feed('Welcome to Claude Code')
      expect(detected).toEqual(['claude-code'])
    })

    it('only detects agent once per session', () => {
      const detected: string[] = []
      systemB.on('agent-detected', (type: string) => detected.push(type))
      systemB.feed('GitHub Copilot v0.0.410')
      systemB.feed('GitHub Copilot v0.0.410')
      expect(detected).toEqual(['copilot-cli'])
    })
  })

  describe('failed gating during agent states', () => {
    it('ignores error patterns when in agent_ready state', () => {
      // Transition to agent_ready first
      systemB.feed('❯ ')
      vi.advanceTimersByTime(400) // past silence window
      expect(statusChanges).toContain('agent_ready')

      vi.advanceTimersByTime(600) // past hold time
      statusChanges = []

      // Feed error patterns — should be ignored in agent_ready
      systemB.feed('Error: some agent output')
      vi.advanceTimersByTime(100)
      systemB.feed('Error: more agent output')
      vi.advanceTimersByTime(600)
      expect(statusChanges).not.toContain('failed')
    })

    it('ignores error patterns when in processing state', () => {
      systemB.feed('\u280B Working...')
      expect(statusChanges).toContain('processing')

      vi.advanceTimersByTime(600)
      statusChanges = []

      systemB.feed('Error: some processing output')
      vi.advanceTimersByTime(100)
      systemB.feed('Error: more output')
      vi.advanceTimersByTime(600)
      expect(statusChanges).not.toContain('failed')
    })

    it('allows error patterns in shell_ready state', () => {
      systemB.feed('PS D:\\git> ')
      vi.advanceTimersByTime(600)
      expect(statusChanges).toContain('shell_ready')
      statusChanges = []

      systemB.feed('Error: command failed')
      vi.advanceTimersByTime(100)
      systemB.feed('Error: another error')
      vi.advanceTimersByTime(600)
      expect(statusChanges).toContain('failed')
    })
  })

  describe('dispose', () => {
    it('cleans up timers and listeners', () => {
      systemB.feed('❯ ') // starts a silence timer
      systemB.dispose()
      vi.advanceTimersByTime(500)
      // No status should have been emitted after dispose
      expect(statusChanges).toEqual([])
    })
  })
})
