import type { SessionStatus, UIStatusIndicator } from './types'

export function mapStatusToUI(status: SessionStatus): UIStatusIndicator {
  switch (status) {
    case 'shell_ready':
    case 'exited':
      return {
        label: 'shell',
        dotVisible: false,
        dotColor: null,
        dotAnimation: 'none',
        barColor: null,
        bgTint: 'transparent',
        bgTintSelected: 'var(--bg-active)',
        bgTintHover: 'var(--bg-hover)',
        glowShadow: 'none'
      }

    case 'processing':
    case 'tool_executing':
      return {
        label: 'running',
        dotVisible: true,
        dotColor: '--running',
        dotAnimation: 'none',
        barColor: '--running',
        bgTint: 'rgba(255, 68, 119, 0.04)',
        bgTintSelected: 'rgba(255, 68, 119, 0.10)',
        bgTintHover: 'rgba(255, 68, 119, 0.07)',
        glowShadow: 'inset 0 0 12px rgba(255, 68, 119, 0.06), 0 0 8px rgba(255, 68, 119, 0.03)'
      }

    case 'agent_launching':
    case 'agent_ready':
    case 'needs_input':
      return {
        label: 'idle',
        dotVisible: true,
        dotColor: '--idle',
        dotAnimation: 'none',
        barColor: '--idle',
        bgTint: 'rgba(255, 184, 0, 0.04)',
        bgTintSelected: 'rgba(255, 184, 0, 0.10)',
        bgTintHover: 'rgba(255, 184, 0, 0.07)',
        glowShadow: 'inset 0 0 12px rgba(255, 184, 0, 0.06), 0 0 8px rgba(255, 184, 0, 0.03)'
      }

    case 'failed':
      return {
        label: 'error',
        dotVisible: true,
        dotColor: '--error',
        dotAnimation: 'pulse-fast',
        barColor: '--error',
        bgTint: 'rgba(255, 68, 68, 0.04)',
        bgTintSelected: 'rgba(255, 68, 68, 0.10)',
        bgTintHover: 'rgba(255, 68, 68, 0.07)',
        glowShadow: 'inset 0 0 12px rgba(255, 68, 68, 0.06), 0 0 8px rgba(255, 68, 68, 0.03)'
      }
  }
}
