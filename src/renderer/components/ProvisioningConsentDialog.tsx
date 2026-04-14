interface ProvisioningConsentDialogProps {
  open: boolean
  devBoxName: string
  onApprove: () => void
  onCancel: () => void
}

export function ProvisioningConsentDialog({
  open,
  devBoxName,
  onApprove,
  onCancel
}: ProvisioningConsentDialogProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        className="rounded-lg p-5 shadow-xl max-w-2xl w-full mx-4"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--bg-hover)' }}
      >
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
          Dev Box Provisioning Consent
        </h3>

        <div className="mb-4">
          <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
            Tangent will make the following changes to <span className="font-semibold" style={{ color: 'var(--accent)' }}>{devBoxName}</span>:
          </p>

          <div
            className="rounded p-3 mb-3"
            style={{ background: 'var(--bg-primary)', border: '1px solid var(--bg-hover)' }}
          >
            <ul className="space-y-2">
              <li className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-primary)' }}>
                <span className="flex-shrink-0">✅</span>
                <div>
                  <div className="font-semibold">OpenSSH Server</div>
                  <div style={{ color: 'var(--text-muted)' }}>Enabled and set to auto-start</div>
                </div>
              </li>

              <li className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-primary)' }}>
                <span className="flex-shrink-0">✅</span>
                <div>
                  <div className="font-semibold">CopilotACP Scheduled Task</div>
                  <div style={{ color: 'var(--text-muted)' }}>Auto-start on login, port 7333</div>
                </div>
              </li>

              <li className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-primary)' }}>
                <span className="flex-shrink-0">✅</span>
                <div>
                  <div className="font-semibold">Copilot CLI Configuration</div>
                  <div style={{ color: 'var(--text-muted)' }}>Session sync set to account level</div>
                </div>
              </li>

              <li className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-primary)' }}>
                <span className="flex-shrink-0">✅</span>
                <div>
                  <div className="font-semibold">Sync Hook Scripts</div>
                  <div style={{ color: 'var(--text-muted)' }}>.github/hooks/ directory</div>
                </div>
              </li>
            </ul>
          </div>

          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            These changes ensure Tangent can properly execute agents on your Dev Box and sync workspace state.
          </p>
        </div>

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
            onClick={onApprove}
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
