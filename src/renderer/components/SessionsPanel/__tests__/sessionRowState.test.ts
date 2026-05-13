import { describe, expect, it } from 'vitest'
import type { Session } from '@shared/types'
import {
  getSessionRowStatusText,
  getSessionRowUI,
  getSessionRowVisualStatus,
  isProcessPathActivity
} from '../sessionRowState'

function makeSession(overrides: Partial<Session>): Session {
  return {
    id: 'session-1',
    kind: 'pty-agent',
    agentType: 'copilot-cli',
    name: 'routines',
    folderName: 'release',
    folderPath: 'D:\\git\\tangent\\release',
    isRenamed: true,
    status: 'shell_ready',
    lastActivity: '',
    startedAt: 1,
    updatedAt: 1,
    ptyId: 'pty-1',
    isExternal: false,
    ...overrides
  }
}

describe('session row state', () => {
  it.each([
    'C:\\Windows\\System32\\cmd.exe',
    'cmd.exe',
    'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
  ])('treats process activity as a fallback, not user-visible activity: %s', (activity) => {
    expect(isProcessPathActivity(activity)).toBe(true)
  })

  it.each(['shell_ready', 'agent_launching', 'agent_ready'] as const)(
    'shows a waiting agent row as needs_input even when backend status is %s',
    (status) => {
      const session = makeSession({
        status,
        lastActivity: 'C:\\Windows\\System32\\cmd.exe'
      })

      expect(getSessionRowStatusText(session)).toBe('Waiting...')
      expect(getSessionRowVisualStatus(session)).toBe('needs_input')
      expect(getSessionRowUI(session).barColor).toBe('--error')
    }
  )

  it('preserves running color when an agent is thinking with process activity', () => {
    const session = makeSession({
      status: 'processing',
      lastActivity: 'C:\\Windows\\System32\\cmd.exe'
    })

    expect(getSessionRowStatusText(session)).toBe('Thinking...')
    expect(getSessionRowVisualStatus(session)).toBe('processing')
    expect(getSessionRowUI(session).barColor).toBe('--running')
  })

  it('does not color plain shell rows as agent attention', () => {
    const session = makeSession({
      agentType: 'shell',
      kind: 'shell',
      status: 'shell_ready',
      lastActivity: ''
    })

    expect(getSessionRowStatusText(session)).toBe('idle')
    expect(getSessionRowVisualStatus(session)).toBe('shell_ready')
    expect(getSessionRowUI(session).barColor).toBeNull()
  })
})
