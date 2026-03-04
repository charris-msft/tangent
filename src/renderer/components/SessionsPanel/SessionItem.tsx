import { useState, useRef, useEffect } from 'react'
import { mapStatusToUI } from '@shared/statusMapping'
import type { Session } from '@shared/types'

interface SessionItemProps {
  session: Session
  isActive: boolean
  isHighlighted: boolean
  isRenaming: boolean
  onSelect: () => void
  onClose: () => void
  onRename: (name: string) => void
  onRenameCancel: () => void
  onCreateAgent?: () => void
}

export function SessionItem({
  session,
  isActive,
  isHighlighted,
  isRenaming,
  onSelect,
  onClose,
  onRename,
  onRenameCancel,
  onCreateAgent
}: SessionItemProps) {
  const ui = mapStatusToUI(session.status)
  const [renameValue, setRenameValue] = useState(session.name)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

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
              {/* External badge */}
              {session.isExternal && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--error)' }}
                >
                  ext
                </span>
              )}
            </>
          )}
        </div>
        {!isRenaming && (
          <div className="text-xs truncate italic" style={{ color: 'var(--text-secondary)' }}>
            {session.agentType !== 'shell' && (!session.lastActivity || session.lastActivity.includes('cmd.exe'))
              ? (session.status === 'processing' || session.status === 'tool_executing' ? 'Thinking...' : 'Waiting...')
              : session.lastActivity || 'idle'}
          </div>
        )}
      </div>

      {/* Close button */}
      {!session.isExternal && !isRenaming && (
        <button
          onClick={(e) => { e.stopPropagation(); if (window.confirm(`Close session "${session.name}"?`)) onClose() }}
          className="opacity-0 group-hover:opacity-100 text-xs px-1 rounded hover:bg-[var(--bg-hover)] shrink-0"
          style={{ color: 'var(--text-muted)' }}
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
          <button
            onClick={() => { setContextMenu(null); if (window.confirm(`Close session "${session.name}"?`)) onClose() }}
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
