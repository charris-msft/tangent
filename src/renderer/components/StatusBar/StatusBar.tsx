import { useMemo } from 'react'
import type { Session } from '@shared/types'
import { mapStatusToUI } from '@shared/statusMapping'

interface StatusBarProps {
  sessions: Session[]
  activeSession: Session | undefined
}

/** Agent type label mapping */
const AGENT_LABELS: Record<string, string> = {
  'copilot-cli': 'Copilot CLI',
  'claude-code': 'Claude Code',
  shell: 'Shell'
}

/**
 * Truncate a path from the left side if it exceeds maxLen.
 * e.g., "C:\Users\me\very\long\path" -> "...\very\long\path"
 */
function truncatePathLeft(p: string, maxLen: number): string {
  if (p.length <= maxLen) return p
  return '\u2026' + p.slice(p.length - maxLen + 1)
}

/**
 * Truncate text from the right if it exceeds maxLen.
 */
function truncateRight(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 1) + '\u2026'
}

/** Format token counts for compact display. */
function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`
  return String(count)
}

export function StatusBar({ sessions, activeSession }: StatusBarProps) {
  const uiStatus = useMemo(
    () => (activeSession ? mapStatusToUI(activeSession.status) : null),
    [activeSession]
  )


  const dotStyle = useMemo(() => {
    if (!uiStatus || !uiStatus.dotVisible || !uiStatus.dotColor) return undefined
    return {
      color: `var(${uiStatus.dotColor})`,
      animation: uiStatus.dotAnimation !== 'none' ? `${uiStatus.dotAnimation} 2s ease-in-out infinite` : undefined
    }
  }, [uiStatus])

  // Group sessions by dot color for the session counter
  const sessionGroups = useMemo(() => {
    const groups: { color: string; cssVar: string; count: number }[] = []
    const counts = new Map<string, number>()

    for (const s of sessions) {
      const ui = mapStatusToUI(s.status)
      const key = ui.dotVisible && ui.dotColor ? ui.dotColor : 'none'
      counts.set(key, (counts.get(key) || 0) + 1)
    }

    // Order: running (pink), idle (yellow), error (green), shell (no dot)
    const order = ['--running', '--idle', '--error', 'none'] as const
    for (const key of order) {
      const count = counts.get(key)
      if (count) {
        groups.push({
          color: key,
          cssVar: key === 'none' ? 'var(--text-muted)' : `var(${key})`,
          count
        })
      }
    }
    return groups
  }, [sessions])

  const agentLabel = activeSession
    ? AGENT_LABELS[activeSession.agentType] ?? activeSession.agentType
    : 'No Session'

  const lastActivity = activeSession
    ? truncateRight(activeSession.lastActivity || '', 40)
    : ''

  const cwdPath = activeSession
    ? truncatePathLeft(activeSession.folderPath || '', 50)
    : ''

  return (
    <div
      className="h-6 min-h-6 flex items-center px-3 text-xs border-t border-[var(--bg-hover)]"
      style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
    >
      {/* Left section: session counts grouped by status color */}
      <div className="flex items-center gap-1.5 shrink-0">
        {sessionGroups.map((g, i) => (
          <span key={g.color} className="flex items-center gap-0.5">
            {i > 0 && <span className="mr-0.5" style={{ color: 'var(--text-muted)' }}>,</span>}
            <span style={{ color: g.cssVar }}>{g.color === 'none' ? '\u25CB' : '\u25CF'}</span>
            <span>{g.count}</span>
          </span>
        ))}
      </div>

      <span className="mx-2" style={{ color: 'var(--text-muted)' }}>{'\u2502'}</span>

      {/* Center section: agent type + last activity */}
      <div className="flex items-center gap-2 min-w-0 flex-shrink">
        <span style={{ color: 'var(--text-primary)' }}>{agentLabel}</span>
        {lastActivity && (
          <>
            <span style={{ color: 'var(--text-muted)' }}>{'\u2014'}</span>
            <span className="truncate" style={{ color: 'var(--text-muted)' }}>
              {lastActivity}
            </span>
          </>
        )}
      </div>

      {/* Spacer */}
      <span className="flex-1" />

      {/* Right section: Metrics (SDK) + VS Code button + CWD + keyboard hint */}
      <div className="flex items-center gap-2 shrink-0">
        {activeSession?.kind === 'copilot-sdk' && activeSession?.metrics && (
          <>
            <span style={{ color: 'var(--text-muted)' }} title="Token usage (input / output)">
              {formatTokens(activeSession.metrics.inputTokens)}/{formatTokens(activeSession.metrics.outputTokens)}
            </span>
            {activeSession.metrics.cost > 0 && (
              <span style={{ color: 'var(--text-muted)' }} title="Estimated cost">
                ${activeSession.metrics.cost.toFixed(4)}
              </span>
            )}
            <span className="mx-0.5" style={{ color: 'var(--text-muted)' }}>{'\u2502'}</span>
          </>
        )}
        {activeSession?.folderPath && (
          <button
            onClick={() => (window as any).tangentAPI.shell.openInVSCode(activeSession.folderPath)}
            className="px-1.5 py-0 rounded hover:bg-[var(--bg-hover)] transition-colors"
            style={{ color: 'var(--text-muted)' }}
            title={`Open ${activeSession.folderPath} in VS Code Insiders`}
          >
            VS Code Insiders
          </button>
        )}
        {cwdPath && (
          <button
            onClick={() => activeSession?.folderPath && (window as any).tangentAPI.shell.openInExplorer(activeSession.folderPath)}
            className="max-w-[200px] truncate hover:underline cursor-pointer"
            style={{ color: 'var(--text-muted)', background: 'none', border: 'none', padding: 0, font: 'inherit' }}
            title={`Open ${activeSession?.folderPath} in Explorer`}
          >
            {cwdPath}
          </button>
        )}
        <span className="mx-1" style={{ color: 'var(--text-muted)' }}>{'\u2502'}</span>
        <span style={{ color: 'var(--text-muted)' }}>Ctrl+B panels</span>
      </div>
    </div>
  )
}
