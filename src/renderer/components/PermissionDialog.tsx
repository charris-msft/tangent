import { useEffect, useState, useCallback } from 'react'

interface PermissionRequest {
  kind: 'shell' | 'write' | 'mcp' | 'read' | 'url'
  detail: string
  [key: string]: unknown
}

interface PermissionDialogProps {
  sessionId: string | null
}

const LABELS: Record<string, string> = {
  shell: 'Run Shell Command',
  write: 'Write File',
  read: 'Read File',
  mcp: 'MCP Server Call',
  url: 'Fetch URL'
}

export function PermissionDialog({ sessionId }: PermissionDialogProps) {
  const [request, setRequest] = useState<PermissionRequest | null>(null)

  useEffect(() => {
    if (!sessionId) return
    const unsub = window.tangentAPI.sdk.onPermissionRequest(sessionId, (req: PermissionRequest) => {
      setRequest(req)
    })
    return () => unsub()
  }, [sessionId])

  const handleApprove = useCallback(() => {
    if (sessionId) {
      window.tangentAPI.sdk.approvePermission(sessionId, true)
    }
    setRequest(null)
  }, [sessionId])

  const handleDeny = useCallback(() => {
    if (sessionId) {
      window.tangentAPI.sdk.approvePermission(sessionId, false)
    }
    setRequest(null)
  }, [sessionId])

  if (!request) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        className="rounded-lg p-5 shadow-xl max-w-md w-full mx-4"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--bg-hover)' }}
      >
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
          {LABELS[request.kind] ?? 'Permission Request'}
        </h3>
        <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>
          {request.detail}
        </p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={handleDeny}
            className="px-3 py-1.5 text-xs rounded"
            style={{
              background: 'var(--bg-hover)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--bg-hover)'
            }}
          >
            Deny
          </button>
          <button
            onClick={handleApprove}
            className="px-3 py-1.5 text-xs rounded font-medium"
            style={{
              background: 'var(--running)',
              color: '#fff',
              border: 'none'
            }}
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  )
}
