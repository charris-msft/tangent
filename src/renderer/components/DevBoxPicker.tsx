import { useEffect, useState, useCallback, useRef } from 'react'
import type { DevBoxResource } from '@shared/devbox-types'
import { DEVBOX_API } from '@shared/constants'

/** Check whether an error message indicates a retryable failure (timeout, server error, or network). */
function isRetryableError(message: string): boolean {
  return /timed out|timeout|502|503|504|gateway|fetch failed|network|ECONNRESET/i.test(message)
}

interface RetryStatus {
  attempt: number
  maxAttempts: number
}

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
  const [sshStatus, setSshStatus] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [retryStatus, setRetryStatus] = useState<RetryStatus | null>(null)
  const cancelledRef = useRef(false)

  /** Fetch Dev Boxes with auto-retry on transient errors. */
  const loadDevBoxes = useCallback(async () => {
    setLoading(true)
    setError(null)
    setDevBoxes([])
    setSshStatus({})
    setRetryStatus(null)
    cancelledRef.current = false

    const maxAttempts = DEVBOX_API.MAX_RETRIES

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (cancelledRef.current) return
      try {
        if (attempt > 1) {
          setRetryStatus({ attempt, maxAttempts })
        }

        const boxes: DevBoxResource[] = await window.tangentAPI.devbox.list()
        if (cancelledRef.current) return

        setDevBoxes(boxes)
        setLoading(false)
        setRetryStatus(null)

        // Check SSH config for each Dev Box in parallel
        const statuses: Record<string, boolean> = {}
        await Promise.all(
          boxes.map(async (box) => {
            try {
              statuses[box.name] = await window.tangentAPI.devbox.hasSshConfig(box.name)
            } catch {
              statuses[box.name] = false
            }
          })
        )
        if (!cancelledRef.current) setSshStatus(statuses)
        return
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)

        if (attempt < maxAttempts && isRetryableError(message)) {
          // Wait before next attempt
          await new Promise(r => setTimeout(r, DEVBOX_API.RETRY_DELAY_MS))
          continue
        }

        // Final failure — show error
        if (!cancelledRef.current) {
          setError(message || 'Failed to fetch Dev Boxes')
          setLoading(false)
          setRetryStatus(null)
        }
        return
      }
    }
  }, [])

  useEffect(() => {
    if (!open) {
      setSelectedId(null)
      cancelledRef.current = true
      return
    }
    loadDevBoxes()
    return () => { cancelledRef.current = true }
  }, [open, loadDevBoxes])

  const handleSelect = useCallback(() => {
    if (!selectedId) return
    const devBox = devBoxes.find(db => db.id === selectedId)
    if (devBox) {
      onSelect({ name: devBox.name, projectName: devBox.projectName })
    }
  }, [selectedId, devBoxes, onSelect])

  const handleRetry = useCallback(() => {
    loadDevBoxes()
  }, [loadDevBoxes])

  if (!open) return null

  const selectedDevBox = devBoxes.find(db => db.id === selectedId)
  const selectedHasSsh = selectedDevBox ? sshStatus[selectedDevBox.name] : false

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
              {retryStatus
                ? `Dev Center API timed out. Retrying\u2026 (attempt ${retryStatus.attempt} of ${retryStatus.maxAttempts})`
                : 'Loading Dev Boxes\u2026'}
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
            <button
              onClick={() => window.tangentAPI?.shell?.openExternal?.('https://portal.azure.com/#view/Microsoft_Azure_DevCenter/DevBoxesMenuBlade/~/devBoxes')}
              className="text-xs underline"
              style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              Open Azure Portal to find your Dev Center
            </button>
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
              const hasSsh = sshStatus[devBox.name]

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
                        {hasSsh !== undefined && (
                          <span
                            className="text-xs px-1.5 py-0.5 rounded"
                            style={{ color: hasSsh ? 'var(--running)' : 'var(--idle)' }}
                          >
                            {hasSsh ? '🔗 SSH' : '⚠ No tunnel'}
                          </span>
                        )}
                      </div>
                      <div className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                        Project: {devBox.projectName}
                      </div>
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {devBox.location === 'local-config' ? '📋 From config (API offline)' : `${devBox.location} • ${devBox.osType}`}
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* Tunnel setup warning when selected Dev Box has no SSH */}
        {selectedDevBox && !selectedHasSsh && (
          <div
            className="mb-3 p-3 rounded text-xs"
            style={{ background: 'rgba(227, 179, 65, 0.1)', border: '1px solid var(--idle)' }}
          >
            <p className="font-medium mb-1" style={{ color: 'var(--idle)' }}>
              SSH tunnel not configured for "{selectedDevBox.name}"
            </p>
            <p style={{ color: 'var(--text-secondary)' }}>
              Run the setup script on your Dev Box via RDP, then add the tunnel host to{' '}
              <code style={{ fontSize: '0.65rem' }}>~/.tangent/devbox-config.json</code> under{' '}
              <code style={{ fontSize: '0.65rem' }}>devBoxes.{selectedDevBox.name}.tunnelHost</code>.
            </p>
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
