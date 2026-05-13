import { useState, useRef, useEffect } from 'react'
import type { Session, RemoteSessionState } from '@shared/types'
import { confirmDialog } from '../ConfirmDialog'
import { getSessionRowStatusText, getSessionRowUI } from './sessionRowState'

interface SessionItemProps {
  session: Session
  isActive: boolean
  isHighlighted: boolean
  isRenaming: boolean
  isPoppedOut?: boolean
  onSelect: () => void
  onClose: () => void
  onRename: (name: string) => void
  onRenameCancel: () => void
  onCreateAgent?: () => void
  onPopOut?: () => void
  onPullBack?: () => void
}

const getRemoteStateIndicator = (state: RemoteSessionState): { emoji: string; color: string; label: string; animated: boolean } => {
  switch (state) {
    case 'starting-devbox':
      return { emoji: '🔵', color: 'var(--accent)', label: 'Starting Dev Box', animated: true }
    case 'tunneling':
      return { emoji: '🔵', color: 'var(--accent)', label: 'Tunneling', animated: true }
    case 'syncing-out':
      return { emoji: '🟡', color: 'var(--idle)', label: 'Syncing workspace out', animated: true }
    case 'syncing-back':
      return { emoji: '🟡', color: 'var(--idle)', label: 'Syncing workspace back', animated: true }
    case 'verifying-acp':
      return { emoji: '🔵', color: 'var(--accent)', label: 'Verifying ACP', animated: true }
    case 'running':
      return { emoji: '🟢', color: 'var(--running)', label: 'Running on Dev Box', animated: false }
    default:
      return { emoji: '⚫', color: 'var(--text-muted)', label: 'Unknown', animated: false }
  }
}

export function SessionItem({
  session,
  isActive,
  isHighlighted,
  isRenaming,
  isPoppedOut = false,
  onSelect,
  onClose,
  onRename,
  onRenameCancel,
  onCreateAgent,
  onPopOut,
  onPullBack
}: SessionItemProps) {
  const ui = getSessionRowUI(session)
  const [renameValue, setRenameValue] = useState(session.name)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [showTooltip, setShowTooltip] = useState(false)
  const tooltipTimeoutRef = useRef<ReturnType<typeof setTimeout>>()

  const isRemoteSession = session.kind === 'remote-agent'
  const remoteIndicator = isRemoteSession && session.remoteState ? getRemoteStateIndicator(session.remoteState) : null

  const bgStyle = isActive ? ui.bgTintSelected : ui.bgTint
  const borderLeft = ui.barColor ? `3px solid var(${ui.barColor})` : '3px solid transparent'
  const shadow = isActive ? ui.glowShadow : 'none'

  // Determine animation class for the left bar
  const barAnimClass = ui.label === 'error' ? 'animate-pulse-fast' : ''

  useEffect(() => {
    if (isRenaming) {
      setRenameValue(session.name)
      // Focus the input after render
      setTimeout(() => renameInputRef.current?.focus(), 0)
    }
  }, [isRenaming, session.name])

  const handleRenameSubmit = () => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== session.name) {
      onRename(trimmed)
    } else {
      onRenameCancel()
    }
  }

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Enter') {
      handleRenameSubmit()
    } else if (e.key === 'Escape') {
      onRenameCancel()
    }
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  // Close context menu on outside click or scroll
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [contextMenu])

  return (
    <div
      data-testid="session-row"
      data-session-id={session.id}
      data-status={session.status}
      data-agent-type={session.agentType}
      aria-current={isActive ? 'true' : undefined}
      onClick={onSelect}
      onContextMenu={handleContextMenu}
      className={`relative flex items-center gap-2 px-3 py-2 mb-1 rounded cursor-pointer group ${barAnimClass} ${isHighlighted ? 'ring-1 ring-[var(--accent)]' : ''}`}
      style={{
        background: bgStyle,
        borderLeft,
        transition: 'background 400ms ease, border-color 400ms ease',
        boxShadow: shadow
      }}
    >
      {/* Status dot */}
      {ui.dotVisible && (
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${ui.dotAnimation === 'pulse-slow' ? 'animate-pulse-slow' : ui.dotAnimation === 'pulse-fast' ? 'animate-pulse-fast' : ''}`}
          style={{ background: ui.dotColor ? `var(${ui.dotColor})` : undefined }}
        />
      )}

      {/* Session info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {isRenaming ? (
            <input
              ref={renameInputRef}
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={handleRenameKeyDown}
              onBlur={handleRenameSubmit}
              onClick={(e) => e.stopPropagation()}
              className="text-sm font-medium w-full px-1 py-0 rounded border border-[var(--accent)] outline-none"
              style={{
                background: 'var(--bg-tertiary)',
                color: 'var(--text-primary)'
              }}
            />
          ) : (
            <>
              <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                {session.name}
              </span>
              {/* Agent badge */}
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                style={{
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-secondary)'
                }}
              >
                {session.agentType === 'copilot-cli' ? 'copilot' : session.agentType === 'claude-code' ? 'claude' : 'shell'}
              </span>
              {/* Remote badge */}
              {isRemoteSession && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0 relative"
                  style={{
                    background: 'var(--accent)',
                    color: '#fff'
                  }}
                  onMouseEnter={() => {
                    tooltipTimeoutRef.current = setTimeout(() => setShowTooltip(true), 500)
                  }}
                  onMouseLeave={() => {
                    if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current)
                    setShowTooltip(false)
                  }}
                >
                  Remote
                </span>
              )}
              {/* External badge */}
              {session.isExternal && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--error)' }}
                >
                  ext
                </span>
              )}
              {/* Remote state indicator */}
              {remoteIndicator && (
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${remoteIndicator.animated ? 'animate-pulse-slow' : ''}`}
                  style={{
                    background: 'rgba(88, 166, 255, 0.1)',
                    color: remoteIndicator.color
                  }}
                >
                  {remoteIndicator.emoji} {remoteIndicator.label}
                </span>
              )}
            </>
          )}
        </div>
        {!isRenaming && (
          <div className="text-xs truncate italic" style={{ color: 'var(--text-secondary)' }}>
            {isRemoteSession && session.devBoxName ? (
              `Dev Box: ${session.devBoxName}${session.devBoxProject ? ` (${session.devBoxProject})` : ''}`
            ) : session.agentType !== 'shell' ? (
              getSessionRowStatusText(session)
            ) : (
              session.lastActivity || 'idle'
            )}
          </div>
        )}
      </div>

      {/* Remote connection tooltip */}
      {showTooltip && isRemoteSession && (
        <div
          className="absolute z-50 py-2 px-3 rounded shadow-lg border border-[var(--bg-hover)] min-w-[200px]"
          style={{
            background: 'var(--bg-secondary)',
            top: 'calc(100% + 4px)',
            left: '50%',
            transform: 'translateX(-50%)',
            pointerEvents: 'none'
          }}
        >
          <div className="text-xs space-y-1">
            <div style={{ color: 'var(--text-primary)' }}>
              <strong>Remote Connection</strong>
            </div>
            {session.devBoxName && (
              <div style={{ color: 'var(--text-secondary)' }}>
                Dev Box: {session.devBoxName}
              </div>
            )}
            {session.devBoxProject && (
              <div style={{ color: 'var(--text-secondary)' }}>
                Project: {session.devBoxProject}
              </div>
            )}
            {session.remoteState && (
              <div style={{ color: remoteIndicator?.color }}>
                Status: {remoteIndicator?.label}
              </div>
            )}
            {session.remoteConnectionId && (
              <div style={{ color: 'var(--text-muted)' }}>
                Connection: {session.remoteConnectionId.substring(0, 8)}...
              </div>
            )}
            {session.lastSyncTime && (
              <div style={{ color: 'var(--text-muted)' }}>
                Last sync: {new Date(session.lastSyncTime).toLocaleTimeString()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Reconnect button for failed remote sessions */}
      {session.kind === 'remote-agent' && session.status === 'failed' && !isRenaming && (
        <button
          onClick={async (e) => {
            e.stopPropagation()
            try {
              const result = await (window as any).tangentAPI.session.reconnect(session.id)
              if (result && !result.success) {
                console.warn('Reconnect failed:', result.error)
              }
            } catch (err) {
              console.warn('Reconnect error:', err)
            }
          }}
          className="text-xs px-1 rounded hover:bg-[var(--bg-hover)] shrink-0"
          style={{ color: 'var(--accent)' }}
          title="Reconnect to Dev Box"
          aria-label="Reconnect"
        >
          ↻
        </button>
      )}

      {/* Popout / pull-back button */}
      {!session.isExternal && !isRenaming && (onPopOut || onPullBack) && (
        <button
          onClick={async (e) => {
            e.stopPropagation()
            if (isPoppedOut && onPullBack) onPullBack()
            else if (!isPoppedOut && onPopOut) onPopOut()
          }}
          className="opacity-0 group-hover:opacity-100 text-xs px-1 rounded hover:bg-[var(--bg-hover)] shrink-0"
          style={{ color: 'var(--text-muted)' }}
          title={isPoppedOut ? 'Pull session back into main window' : 'Pop session out to its own window'}
          aria-label={isPoppedOut ? 'Pull back' : 'Pop out'}
        >
          {isPoppedOut ? '⬒' : '⬈'}
        </button>
      )}

      {/* Close button */}
      {!session.isExternal && !isRenaming && (
        <button
          onClick={async (e) => {
            e.stopPropagation()
            const ok = await confirmDialog(`Close session "${session.name}"?`, { confirmLabel: 'Close' })
            if (ok) onClose()
          }}
          className="opacity-0 group-hover:opacity-100 text-xs px-1 rounded hover:bg-[var(--bg-hover)] shrink-0"
          style={{ color: 'var(--text-muted)' }}
          title="Close session"
          aria-label="Close session"
        >
          ×
        </button>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 py-1 rounded shadow-lg border border-[var(--bg-hover)] min-w-[180px]"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
            background: 'var(--bg-secondary)',
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {onCreateAgent && (
            <button
              onClick={() => { setContextMenu(null); onCreateAgent() }}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--bg-hover)] transition-colors"
              style={{ color: 'var(--text-primary)' }}
            >
              Save as Agent...
            </button>
          )}
          {onPopOut && !isPoppedOut && (
            <button
              onClick={() => { setContextMenu(null); onPopOut() }}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--bg-hover)] transition-colors"
              style={{ color: 'var(--text-primary)' }}
            >
              Pop Out to Window
            </button>
          )}
          {onPullBack && isPoppedOut && (
            <button
              onClick={() => { setContextMenu(null); onPullBack() }}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--bg-hover)] transition-colors"
              style={{ color: 'var(--text-primary)' }}
            >
              Pull Back to Main Window
            </button>
          )}
          <button
            onClick={async () => {
              setContextMenu(null)
              const ok = await confirmDialog(`Close session "${session.name}"?`, { confirmLabel: 'Close' })
              if (ok) onClose()
            }}
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--bg-hover)] transition-colors"
            style={{ color: 'var(--text-primary)' }}
          >
            Close Session
          </button>
        </div>
      )}
    </div>
  )
}
