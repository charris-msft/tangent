import { useEffect, useMemo, useCallback, useState } from 'react'
import { useSession } from '../hooks/useSession'
import { useGlobalShortcuts } from '../hooks/useGlobalShortcuts'
import { TerminalViewport } from './Terminal/TerminalViewport'
import { mapStatusToUI } from '@shared/statusMapping'
import { ZOOM } from '@shared/constants'
import type { Session, UIStatusIndicator } from '@shared/types'

export interface PopoutWindowShellProps {
  sessionId: string
}

/**
 * Resolve the status color for a session as a concrete CSS color value.
 * Uses the dotColor CSS var from mapStatusToUI when available, otherwise
 * falls back per-status:
 *   - shell_ready: subtle accent (no agent yet, but window is alive)
 *   - exited:      muted gray (clearly "dead")
 *   - default:     theme border
 * The literal hex fallbacks inside var(...) ensure we still render a
 * visible border if the CSS var is somehow missing at paint time.
 */
function resolveStatusColor(session: Session, ui: UIStatusIndicator): string {
  if (ui.dotColor) {
    return `var(${ui.dotColor}, #58a6ff)`
  }
  if (session.status === 'exited') {
    return 'var(--text-muted, #484f58)'
  }
  if (session.status === 'shell_ready') {
    // Soft accent — present but unobtrusive when no agent is running.
    return 'color-mix(in srgb, var(--accent, #58a6ff) 35%, transparent)'
  }
  return 'var(--text-muted, #484f58)'
}

interface StatusBorderStyle {
  containerStyle: React.CSSProperties
  pulseClass: string
}

/**
 * Centralized border styling for the popout window.
 *
 *   - Local sessions: 2px solid border in the status color.
 *   - Remote sessions: 4px double border (needs ≥3px to render two lines)
 *     plus an inset glow. We use inset rather than an outer box-shadow so
 *     the OS window frame never clips it.
 *   - Attention/error UI states pulse the inset glow (only when the status
 *     warrants user attention — local solid borders pulse too, but never
 *     gain the double-line treatment).
 */
function getStatusBorderStyle(session: Session, ui: UIStatusIndicator): StatusBorderStyle {
  const statusColor = resolveStatusColor(session, ui)
  const isRemote = session.kind === 'remote-agent'
  const isAttention = ui.label === 'attention' || ui.label === 'error'

  const softGlow = `color-mix(in srgb, ${statusColor} 35%, transparent)`

  const base: React.CSSProperties = isRemote
    ? {
        border: `4px double ${statusColor}`,
        boxShadow: `inset 0 0 12px ${softGlow}`
      }
    : {
        border: `2px solid ${statusColor}`,
        boxShadow: 'none'
      }

  // Pulse keyframes read --pulse-color from the element's inline style.
  if (isAttention) {
    ;(base as Record<string, string>)['--pulse-color'] =
      `color-mix(in srgb, ${statusColor} 55%, transparent)`
  }

  return {
    containerStyle: base,
    pulseClass: isAttention ? 'popout-border-pulse' : ''
  }
}

export function PopoutWindowShell({ sessionId }: PopoutWindowShellProps) {
  const session = useSession(sessionId)

  // Mirror the user's configured font size (same source of truth as the main
  // window). Without this the popout would render at a hardcoded size and
  // feel "different" to the user. `fitAddon.fit()` re-computes rows/cols on
  // resize — it does NOT rescale the font, so preserving fontSize across
  // resize gives a stable visual size while the viewport reflows.
  const [fontSize, setFontSize] = useState<number>(ZOOM.DEFAULT)
  useEffect(() => {
    let cancelled = false
    window.tangentAPI.config.get().then((config: any) => {
      if (!cancelled && typeof config?.fontSize === 'number') {
        setFontSize(config.fontSize)
      }
    })
    const unsub = window.tangentAPI.config.onChanged((config: any) => {
      if (typeof config?.fontSize === 'number') setFontSize(config.fontSize)
    })
    return () => {
      cancelled = true
      unsub?.()
    }
  }, [])

  const sessionName = session?.name || session?.folderName || `Session ${sessionId.slice(0, 8)}`

  // Reactive document title
  useEffect(() => {
    const isRemote = session?.kind === 'remote-agent'
    const suffix = isRemote && session?.devBoxName ? ` (Remote: ${session.devBoxName})` : ''
    document.title = `Tangent — ${sessionName}${suffix}`
  }, [sessionName, session?.kind, session?.devBoxName])

  // Status → UI color
  const ui = useMemo(() => (session ? mapStatusToUI(session.status) : null), [session?.status])
  const statusVar = ui?.dotColor ?? null

  const isRemote = session?.kind === 'remote-agent'
  const isExited = session?.status === 'exited'

  const { containerStyle: borderStyle, pulseClass } = useMemo(() => {
    if (!session || !ui) {
      return { containerStyle: { border: '2px solid var(--border, #30363d)' }, pulseClass: '' }
    }
    return getStatusBorderStyle(session, ui)
  }, [session?.status, session?.kind, ui])

  const handlePullBack = useCallback(() => {
    const winApi = (window.tangentAPI as any).window
    winApi?.pullBack?.(sessionId)
  }, [sessionId])

  const handleCollapseAll = useCallback(() => {
    const winApi = (window.tangentAPI as any).window
    winApi?.collapseAll?.()
  }, [])

  // Global shortcuts in the popout window:
  //   Ctrl+Shift+P → no-op (this session is already popped out)
  //   Ctrl+Shift+E → no-op (explode dialog only makes sense in main window)
  //   Ctrl+Shift+C → collapse all popped windows back into main
  useGlobalShortcuts({
    onCollapseAll: handleCollapseAll
  })

  // Loading state
  if (!session) {
    return (
      <div
        className="h-screen w-screen flex items-center justify-center"
        style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
      >
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
          />
          <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Loading session…
          </div>
        </div>
      </div>
    )
  }

  // The TerminalViewport mounts an xterm for every session it's given, and
  // shows the one matching activeId. In the popout we hand it the single
  // session for this window.
  const sessionForViewport = [{
    id: session.id,
    kind: session.kind,
    name: session.name,
    folderName: session.folderName,
    folderPath: session.folderPath
  }]

  return (
    <div
      className={`h-screen w-screen flex flex-col overflow-hidden ${pulseClass}`}
      style={{
        background: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        ...borderStyle,
        transition: 'border-color 200ms ease, box-shadow 200ms ease'
      }}
    >
      {/* Toolbar */}
      <div
        className="flex items-center gap-3 px-3 h-10 shrink-0 select-none"
        style={{
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border, #30363d)',
          WebkitAppRegion: 'drag'
        } as React.CSSProperties}
      >
        {/* Status dot + name */}
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={
              ui?.dotAnimation === 'pulse-fast'
                ? 'animate-pulse-fast'
                : ui?.dotAnimation === 'pulse-slow'
                ? 'animate-pulse-slow'
                : ''
            }
            style={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: statusVar ? `var(${statusVar})` : 'var(--text-muted)',
              flexShrink: 0,
              boxShadow: statusVar ? `0 0 6px var(${statusVar})` : 'none'
            }}
            title={ui?.label ?? 'shell'}
          />
          <span className="text-sm font-medium truncate" title={sessionName}>
            {sessionName}
          </span>
        </div>

        {/* Remote badge */}
        {isRemote && session.devBoxName && (
          <div
            className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs"
            style={{
              background: 'var(--bg-tertiary)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border, #30363d)'
            }}
            title={`Remote dev box: ${session.devBoxName}`}
          >
            <span>🖥️</span>
            <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
              Remote: {session.devBoxName}
            </span>
          </div>
        )}

        {/* Right-side actions */}
        <div
          className="ml-auto flex items-center gap-2"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            onClick={handlePullBack}
            className="px-2.5 py-1 text-xs rounded transition-colors hover:opacity-90"
            style={{
              background: 'var(--accent)',
              color: '#fff',
              border: '1px solid var(--accent)'
            }}
            title="Move this session back into the main Tangent window"
          >
            Pull Back
          </button>
          <button
            onClick={handleCollapseAll}
            className="px-2.5 py-1 text-xs rounded transition-colors hover:opacity-90"
            style={{
              background: 'transparent',
              color: 'var(--text-primary)',
              border: '1px solid var(--border, #30363d)'
            }}
            title="Collapse all popped-out sessions back into the main window"
          >
            Collapse All
          </button>
        </div>
      </div>

      {/* Body: terminal or exited message */}
      <div className="flex-1 min-h-0 relative">
        {isExited ? (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-4"
            style={{ background: 'var(--bg-primary)' }}
          >
            <div className="text-5xl opacity-60">⏻</div>
            <div className="text-lg font-medium">Session ended</div>
            <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              You can close this window, or pull the (closed) session back into Tangent.
            </div>
            <div className="flex gap-2 mt-2">
              <button
                onClick={handlePullBack}
                className="px-3 py-1.5 text-sm rounded"
                style={{ background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)' }}
              >
                Pull Back
              </button>
              <button
                onClick={() => window.close()}
                className="px-3 py-1.5 text-sm rounded"
                style={{
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border, #30363d)'
                }}
              >
                Close Window
              </button>
            </div>
          </div>
        ) : (
          <TerminalViewport
            sessions={sessionForViewport}
            activeId={sessionId}
            fontSize={fontSize}
          />
        )}
      </div>
    </div>
  )
}
