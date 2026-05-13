import { useEffect, useMemo, useState } from 'react'
import type { Session, TaskOutcome } from '@shared/types'
import { usePromptHistory, filterByStatus } from '@/hooks/usePromptHistory'
import { PromptCard } from './PromptCard'

interface PromptHistoryModalProps {
  open: boolean
  onClose: () => void
  activeSession: Session | undefined
}

type FilterOption = TaskOutcome | 'all' | 'issues'

const FILTER_LABELS: Record<FilterOption, string> = {
  all: 'All',
  'in-progress': 'Running',
  success: 'Success',
  partial: 'Partial',
  error: 'Error',
  interrupted: 'Interrupted',
  issues: 'Issues',
}

export function PromptHistoryModal({ open, onClose, activeSession }: PromptHistoryModalProps) {
  const [statusFilter, setStatusFilter] = useState<FilterOption>('all')

  const { items, loading, hasMore, loadMore, refresh } = usePromptHistory({
    sessionId: activeSession?.id,
    enabled: open && !!activeSession?.id,
    limit: 50,
  })

  const filteredItems = useMemo(() => {
    if (statusFilter === 'issues') {
      return items.filter((item) => item.status === 'error' || item.status === 'interrupted' || item.status === 'partial')
    }
    return filterByStatus(items, statusFilter)
  }, [items, statusFilter])

  useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  useEffect(() => {
    if (!open) {
      setStatusFilter('all')
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0, 0, 0, 0.7)' }}
      onClick={onClose}
    >
      <div
        className="rounded-lg shadow-xl border border-[var(--bg-hover)] flex flex-col"
        style={{
          background: 'var(--bg-primary)',
          width: '75vw',
          height: '75vh',
          maxWidth: '1200px',
          maxHeight: '800px',
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="history-modal-title"
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b border-[var(--bg-hover)] shrink-0"
          style={{ background: 'var(--bg-secondary)' }}
        >
          <h2
            id="history-modal-title"
            className="text-lg font-semibold"
            style={{ color: 'var(--text-primary)' }}
          >
            History — {activeSession?.name || 'Unknown Session'}
          </h2>
          <div className="flex items-center gap-3">
            <button
              onClick={refresh}
              disabled={loading}
              className="px-2 py-1 text-xs rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--bg-hover)]"
              style={{
                background: 'var(--bg-tertiary)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--bg-hover)',
              }}
              aria-label="Refresh history"
              title="Refresh the current session history"
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
            <button
              onClick={onClose}
              className="cursor-pointer hover:text-[var(--text-primary)]"
              style={{
                color: 'var(--text-secondary)',
                background: 'none',
                border: 'none',
                fontSize: '20px',
                padding: 0,
                lineHeight: 1,
              }}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Filters */}
        <div
          className="flex items-center gap-2 px-4 py-2 border-b border-[var(--bg-hover)] shrink-0"
          style={{ background: 'var(--bg-secondary)' }}
        >
          {(['all', 'in-progress', 'success', 'issues'] as FilterOption[]).map((filter) => (
            <button
              key={filter}
              onClick={() => setStatusFilter(filter)}
              className="px-3 py-1 text-sm rounded cursor-pointer"
              style={{
                background: statusFilter === filter ? 'var(--bg-hover)' : 'transparent',
                color: statusFilter === filter ? 'var(--text-primary)' : 'var(--text-secondary)',
                border: 'none',
              }}
            >
              {FILTER_LABELS[filter]}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
          {loading && items.length === 0 && (
            <div
              className="flex items-center justify-center h-full"
              style={{ color: 'var(--text-muted)' }}
            >
              Loading...
            </div>
          )}
          {!loading && items.length === 0 && (
            <div
              className="flex flex-col items-center justify-center h-full gap-2"
              style={{ color: 'var(--text-muted)' }}
            >
              <div className="text-4xl">📜</div>
              <div className="text-sm">No history yet for this session</div>
            </div>
          )}
          {filteredItems.length === 0 && items.length > 0 && (
            <div
              className="flex flex-col items-center justify-center h-full gap-2"
              style={{ color: 'var(--text-muted)' }}
            >
              <div className="text-sm">No items match this filter</div>
            </div>
          )}
          {filteredItems.map((item) => (
            <PromptCard key={item.id} item={item} />
          ))}
          {hasMore && (
            <div className="flex justify-center mt-4">
              <button
                onClick={loadMore}
                disabled={loading}
                className="px-4 py-2 text-sm rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--bg-hover)]"
                style={{
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--bg-hover)',
                }}
              >
                {loading ? 'Loading...' : 'Load More'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
