import { useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { AgentProfile } from '@shared/types'

interface AgentFormProps {
  initialValues?: AgentProfile
  onSave: (agent: AgentProfile) => void
  onCancel: () => void
}

export function AgentForm({ initialValues, onSave, onCancel }: AgentFormProps) {
  const [name, setName] = useState(initialValues?.name ?? '')
  const [command, setCommand] = useState(initialValues?.command ?? '')
  const [argsStr, setArgsStr] = useState(initialValues?.args.join(' ') ?? '')
  const [launchTarget, setLaunchTarget] = useState<'currentTab' | 'newTab' | 'path'>(
    initialValues?.launchTarget ?? 'currentTab'
  )
  const [cwdPath, setCwdPath] = useState(initialValues?.cwdPath ?? '')

  const handleBrowseFolder = async () => {
    const selected = await (window as any).tangentAPI.dialog.openFolder()
    if (selected) setCwdPath(selected)
  }

  const handleSave = () => {
    const trimmedName = name.trim()
    const trimmedCommand = command.trim()
    if (!trimmedName || !trimmedCommand) return
    if (launchTarget === 'path' && !cwdPath.trim()) return

    const args = argsStr.trim() ? argsStr.trim().split(/\s+/) : []

    const agent: AgentProfile = {
      id: initialValues?.id ?? uuidv4(),
      name: trimmedName,
      command: trimmedCommand,
      args,
      cwdMode: 'activeSession',
      launchTarget,
      ...(launchTarget === 'path' && cwdPath.trim() ? { cwdPath: cwdPath.trim() } : {})
    }

    if (initialValues?.env) {
      agent.env = initialValues.env
    }

    onSave(agent)
  }

  const inputClass =
    'w-full px-2 py-1 text-sm rounded border border-[var(--bg-hover)] outline-none focus:border-[var(--accent)]'
  const inputStyle = {
    background: 'var(--bg-tertiary)',
    color: 'var(--text-primary)',
    transition: 'border-color 200ms ease'
  }

  return (
    <div
      className="p-2 border-t border-[var(--bg-hover)]"
      style={{ background: 'var(--bg-secondary)' }}
    >
      <div className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
        {initialValues ? 'Edit Agent' : 'New Agent'}
      </div>

      {/* Name */}
      <div className="mb-2">
        <label className="text-xs mb-0.5 block" style={{ color: 'var(--text-secondary)' }}>
          Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Copilot CLI"
          className={inputClass}
          style={inputStyle}
        />
      </div>

      {/* Command */}
      <div className="mb-2">
        <label className="text-xs mb-0.5 block" style={{ color: 'var(--text-secondary)' }}>
          Command
        </label>
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="e.g. copilot"
          className={inputClass}
          style={inputStyle}
        />
      </div>

      {/* Arguments */}
      <div className="mb-2">
        <label className="text-xs mb-0.5 block" style={{ color: 'var(--text-secondary)' }}>
          Arguments (space-separated)
        </label>
        <input
          type="text"
          value={argsStr}
          onChange={(e) => setArgsStr(e.target.value)}
          placeholder="e.g. --flag value"
          className={inputClass}
          style={inputStyle}
        />
      </div>

      {/* Launch Target */}
      <div className="mb-3">
        <label className="text-xs mb-0.5 block" style={{ color: 'var(--text-secondary)' }}>
          Launch Target
        </label>
        <select
          value={launchTarget}
          onChange={(e) => setLaunchTarget(e.target.value as 'currentTab' | 'newTab' | 'path')}
          className="w-full px-2 py-1 text-sm rounded border border-[var(--bg-hover)] outline-none focus:border-[var(--accent)]"
          style={{
            background: 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
            transition: 'border-color 200ms ease'
          }}
        >
          <option value="currentTab">Current Tab</option>
          <option value="newTab">New Tab</option>
          <option value="path">Path</option>
        </select>
      </div>

      {/* Folder Path (when launch target is 'path') */}
      {launchTarget === 'path' && (
        <div className="mb-3">
          <label className="text-xs mb-0.5 block" style={{ color: 'var(--text-secondary)' }}>
            Folder Path
          </label>
          <div className="flex gap-1">
            <input
              type="text"
              value={cwdPath}
              onChange={(e) => setCwdPath(e.target.value)}
              placeholder="Type or browse for a folder..."
              className={inputClass + ' flex-1'}
              style={inputStyle}
            />
            <button
              type="button"
              onClick={handleBrowseFolder}
              className="px-2 py-1 text-sm rounded border border-[var(--bg-hover)] hover:bg-[var(--bg-hover)] transition-colors shrink-0"
              style={{ color: 'var(--text-secondary)' }}
            >
              Browse
            </button>
          </div>
        </div>
      )}

      {/* Buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          className="flex-1 px-2 py-1 text-sm rounded hover:opacity-90 transition-opacity"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          Save
        </button>
        <button
          onClick={onCancel}
          className="flex-1 px-2 py-1 text-sm rounded border border-[var(--bg-hover)] hover:bg-[var(--bg-hover)] transition-colors"
          style={{ color: 'var(--text-secondary)' }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
