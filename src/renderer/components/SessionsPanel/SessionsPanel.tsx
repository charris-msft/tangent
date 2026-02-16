import { useState, useCallback, useMemo, useRef } from 'react'
import type { Session } from '@shared/types'
import { SessionItem } from './SessionItem'
import { SessionFilter } from './SessionFilter'

interface SessionsPanelProps {
  sessions: Session[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onCreate: () => void
  onRename: (id: string, name: string) => void
  width: number
  onWidthChange: (w: number) => void
  onCollapse: () => void
}

const MIN_WIDTH = 140
const MAX_WIDTH = 500

const RECENT_THRESHOLD_MS = 48 * 60 * 60 * 1000 // 48 hours

export function SessionsPanel({ sessions, activeId, onSelect, onClose, onCreate, onRename, width, onWidthChange, onCollapse }: SessionsPanelProps) {
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1)
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterValue, setFilterValue] = useState('')
  const [activeCollapsed, setActiveCollapsed] = useState(false)
  const [recentCollapsed, setRecentCollapsed] = useState(false)
  const [showOlder, setShowOlder] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef({ x: 0, startWidth: 0 })

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    dragStartRef.current = { x: e.clientX, startWidth: width }

    const handleMove = (ev: MouseEvent) => {
      const delta = ev.clientX - dragStartRef.current.x
      const newWidth = dragStartRef.current.startWidth + delta
      if (newWidth < MIN_WIDTH / 2) {
        onCollapse()
        cleanup()
        return
      }
      onWidthChange(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth)))
    }
    const handleUp = () => cleanup()
    const cleanup = () => {
      setIsDragging(false)
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
  }, [width, onWidthChange, onCollapse])

  // Filter sessions
  const filteredSessions = useMemo(() => {
    if (!filterValue.trim()) return sessions
    const query = filterValue.toLowerCase()
    return sessions.filter(s =>
      s.name.toLowerCase().includes(query) ||
      s.folderName.toLowerCase().includes(query)
    )
  }, [sessions, filterValue])

  // Split into active vs recent vs older
  const now = Date.now()
  const activeSessions = useMemo(
    () => filteredSessions.filter(s => s.status !== 'exited'),
    [filteredSessions]
  )

  const recentSessions = useMemo(
    () => filteredSessions.filter(s => s.status === 'exited' && (now - s.updatedAt) <= RECENT_THRESHOLD_MS),
    [filteredSessions, now]
  )

  const olderSessions = useMemo(
    () => filteredSessions.filter(s => s.status === 'exited' && (now - s.updatedAt) > RECENT_THRESHOLD_MS),
    [filteredSessions, now]
  )

  // Flat list of visible sessions for keyboard navigation
  const visibleSessions = useMemo(() => {
    const list: Session[] = []
    if (!activeCollapsed) list.push(...activeSessions)
    if (!recentCollapsed) list.push(...recentSessions)
    if (showOlder) list.push(...olderSessions)
    return list
  }, [activeSessions, recentSessions, olderSessions, activeCollapsed, recentCollapsed, showOlder])

  const handleRename = useCallback((id: string, name: string) => {
    onRename(id, name)
    setRenamingId(null)
  }, [onRename])

  const handleRenameCancel = useCallback(() => {
    setRenamingId(null)
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    // Don't intercept when filter input or rename input is focused
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT') return

    switch (e.key) {
      case 'j':
      case 'ArrowDown': {
        e.preventDefault()
        setHighlightedIndex(prev => {
          const next = prev + 1
          return next >= visibleSessions.length ? visibleSessions.length - 1 : next
        })
        break
      }
      case 'k':
      case 'ArrowUp': {
        e.preventDefault()
        setHighlightedIndex(prev => {
          const next = prev - 1
          return next < 0 ? 0 : next
        })
        break
      }
      case 'Enter': {
        e.preventDefault()
        if (highlightedIndex >= 0 && highlightedIndex < visibleSessions.length) {
          onSelect(visibleSessions[highlightedIndex].id)
        }
        break
      }
      case 'x':
      case 'Delete': {
        e.preventDefault()
        if (highlightedIndex >= 0 && highlightedIndex < visibleSessions.length) {
          const session = visibleSessions[highlightedIndex]
          if (!session.isExternal) {
            onClose(session.id)
          }
        }
        break
      }
      case 'F2': {
        e.preventDefault()
        if (highlightedIndex >= 0 && highlightedIndex < visibleSessions.length) {
          setRenamingId(visibleSessions[highlightedIndex].id)
        }
        break
      }
      case '/': {
        e.preventDefault()
        setFilterOpen(true)
        break
      }
      case 'Escape': {
        e.preventDefault()
        if (filterOpen) {
          setFilterOpen(false)
          setFilterValue('')
        } else {
          panelRef.current?.blur()
        }
        break
      }
    }
  }, [visibleSessions, highlightedIndex, filterOpen, onSelect, onClose])

  const renderSection = (
    title: string,
    items: Session[],
    collapsed: boolean,
    onToggle: () => void
  ) => (
    <div className="mb-1">
      <button
        onClick={onToggle}
        className="flex items-center gap-1 w-full px-3 py-1.5 text-xs uppercase tracking-wider hover:bg-[var(--bg-hover)] rounded transition-colors"
        style={{ color: 'var(--text-muted)' }}
      >
        <span className="text-[10px]">{collapsed ? '\u25B6' : '\u25BC'}</span>
        <span>{title}</span>
        <span className="ml-auto">{items.length}</span>
      </button>
      {!collapsed && items.map(session => {
        const flatIndex = visibleSessions.indexOf(session)
        return (
          <SessionItem
            key={session.id}
            session={session}
            isActive={session.id === activeId}
            isHighlighted={flatIndex === highlightedIndex}
            isRenaming={session.id === renamingId}
            onSelect={() => onSelect(session.id)}
            onClose={() => onClose(session.id)}
            onRename={(name) => handleRename(session.id, name)}
            onRenameCancel={handleRenameCancel}
          />
        )
      })}
    </div>
  )

  return (
    <div className="flex h-full shrink-0" style={{ width: `${width}px` }}>
    <div
      ref={panelRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="flex-1 min-w-0 h-full flex flex-col outline-none"
      style={{ background: 'var(--bg-secondary)' }}
    >
      {/* Header */}
      <div className="p-3 text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
        Sessions ({sessions.length})
      </div>

      {/* Filter */}
      {filterOpen && (
        <SessionFilter
          value={filterValue}
          onChange={setFilterValue}
          onClose={() => { setFilterOpen(false); setFilterValue('') }}
        />
      )}

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-2">
        {/* Active section */}
        {renderSection(
          'Active',
          activeSessions,
          activeCollapsed,
          () => setActiveCollapsed(prev => !prev)
        )}

        {/* Recent section */}
        {recentSessions.length > 0 && renderSection(
          'Recent',
          recentSessions,
          recentCollapsed,
          () => setRecentCollapsed(prev => !prev)
        )}

        {/* Show older button */}
        {olderSessions.length > 0 && !showOlder && (
          <button
            onClick={() => setShowOlder(true)}
            className="w-full px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)] rounded transition-colors text-left"
            style={{ color: 'var(--text-muted)' }}
          >
            Show {olderSessions.length} older session{olderSessions.length !== 1 ? 's' : ''}
          </button>
        )}

        {/* Older sessions (when expanded) */}
        {showOlder && olderSessions.length > 0 && renderSection(
          'Older',
          olderSessions,
          false,
          () => setShowOlder(false)
        )}
      </div>

      {/* New session button */}
      <button
        onClick={onCreate}
        className="m-2 p-2 text-sm rounded border border-[var(--bg-hover)] hover:bg-[var(--bg-hover)] transition-colors"
        style={{ color: 'var(--text-secondary)' }}
      >
        + New Session
      </button>
    </div>
    {/* Drag handle */}
    <div
      onMouseDown={handleDragStart}
      className="w-1 h-full shrink-0 hover:bg-[var(--accent)] transition-colors"
      style={{
        cursor: 'col-resize',
        background: isDragging ? 'var(--accent)' : 'var(--bg-hover)'
      }}
    />
    </div>
  )
}
