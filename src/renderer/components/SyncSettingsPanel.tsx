import { useState, useCallback } from 'react'

interface SyncSettingsPanelProps {
  excludePatterns: string[]
  onSave: (patterns: string[]) => void
  onCancel: () => void
}

const DEFAULT_PATTERNS = ['node_modules', '.git']

export function SyncSettingsPanel({ excludePatterns, onSave, onCancel }: SyncSettingsPanelProps) {
  const [patterns, setPatterns] = useState<string[]>(excludePatterns)
  const [newPattern, setNewPattern] = useState('')

  const handleAddPattern = useCallback(() => {
    const trimmed = newPattern.trim()
    if (trimmed && !patterns.includes(trimmed)) {
      setPatterns([...patterns, trimmed])
      setNewPattern('')
    }
  }, [newPattern, patterns])

  const handleRemovePattern = useCallback((pattern: string) => {
    if (!DEFAULT_PATTERNS.includes(pattern)) {
      setPatterns(patterns.filter(p => p !== pattern))
    }
  }, [patterns])

  const handleSave = useCallback(() => {
    onSave(patterns)
  }, [patterns, onSave])

  return (
    <div
      className="rounded-lg p-5 shadow-xl max-w-2xl w-full"
      style={{ background: 'var(--bg-secondary)', border: '1px solid var(--bg-hover)' }}
    >
      <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
        Workspace Sync Settings
      </h3>

      <div className="mb-4">
        <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
          Configure which files and directories to exclude from syncing between local workspace and Dev Box.
        </p>

        <div className="mb-3">
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-primary)' }}>
            Exclusion Patterns (glob format)
          </label>

          <div
            className="rounded p-2 max-h-48 overflow-y-auto"
            style={{ background: 'var(--bg-primary)', border: '1px solid var(--bg-hover)' }}
          >
            {patterns.length === 0 ? (
              <div className="py-2 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                No exclusion patterns
              </div>
            ) : (
              <ul className="space-y-1">
                {patterns.map((pattern) => {
                  const isDefault = DEFAULT_PATTERNS.includes(pattern)
                  return (
                    <li
                      key={pattern}
                      className="flex items-center justify-between px-2 py-1 rounded"
                      style={{ background: 'var(--bg-hover)' }}
                    >
                      <span className="text-xs font-mono" style={{ color: 'var(--text-primary)' }}>
                        {pattern}
                      </span>
                      {isDefault ? (
                        <span className="text-xs px-1.5 py-0.5 rounded" style={{ color: 'var(--text-muted)' }}>
                          default
                        </span>
                      ) : (
                        <button
                          onClick={() => handleRemovePattern(pattern)}
                          className="text-xs px-1.5 py-0.5 rounded hover:opacity-80"
                          style={{ color: 'var(--error)' }}
                        >
                          ✕
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          <input
            value={newPattern}
            onChange={(e) => setNewPattern(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddPattern()
            }}
            placeholder="Add pattern (e.g., *.log, dist/*, build)"
            className="flex-1 px-2 py-1.5 text-xs rounded"
            style={{
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--bg-hover)',
              outline: 'none'
            }}
          />
          <button
            onClick={handleAddPattern}
            disabled={!newPattern.trim()}
            className="px-3 py-1.5 text-xs rounded font-medium"
            style={{
              background: newPattern.trim() ? 'var(--accent)' : 'var(--bg-hover)',
              color: newPattern.trim() ? '#fff' : 'var(--text-muted)',
              border: 'none',
              cursor: newPattern.trim() ? 'pointer' : 'not-allowed',
              opacity: newPattern.trim() ? 1 : 0.5
            }}
          >
            Add
          </button>
        </div>
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
          onClick={handleSave}
          className="px-3 py-1.5 text-xs rounded font-medium"
          style={{
            background: 'var(--running)',
            color: '#fff',
            border: 'none'
          }}
        >
          Save
        </button>
      </div>
    </div>
  )
}
