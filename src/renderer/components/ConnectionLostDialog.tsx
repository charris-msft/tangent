interface ConnectionLostDialogProps {
  open: boolean
  sessionId: string
  devBoxName: string
  lastSyncTime?: number
  onReconnect: () => void
  onSwitchDevBox: () => void
  onContinueLocally: () => void
}

function formatLastSync(timestamp?: number): string {
  if (!timestamp) return 'never'
  const elapsed = Date.now() - timestamp
  const seconds = Math.floor(elapsed / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  if (seconds > 10) return `${seconds}s ago`
  return 'just now'
}

export function ConnectionLostDialog({
  open,
  sessionId,
  devBoxName,
  lastSyncTime,
  onReconnect,
  onSwitchDevBox,
  onContinueLocally
}: ConnectionLostDialogProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        className="rounded-lg p-6 shadow-xl max-w-md w-full mx-4"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--bg-hover)' }}
      >
        <div className="mb-4">
          <h3 className="text-base font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
            Connection Lost
          </h3>
          <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
            Lost connection to <span className="font-medium" style={{ color: 'var(--accent)' }}>{devBoxName}</span>.
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Local workspace is current as of <span className="font-medium">{formatLastSync(lastSyncTime)}</span>.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <button
            onClick={onReconnect}
            className="w-full px-4 py-2.5 text-sm rounded font-medium transition-opacity hover:opacity-90"
            style={{
              background: 'var(--running)',
              color: '#fff',
              border: 'none'
            }}
          >
            Reconnect
          </button>

          <button
            onClick={onSwitchDevBox}
            className="w-full px-4 py-2.5 text-sm rounded font-medium transition-opacity hover:opacity-90"
            style={{
              background: 'var(--accent)',
              color: '#fff',
              border: 'none'
            }}
          >
            Switch Dev Box
          </button>

          <button
            onClick={onContinueLocally}
            className="w-full px-4 py-2.5 text-sm rounded transition-opacity hover:opacity-90"
            style={{
              background: 'var(--bg-hover)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--bg-hover)'
            }}
          >
            Continue Locally
          </button>
        </div>
      </div>
    </div>
  )
}
