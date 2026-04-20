import { useEffect, useState } from 'react'

export interface SyncLogEntry {
  timestamp: number
  direction: 'outbound' | 'inbound'
  fileCount: number
  byteCount: number
  duration: number
  success: boolean
  error?: string
}

interface SyncLogModalProps {
  devBoxName: string
  onClose: () => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  
  const timeStr = date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
  
  if (isToday) return timeStr
  
  const dateStr = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  })
  
  return `${dateStr} ${timeStr}`
}

export function SyncLogModal({ devBoxName, onClose }: SyncLogModalProps) {
  const [syncLogs, setSyncLogs] = useState<SyncLogEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Fetch sync history
    const fetchLogs = async () => {
      try {
        // TODO: Wire up to actual IPC handler when available
        // const logs = await window.tangentAPI.devbox.getSyncHistory(devBoxName)
        
        // Mock data for now (will be replaced with real IPC call)
        const mockLogs: SyncLogEntry[] = [
          {
            timestamp: Date.now() - 120000,
            direction: 'outbound',
            fileCount: 42,
            byteCount: 1024 * 512,
            duration: 2340,
            success: true
          },
          {
            timestamp: Date.now() - 300000,
            direction: 'inbound',
            fileCount: 18,
            byteCount: 1024 * 256,
            duration: 1200,
            success: true
          },
          {
            timestamp: Date.now() - 600000,
            direction: 'outbound',
            fileCount: 25,
            byteCount: 1024 * 1024 * 2,
            duration: 4500,
            success: true
          }
        ]
        
        setSyncLogs(mockLogs)
      } catch (error) {
        console.error('[SyncLogModal] Failed to fetch sync history:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchLogs()
  }, [devBoxName])

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(0, 0, 0, 0.75)' }}
      onClick={onClose}
    >
      <div
        className="rounded-lg shadow-xl border border-[var(--bg-hover)] max-w-2xl w-full max-h-[80vh] overflow-hidden"
        style={{ background: 'var(--bg-primary)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="px-6 py-4 border-b border-[var(--bg-hover)] flex items-center justify-between"
          style={{ background: 'var(--bg-secondary)' }}
        >
          <div>
            <h2
              className="text-lg font-semibold"
              style={{ color: 'var(--text-primary)' }}
            >
              Sync History
            </h2>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {devBoxName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-2xl leading-none hover:opacity-70 transition-opacity"
            style={{ color: 'var(--text-muted)' }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto" style={{ maxHeight: 'calc(80vh - 80px)' }}>
          {loading ? (
            <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>
              Loading sync history...
            </div>
          ) : syncLogs.length === 0 ? (
            <div className="p-8 text-center">
              <p style={{ color: 'var(--text-muted)' }}>No sync operations yet</p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--bg-hover)]">
              {syncLogs.map((log, index) => (
                <div
                  key={index}
                  className="px-6 py-4 hover:bg-[var(--bg-hover)] transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    {/* Left: Direction indicator + stats */}
                    <div className="flex items-start gap-3 flex-1">
                      <div
                        className="flex items-center justify-center w-8 h-8 rounded shrink-0 mt-0.5"
                        style={{
                          background: log.direction === 'outbound' 
                            ? 'rgba(79, 192, 141, 0.15)' 
                            : 'rgba(88, 166, 255, 0.15)',
                          color: log.direction === 'outbound'
                            ? 'var(--running)'
                            : 'var(--accent)'
                        }}
                      >
                        <span className="text-lg">
                          {log.direction === 'outbound' ? '⬆' : '⬇'}
                        </span>
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span
                            className="font-medium"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            {log.direction === 'outbound' ? 'Outbound' : 'Inbound'}
                          </span>
                          <span
                            className="text-sm"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            {formatTimestamp(log.timestamp)}
                          </span>
                        </div>
                        
                        <div
                          className="text-sm mt-1 flex items-center gap-3 flex-wrap"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          <span>{log.fileCount} files</span>
                          <span>•</span>
                          <span>{formatBytes(log.byteCount)}</span>
                          <span>•</span>
                          <span>{formatDuration(log.duration)}</span>
                        </div>

                        {log.error && (
                          <div
                            className="text-sm mt-2 px-2 py-1 rounded"
                            style={{
                              background: 'rgba(248, 81, 73, 0.1)',
                              color: 'var(--error)'
                            }}
                          >
                            {log.error}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right: Status badge */}
                    <div
                      className="px-2 py-1 rounded text-xs font-medium shrink-0"
                      style={{
                        background: log.success
                          ? 'rgba(79, 192, 141, 0.15)'
                          : 'rgba(248, 81, 73, 0.15)',
                        color: log.success ? 'var(--running)' : 'var(--error)'
                      }}
                    >
                      {log.success ? '✓ Success' : '✗ Failed'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-6 py-3 border-t border-[var(--bg-hover)] text-xs text-right"
          style={{ 
            background: 'var(--bg-secondary)',
            color: 'var(--text-muted)' 
          }}
        >
          Showing last {syncLogs.length} operations
        </div>
      </div>
    </div>
  )
}
