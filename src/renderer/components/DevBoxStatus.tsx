import { useEffect, useState } from 'react'

interface DevBoxStatusProps {
  sessionId: string
  devBoxName: string
  connectionState: 'starting' | 'provisioning' | 'tunneling' | 'ready' | 'syncing' | 'disconnected' | 'failed'
  lastSyncTime?: number
  onReconnect: () => void
}

const STATE_INDICATORS: Record<
  string,
  { icon: string; color: string; label: string; animated?: boolean }
> = {
  starting: { icon: '🔵', color: 'var(--accent)', label: 'Starting', animated: true },
  provisioning: { icon: '🔵', color: 'var(--accent)', label: 'Provisioning', animated: true },
  tunneling: { icon: '🔵', color: 'var(--accent)', label: 'Tunneling', animated: true },
  ready: { icon: '🟢', color: 'var(--running)', label: 'Connected' },
  syncing: { icon: '🟡', color: 'var(--idle)', label: 'Syncing', animated: true },
  disconnected: { icon: '⚫', color: 'var(--text-muted)', label: 'Disconnected' },
  failed: { icon: '🔴', color: 'var(--error)', label: 'Failed' }
}

function formatLastSync(timestamp?: number): string {
  if (!timestamp) return 'Never'
  const elapsed = Date.now() - timestamp
  const seconds = Math.floor(elapsed / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  if (seconds > 10) return `${seconds}s ago`
  return 'Just now'
}

export function DevBoxStatus({
  sessionId,
  devBoxName,
  connectionState,
  lastSyncTime,
  onReconnect
}: DevBoxStatusProps) {
  const [showTooltip, setShowTooltip] = useState(false)
  const [connectionInfo, setConnectionInfo] = useState<any>(null)

  const indicator = STATE_INDICATORS[connectionState] || STATE_INDICATORS.disconnected
  const showReconnect = connectionState === 'disconnected' || connectionState === 'failed'

  useEffect(() => {
    // Listen for connection info updates
    const unsub = window.tangentAPI.devbox.onHealthUpdated((data) => {
      if (data.devBoxName === devBoxName) {
        setConnectionInfo(data.health)
      }
    })
    return unsub
  }, [devBoxName])

  return (
    <div className="relative flex items-center gap-2 shrink-0">
      <div
        className="flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer"
        style={{ background: 'var(--bg-hover)', border: '1px solid var(--bg-hover)' }}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        <span className={indicator.animated ? 'animate-pulse-slow' : ''}>
          {indicator.icon}
        </span>
        <span
          className="text-xs font-medium"
          style={{ color: 'var(--text-primary)' }}
        >
          {devBoxName}
        </span>
        <span
          className="text-xs"
          style={{ color: indicator.color }}
        >
          {indicator.label}
        </span>
      </div>

      {showReconnect && (
        <button
          onClick={onReconnect}
          className="px-2 py-0.5 text-xs rounded font-medium cursor-pointer hover:opacity-80"
          style={{
            background: 'var(--accent)',
            color: '#fff',
            border: 'none'
          }}
        >
          Reconnect
        </button>
      )}

      {showTooltip && (
        <div
          className="absolute bottom-6 right-0 p-2.5 rounded shadow-lg border border-[var(--bg-hover)] z-50 min-w-[220px]"
          style={{ background: 'var(--bg-secondary)' }}
        >
          <div className="text-xs space-y-1.5">
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-muted)' }}>Dev Box:</span>
              <span style={{ color: 'var(--text-primary)' }} className="font-medium">
                {devBoxName}
              </span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-muted)' }}>Status:</span>
              <span style={{ color: indicator.color }}>
                {indicator.label}
              </span>
            </div>
            {lastSyncTime && (
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-muted)' }}>Last sync:</span>
                <span style={{ color: 'var(--text-secondary)' }}>
                  {formatLastSync(lastSyncTime)}
                </span>
              </div>
            )}
            {connectionInfo?.ipAddress && (
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-muted)' }}>IP:</span>
                <span style={{ color: 'var(--text-secondary)' }} className="font-mono">
                  {connectionInfo.ipAddress}
                </span>
              </div>
            )}
            {connectionInfo?.sshPort && (
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-muted)' }}>SSH:</span>
                <span style={{ color: 'var(--text-secondary)' }} className="font-mono">
                  {connectionInfo.sshPort}
                </span>
              </div>
            )}
            {connectionInfo?.acpPort && (
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-muted)' }}>ACP:</span>
                <span style={{ color: 'var(--text-secondary)' }} className="font-mono">
                  {connectionInfo.acpPort}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
