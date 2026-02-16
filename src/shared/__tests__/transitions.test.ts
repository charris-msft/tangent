import { describe, it, expect } from 'vitest'
import { canTransition } from '../transitions'

describe('canTransition', () => {
  const validTransitions = [
    ['shell_ready', 'agent_launching'],
    ['agent_launching', 'agent_ready'],
    ['agent_launching', 'processing'],
    ['agent_launching', 'tool_executing'],
    ['agent_launching', 'needs_input'],
    ['agent_launching', 'shell_ready'],
    ['agent_launching', 'failed'],
    ['agent_ready', 'processing'],
    ['agent_ready', 'shell_ready'],
    ['agent_ready', 'tool_executing'],
    ['processing', 'agent_ready'],
    ['processing', 'tool_executing'],
    ['processing', 'needs_input'],
    ['processing', 'failed'],
    ['tool_executing', 'processing'],
    ['tool_executing', 'agent_ready'],
    ['tool_executing', 'needs_input'],
    ['tool_executing', 'failed'],
    ['needs_input', 'processing'],
    ['needs_input', 'agent_ready'],
    ['needs_input', 'tool_executing'],
    ['failed', 'agent_ready'],
    ['failed', 'processing'],
    ['failed', 'needs_input'],
    ['agent_ready', 'needs_input'],
  ] as const

  it.each(validTransitions)('%s → %s is valid', (from, to) => {
    expect(canTransition(from, to)).toBe(true)
  })

  it.each([
    'shell_ready', 'agent_launching', 'agent_ready', 'processing',
    'tool_executing', 'needs_input', 'failed'
  ] as const)('%s → exited is valid', (from) => {
    expect(canTransition(from, 'exited')).toBe(true)
  })

  it.each([
    'shell_ready', 'agent_launching', 'agent_ready', 'processing',
    'tool_executing', 'needs_input'
  ] as const)('%s → failed is valid', (from) => {
    expect(canTransition(from, 'failed')).toBe(true)
  })

  it.each([
    'shell_ready', 'agent_launching', 'agent_ready', 'processing',
    'tool_executing', 'needs_input', 'failed', 'exited'
  ] as const)('exited → %s is invalid', (to) => {
    expect(canTransition('exited', to)).toBe(false)
  })

  const invalidTransitions = [
    ['shell_ready', 'processing'],
    ['shell_ready', 'agent_ready'],
    ['processing', 'shell_ready'],
    ['processing', 'agent_launching'],
    ['needs_input', 'shell_ready'],
  ] as const

  it.each(invalidTransitions)('%s → %s is invalid', (from, to) => {
    expect(canTransition(from, to)).toBe(false)
  })
})
