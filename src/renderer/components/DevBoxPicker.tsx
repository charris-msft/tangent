import { useEffect, useState, useCallback } from 'react'
import type { DevBoxResource } from '@shared/devbox-types'

interface DevBoxPickerProps {
  open: boolean
  onSelect: (devBox: { name: string; projectName: string }) => void
  onCancel: () => void
}

const STATE_BADGES: Record<string, { label: string; color: string; icon: string }> = {
  Running: { label: 'Running', color: 'var(--running)', icon: '🟢' },
  Starting: { label: 'Starting', color: 'var(--idle)', icon: '🟡' },
  Stopping: { label: 'Stopping', color: 'var(--idle)', icon: '🟡' },
  Stopped: { label: 'Stopped', color: 'var(--error)', icon: '🔴' },
  Creating: { label: 'Creating', color: 'var(--idle)', icon: '🟡' },
  Failed: { label: 'Failed', color: 'var(--error)', icon: '🔴' },
  Deleting: { label: 'Deleting', color: 'var(--text-muted)', icon: '⚫' },
  Deleted: { label: 'Deleted', color: 'var(--text-muted)', icon: '⚫' }
}

export function DevBoxPicker({ open, onSelect, onCancel }: DevBoxPickerProps) {
  const [devBoxes, setDevBoxes] = useState<DevBoxResource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setSelectedId(null)
      return
    }

    setLoading(true)
    setError(null)
    setDevBoxes([])

    window.tangentAPI.devbox
      .list()
      .then((boxes: DevBoxResource[]) => {
        setDevBoxes(boxes)
        setLoading(false)
      })
      .catch((err: Error) => {
        setError(err.message || 'Failed to fetch Dev Boxes')
        setLoading(false)
      })
  }, [open])

  const handleSelect = useCallback(() => {
    if (!selectedId) return
    const devBox = devBoxes.find(db => db.id === selectedId)
    if (devBox) {
      onSelect({ name: devBox.name, projectName: devBox.projectName })
    }
  }, [selectedId, devBoxes, onSelect])

  const handleRetry = useCallback(() => {
    setLoading(true)
    setError(null)
    window.tangentAPI.devbox
      .list()
      .then((boxes: DevBoxResource[]) => {
        setDevBoxes(boxes)
        setLoading(false)
      })
      .catch((err: Error) => {
        setError(err.message || 'Failed to fetch Dev Boxes')
        setLoading(false)
      })
  }, [])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        className="rounded-lg p-5 shadow-xl max-w-2xl w-full mx-4"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--bg-hover)' }}
      >
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
          Select a Dev Box
        </h3>

        {loading && (
          <div className="py-8 text-center">
            <div className="animate-pulse-slow" style={{ color: 'var(--text-secondary)' }}>
              Loading Dev Boxes...
            </div>
          </div>
        )}

        {error && (
          <div className="py-6">
            <p className="text-xs mb-3" style={{ color: 'var(--error)' }}>
              {error}
            </p>
            <button
              onClick={handleRetry}
              className="px-3 py-1.5 text-xs rounded font-medium"
              style={{
                background: 'var(--accent)',
                color: '#fff',
                border: 'none'
              }}
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && devBoxes.length === 0 && (
          <div className="py-8 text-center">
            <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
              Dev Box not configured. Create{' '}
              <code className="px-1 py-0.5 rounded" style={{ background: 'var(--bg-hover)', fontSize: '0.7rem' }}>
                ~/.tangent/devbox-config.json
              </code>{' '}
              with your Dev Center endpoint and project name.
            </p>
            <a
              href="https://portal.azure.com/#view/Microsoft_Azure_DevCenter/DevBoxesMenuBlade/~/devBoxes"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs underline"
              style={{ color: 'var(--accent)' }}
            >
              Open Azure Portal to find your Dev Center
            </a>
          </div>
        )}

        {!loading && !error && devBoxes.length > 0 && (
          <div
            className="max-h-96 overflow-y-auto mb-4"
            style={{ borderRadius: '6px' }}
          >
            {devBoxes.map(devBox => {
              const badge = STATE_BADGES[devBox.state] || { label: 'Unknown', color: 'var(--text-muted)', icon: '⚫' }
              const isSelected = selectedId === devBox.id

              return (
                <button
                  key={devBox.id}
                  onClick={() => setSelectedId(devBox.id)}
                  className="w-full p-3 mb-1.5 rounded text-left transition-colors"
                  style={{
                    background: isSelected ? 'var(--bg-active)' : 'var(--bg-hover)',
                    border: isSelected ? '1px solid var(--accent)' : '1px solid transparent',
                    cursor: 'pointer'
                  }}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {devBox.name}
                        </span>
                        <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded" style={{ color: badge.color }}>
                          {badge.icon} {badge.label}
                        </span>
                      </div>
                      <div className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                        Project: {devBox.projectName}
                      </div>
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {devBox.location} • {devBox.osType}
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded"
            style={{
              background: 'var(--bg-hover)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--bg-hover)'
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSelect}
            disabled={!selectedId}
            className="px-3 py-1.5 text-xs rounded font-medium"
            style={{
              background: selectedId ? 'var(--running)' : 'var(--bg-hover)',
              color: selectedId ? '#fff' : 'var(--text-muted)',
              border: 'none',
              cursor: selectedId ? 'pointer' : 'not-allowed',
              opacity: selectedId ? 1 : 0.5
            }}
          >
            Select
          </button>
        </div>
      </div>
    </div>
  )
}
