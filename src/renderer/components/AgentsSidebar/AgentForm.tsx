import { useState, useEffect, useRef } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { AgentProfile } from '@shared/types'
import { DevBoxPicker } from '../DevBoxPicker'

interface AgentFormProps {
  initialValues?: AgentProfile
  onSave: (agent: AgentProfile) => void
  onCancel: () => void
}

export function AgentForm({ initialValues, onSave, onCancel }: AgentFormProps) {
  const [name, setName] = useState(initialValues?.name ?? '')
  const [command, setCommand] = useState(initialValues?.command ?? '')
  const [argsStr, setArgsStr] = useState(initialValues?.args.join(' ') ?? '')
  const [cwdPath, setCwdPath] = useState(initialValues?.cwdPath ?? '')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedSuggestion, setSelectedSuggestion] = useState(-1)
  const suggestionsRef = useRef<HTMLDivElement>(null)
  const cwdInputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  // Remote execution state
  const [remoteEnabled, setRemoteEnabled] = useState(initialValues?.remote?.enabled ?? false)
  const [devBoxProject, setDevBoxProject] = useState(initialValues?.remote?.devBoxProject ?? '')
  const [devBoxName, setDevBoxName] = useState(initialValues?.remote?.devBoxName ?? '')
  const [repoPath, setRepoPath] = useState(initialValues?.remote?.repoPath ?? '')
  const [sshUser, setSshUser] = useState(initialValues?.remote?.sshUser ?? '')
  const [showDevBoxPicker, setShowDevBoxPicker] = useState(false)

  // Set default SSH user to current user
  useEffect(() => {
    if (!sshUser && remoteEnabled) {
      const currentUser = (window as any).tangentAPI?.app?.getUsername?.() || 'vscode'
      setSshUser(currentUser)
    }
  }, [remoteEnabled, sshUser])

  const handleBrowseFolder = async () => {
    const selected = await (window as any).tangentAPI.dialog.openFolder()
    if (selected) {
      setCwdPath(selected)
      setShowSuggestions(false)
    }
  }

  const handleCwdChange = (value: string) => {
    setCwdPath(value)
    setSelectedSuggestion(-1)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (value.length >= 2) {
      debounceRef.current = setTimeout(async () => {
        try {
          const results = await (window as any).tangentAPI.fs.suggestDirs(value)
          setSuggestions(results)
          setShowSuggestions(results.length > 0)
        } catch {
          setSuggestions([])
          setShowSuggestions(false)
        }
      }, 150)
    } else {
      setSuggestions([])
      setShowSuggestions(false)
    }
  }

  const selectSuggestion = (path: string) => {
    setCwdPath(path)
    setShowSuggestions(false)
    setSelectedSuggestion(-1)
    cwdInputRef.current?.focus()
  }

  const handleCwdKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      setSelectedSuggestion(prev => Math.min(prev + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      setSelectedSuggestion(prev => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' && selectedSuggestion >= 0) {
      e.preventDefault()
      e.stopPropagation()
      selectSuggestion(suggestions[selectedSuggestion])
    } else if (e.key === 'Tab' && selectedSuggestion >= 0) {
      e.preventDefault()
      e.stopPropagation()
      // Tab-complete: set path and trigger new suggestions
      const selected = suggestions[selectedSuggestion]
      setCwdPath(selected + '\\')
      setSelectedSuggestion(-1)
      handleCwdChange(selected + '\\')
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      setShowSuggestions(false)
    }
  }

  // Scroll selected suggestion into view
  useEffect(() => {
    if (selectedSuggestion >= 0 && suggestionsRef.current) {
      const items = suggestionsRef.current.querySelectorAll('button')
      items[selectedSuggestion]?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedSuggestion])

  // Pre-fill defaults from config for new agents
  useEffect(() => {
    if (!initialValues) {
      (window as any).tangentAPI.config.get().then((config: any) => {
        if (!command) setCommand(config.defaultAgentCommand || 'copilot')
        if (!argsStr) setArgsStr(config.defaultAgentArgs || '--yolo')
      }).catch(() => {})
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Close suggestions on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node) &&
          cwdInputRef.current !== e.target) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleDevBoxSelect = (devBox: { name: string; projectName: string }) => {
    setDevBoxName(devBox.name)
    setDevBoxProject(devBox.projectName)
    setShowDevBoxPicker(false)
  }

  const handleSave = () => {
    const trimmedName = name.trim()
    const trimmedCommand = command.trim()
    if (!trimmedName || !trimmedCommand) return

    const args = argsStr.trim() ? argsStr.trim().split(/\s+/) : []

    const agent: AgentProfile = {
      id: initialValues?.id ?? uuidv4(),
      name: trimmedName,
      command: trimmedCommand,
      args,
      cwdMode: 'activeSession',
      launchTarget: cwdPath.trim() ? 'path' : 'newTab',
      ...(cwdPath.trim() ? { cwdPath: cwdPath.trim() } : {})
    }

    if (initialValues?.env) {
      agent.env = initialValues.env
    }

    // Add remote configuration if enabled
    if (remoteEnabled) {
      agent.remote = {
        enabled: true,
        devBoxProject: devBoxProject.trim() || undefined,
        devBoxName: devBoxName.trim() || undefined,
        repoPath: repoPath.trim() || undefined,
        sshUser: sshUser.trim() || undefined
      }
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

      {/* Working Directory */}
      <div className="mb-3 relative">
        <label className="text-xs mb-0.5 block" style={{ color: 'var(--text-secondary)' }}>
          Working Directory
        </label>
        <div className="flex gap-1">
          <input
            ref={cwdInputRef}
            type="text"
            value={cwdPath}
            onChange={(e) => handleCwdChange(e.target.value)}
            onKeyDown={handleCwdKeyDown}
            onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true) }}
            placeholder="e.g. D:\git\myproject"
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
        {showSuggestions && suggestions.length > 0 && (
          <div
            ref={suggestionsRef}
            className="absolute left-0 right-0 mt-0.5 rounded border overflow-y-auto z-50"
            style={{
              background: 'var(--bg-tertiary)',
              borderColor: 'var(--border)',
              maxHeight: '160px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)'
            }}
          >
            {suggestions.map((s, i) => (
              <button
                key={s}
                className="w-full text-left px-2 py-1 text-xs truncate block"
                style={{
                  color: 'var(--text-primary)',
                  background: i === selectedSuggestion ? 'var(--accent)' : 'transparent'
                }}
                onMouseEnter={() => setSelectedSuggestion(i)}
                onClick={() => selectSuggestion(s)}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Remote Execution Section */}
      <div className="mb-3 pb-3 border-t border-[var(--bg-hover)] pt-3">
        <div className="flex items-center gap-2 mb-2">
          <input
            type="checkbox"
            id="remoteEnabled"
            checked={remoteEnabled}
            onChange={(e) => setRemoteEnabled(e.target.checked)}
            className="w-4 h-4 cursor-pointer"
          />
          <label
            htmlFor="remoteEnabled"
            className="text-xs cursor-pointer"
            style={{ color: 'var(--text-secondary)' }}
          >
            Enable remote execution on Dev Box
          </label>
        </div>

        {remoteEnabled && (
          <div className="pl-6 space-y-2">
            {/* Dev Box Selection */}
            <div>
              <label className="text-xs mb-0.5 block" style={{ color: 'var(--text-secondary)' }}>
                Dev Box
              </label>
              <div className="flex gap-1 items-center">
                <button
                  type="button"
                  onClick={() => setShowDevBoxPicker(true)}
                  className="px-2 py-1 text-sm rounded border border-[var(--bg-hover)] hover:bg-[var(--bg-hover)] transition-colors"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {devBoxName ? 'Change Dev Box' : 'Select Dev Box'}
                </button>
                {devBoxName && (
                  <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
                    {devBoxName} <span style={{ color: 'var(--text-muted)' }}>({devBoxProject})</span>
                  </span>
                )}
              </div>
            </div>

            {/* Repo Path */}
            <div>
              <label className="text-xs mb-0.5 block" style={{ color: 'var(--text-secondary)' }}>
                Repo Path on Dev Box
              </label>
              <input
                type="text"
                value={repoPath}
                onChange={(e) => setRepoPath(e.target.value)}
                placeholder="e.g. /home/vscode/workspace"
                className={inputClass}
                style={inputStyle}
              />
            </div>

            {/* SSH User */}
            <div>
              <label className="text-xs mb-0.5 block" style={{ color: 'var(--text-secondary)' }}>
                SSH User
              </label>
              <input
                type="text"
                value={sshUser}
                onChange={(e) => setSshUser(e.target.value)}
                placeholder="e.g. vscode"
                className={inputClass}
                style={inputStyle}
              />
            </div>
          </div>
        )}
      </div>

      {/* DevBoxPicker Dialog */}
      <DevBoxPicker
        open={showDevBoxPicker}
        onSelect={handleDevBoxSelect}
        onCancel={() => setShowDevBoxPicker(false)}
      />

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
