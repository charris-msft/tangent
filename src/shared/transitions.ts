import type { SessionStatus } from './types'

const VALID_TRANSITIONS = new Set<string>([
  'shell_ready->agent_launching',
  'agent_launching->agent_ready',
  'agent_launching->processing',
  'agent_launching->tool_executing',
  'agent_launching->needs_input',
  'agent_launching->shell_ready',
  'agent_launching->failed',
  'agent_ready->processing',
  'agent_ready->shell_ready',
  'agent_ready->tool_executing',
  'processing->agent_ready',
  'processing->tool_executing',
  'processing->needs_input',
  'processing->failed',
  'tool_executing->processing',
  'tool_executing->agent_ready',
  'tool_executing->needs_input',
  'tool_executing->failed',
  'needs_input->processing',
  'needs_input->agent_ready',
  'needs_input->tool_executing',
  'failed->agent_ready',
  'failed->processing',
  'failed->needs_input',
  'agent_ready->needs_input',
])

export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  if (from === 'exited') return false
  if (to === 'exited') return true
  if (to === 'failed') return true
  return VALID_TRANSITIONS.has(`${from}->${to}`)
}
