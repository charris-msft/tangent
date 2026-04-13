import { useEffect, useState, useCallback } from 'react'

interface ConflictingFile {
  path: string
  hasUncommittedChanges: boolean
}

interface SyncConflictEvent {
  files: ConflictingFile[]
  localPath: string
  remotePath: string
}

interface SyncConflictDialogProps {
  sessionId: string | null
}

export function SyncConflictDialog({ sessionId }: SyncConflictDialogProps) {
  const [conflict, setConflict] = useState<SyncConflictEvent | null>(null)

  useEffect(() => {
    if (!sessionId) return

    // Listen for sync:conflict events
    const unsub = window.tangentAPI.devbox?.onSyncConflict?.((event: SyncConflictEvent) => {
      setConflict(event)
    })

    return () => unsub?.()
  }, [sessionId])

  const handleKeepLocal = useCallback(() => {
    if (conflict) {
      window.tangentAPI.devbox?.resolveSyncConflict?.('keep-local')
    }
    setConflict(null)
  }, [conflict])

  const handleUseRemote = useCallback(() => {
    if (conflict) {
      window.tangentAPI.devbox?.resolveSyncConflict?.('use-remote')
    }
    setConflict(null)
  }, [conflict])

  const handleMerge = useCallback(() => {
    if (conflict) {
      window.tangentAPI.devbox?.resolveSyncConflict?.('merge')
    }
    setConflict(null)
  }, [conflict])

  if (!conflict) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        className="rounded-lg p-5 shadow-xl max-w-lg w-full mx-4"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--bg-hover)' }}
      >
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
          Sync Conflict Detected
        </h3>
        <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
          The following files have uncommitted changes and would be overwritten by the remote sync:
        </p>
        <div
          className="mb-4 max-h-48 overflow-y-auto rounded p-2 text-xs"
          style={{ background: 'var(--bg-primary)', border: '1px solid var(--bg-hover)' }}
        >
          <ul className="space-y-1">
            {conflict.files.map((file) => (
              <li
                key={file.path}
                className="font-mono"
                style={{ color: 'var(--text-secondary)' }}
              >
                {file.path}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>
          Choose how to handle these conflicts:
        </p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={handleKeepLocal}
            className="px-3 py-1.5 text-xs rounded"
            style={{
              background: 'var(--bg-hover)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--bg-hover)'
            }}
          >
            Keep Local
          </button>
          <button
            onClick={handleMerge}
            className="px-3 py-1.5 text-xs rounded"
            style={{
              background: 'var(--bg-hover)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--bg-hover)'
            }}
          >
            Merge
          </button>
          <button
            onClick={handleUseRemote}
            className="px-3 py-1.5 text-xs rounded font-medium"
            style={{
              background: 'var(--running)',
              color: '#fff',
              border: 'none'
            }}
          >
            Use Remote
          </button>
        </div>
      </div>
    </div>
  )
}
