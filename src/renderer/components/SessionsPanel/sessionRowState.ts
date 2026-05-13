import { mapStatusToUI } from '@shared/statusMapping'
import type { Session, SessionStatus, UIStatusIndicator } from '@shared/types'

const PROCESS_ACTIVITY_PATTERN = /(?:^|[\\/])(?:cmd|powershell|pwsh)\.exe(?:$|\s|["'])/i

export function isProcessPathActivity(activity: string): boolean {
  return PROCESS_ACTIVITY_PATTERN.test(activity) || /\bcmd\.exe\b/i.test(activity)
}

export function usesWaitingFallback(session: Session): boolean {
  return (
    session.agentType !== 'shell' &&
    (!session.lastActivity || isProcessPathActivity(session.lastActivity))
  )
}

export function getSessionRowStatusText(session: Session): string {
  if (usesWaitingFallback(session)) {
    return session.status === 'processing' || session.status === 'tool_executing'
      ? 'Thinking...'
      : 'Waiting...'
  }

  return session.lastActivity || 'idle'
}

export function getSessionRowVisualStatus(session: Session): SessionStatus {
  const waitingForUser =
    usesWaitingFallback(session) &&
    session.status !== 'processing' &&
    session.status !== 'tool_executing' &&
    session.status !== 'failed' &&
    session.status !== 'exited'

  return waitingForUser ? 'needs_input' : session.status
}

export function getSessionRowUI(session: Session): UIStatusIndicator {
  const visualStatus = getSessionRowVisualStatus(session)
  const ui = mapStatusToUI(visualStatus)

  if (visualStatus !== 'needs_input') {
    return ui
  }

  return {
    ...ui,
    dotColor: '--error',
    barColor: '--error',
    bgTint: 'rgba(255, 68, 68, 0.06)',
    bgTintSelected: 'rgba(255, 68, 68, 0.12)',
    bgTintHover: 'rgba(255, 68, 68, 0.09)',
    glowShadow: 'inset 0 0 12px rgba(255, 68, 68, 0.08), 0 0 8px rgba(255, 68, 68, 0.04)'
  }
}
