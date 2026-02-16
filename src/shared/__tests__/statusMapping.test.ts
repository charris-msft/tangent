import { describe, it, expect } from 'vitest'
import { mapStatusToUI } from '../statusMapping'
import type { SessionStatus } from '../types'

describe('mapStatusToUI', () => {
  describe('shell status (no dot)', () => {
    it.each(['shell_ready', 'exited'] as SessionStatus[])('%s → shell', (status) => {
      const ui = mapStatusToUI(status)
      expect(ui.label).toBe('shell')
      expect(ui.dotVisible).toBe(false)
      expect(ui.dotColor).toBeNull()
      expect(ui.dotAnimation).toBe('none')
      expect(ui.barColor).toBeNull()
      expect(ui.bgTint).toBe('transparent')
    })
  })

  describe('running status (pulsing)', () => {
    it.each(['processing', 'tool_executing'] as SessionStatus[])('%s → running', (status) => {
      const ui = mapStatusToUI(status)
      expect(ui.label).toBe('running')
      expect(ui.dotVisible).toBe(true)
      expect(ui.dotColor).toBe('--running')
      expect(ui.dotAnimation).toBe('none')
      expect(ui.barColor).toBe('--running')
      expect(ui.bgTintSelected).toBe('rgba(255, 68, 119, 0.10)')
    })
  })

  describe('idle status (amber, static)', () => {
    it.each(['agent_launching', 'agent_ready', 'needs_input'] as SessionStatus[])('%s → idle', (status) => {
      const ui = mapStatusToUI(status)
      expect(ui.label).toBe('idle')
      expect(ui.dotVisible).toBe(true)
      expect(ui.dotColor).toBe('--idle')
      expect(ui.dotAnimation).toBe('none')
      expect(ui.barColor).toBe('--idle')
    })
  })

  describe('error status (red, fast pulse)', () => {
    it('failed → error', () => {
      const ui = mapStatusToUI('failed')
      expect(ui.label).toBe('error')
      expect(ui.dotVisible).toBe(true)
      expect(ui.dotColor).toBe('--error')
      expect(ui.dotAnimation).toBe('pulse-fast')
      expect(ui.barColor).toBe('--error')
    })
  })

  it('returns all required UI fields for every status', () => {
    const allStatuses: SessionStatus[] = [
      'shell_ready', 'agent_launching', 'agent_ready', 'processing',
      'tool_executing', 'needs_input', 'failed', 'exited'
    ]
    for (const status of allStatuses) {
      const ui = mapStatusToUI(status)
      expect(ui).toHaveProperty('label')
      expect(ui).toHaveProperty('dotVisible')
      expect(ui).toHaveProperty('dotColor')
      expect(ui).toHaveProperty('dotAnimation')
      expect(ui).toHaveProperty('barColor')
      expect(ui).toHaveProperty('bgTint')
      expect(ui).toHaveProperty('bgTintSelected')
      expect(ui).toHaveProperty('bgTintHover')
      expect(ui).toHaveProperty('glowShadow')
    }
  })
})
