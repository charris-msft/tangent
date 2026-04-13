import { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import type { Session } from '@shared/types'
import { DevBoxStatus } from '../DevBoxStatus'

declare const tangentAPI: {
  shell: {
    openEditor: (folderPath: string) => Promise<void>
    openInExplorer: (folderPath: string) => Promise<void>
    getEditor: () => Promise<string>
    setEditor: (editor: string) => Promise<void>
  }
}

interface DevBoxInfo {
  devBoxName: string
  connectionState: 'starting' | 'provisioning' | 'tunneling' | 'ready' | 'syncing' | 'disconnected' | 'failed'
  lastSyncTime?: number
}

interface StatusBarProps {
  sessions: Session[]
  activeSession: Session | undefined
  onToggleSettings: () => void
  devBoxInfo?: DevBoxInfo
}

/** Agent type label mapping */
const AGENT_LABELS: Record<string, string> = {
  'copilot-cli': 'Copilot CLI',
  'claude-code': 'Claude Code',
  shell: 'Shell'
}

/**
 * Truncate a path from the left side if it exceeds maxLen.
 * e.g., "C:\Users\me\very\long\path" -> "...\very\long\path"
 */
function truncatePathLeft(p: string, maxLen: number): string {
  if (p.length <= maxLen) return p
  return '\u2026' + p.slice(p.length - maxLen + 1)
}

/**
 * Truncate text from the right if it exceeds maxLen.
 */
function truncateRight(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 1) + '\u2026'
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`
  return String(count)
}

export function StatusBar({ sessions, activeSession, onToggleSettings, devBoxInfo }: StatusBarProps) {
  const [editorPopupOpen, setEditorPopupOpen] = useState(false)
  const [editorValue, setEditorValue] = useState('')
  const popupRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Count agent sessions by status group (skip shell sessions)
  const statusCounts = useMemo(() => {
    let running = 0
    let idle = 0
    let error = 0
    for (const s of sessions) {
      if (s.agentType === 'shell') continue
      if (s.status === 'processing' || s.status === 'tool_executing') running++
      else if (s.status === 'agent_ready' || s.status === 'agent_launching' || s.status === 'needs_input') idle++
      else if (s.status === 'failed') error++
    }
    return { running, idle, error }
  }, [sessions])

  const agentLabel = activeSession
    ? AGENT_LABELS[activeSession.agentType] ?? activeSession.agentType
    : 'No Session'

  const lastActivity = activeSession
    ? truncateRight(activeSession.lastActivity || '', 40)
    : ''

  const cwdPath = activeSession
    ? truncatePathLeft(activeSession.folderPath || '', 50)
    : ''

  const handleEditorClick = useCallback(() => {
    if (activeSession?.folderPath) {
      tangentAPI.shell.openEditor(activeSession.folderPath)
    }
  }, [activeSession?.folderPath])

  const handleEditorContextMenu = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault()
    const current = await tangentAPI.shell.getEditor()
    setEditorValue(current)
    setEditorPopupOpen(true)
  }, [])

  const handleEditorSave = useCallback(async () => {
    if (editorValue.trim()) {
      await tangentAPI.shell.setEditor(editorValue.trim())
    }
    setEditorPopupOpen(false)
  }, [editorValue])

  const handleDevBoxReconnect = useCallback(() => {
    if (activeSession && devBoxInfo) {
      // TODO: Wire to remote reconnect logic once RemoteSessionManager exists
      console.log('[StatusBar] DevBox reconnect requested for session', activeSession.id)
    }
  }, [activeSession, devBoxInfo])

  useEffect(() => {
    if (editorPopupOpen && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editorPopupOpen])

  useEffect(() => {
    if (!editorPopupOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setEditorPopupOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [editorPopupOpen])

  return (
    <div
      className="h-6 min-h-6 flex items-center px-3 text-xs border-t border-[var(--bg-hover)]"
      style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
    >
      {/* Left section: per-status colored dots + counts */}
      <div className="flex items-center gap-2 shrink-0">
        {statusCounts.running > 0 && (
          <span className="flex items-center gap-0.5">
            <span style={{ color: 'var(--running)' }}>{'\u25CF'}</span>
            <span>{statusCounts.running}</span>
          </span>
        )}
        {statusCounts.idle > 0 && (
          <span className="flex items-center gap-0.5">
            <span style={{ color: 'var(--idle)' }}>{'\u25CF'}</span>
            <span>{statusCounts.idle}</span>
          </span>
        )}
        {statusCounts.error > 0 && (
          <span className="flex items-center gap-0.5">
            <span style={{ color: 'var(--error)' }}>{'\u25CF'}</span>
            <span>{statusCounts.error}</span>
          </span>
        )}
        {statusCounts.running === 0 && statusCounts.idle === 0 && statusCounts.error === 0 && (
          <span style={{ color: 'var(--text-muted)' }}>{'\u25CB'}</span>
        )}
      </div>

      <span className="mx-2" style={{ color: 'var(--text-muted)' }}>{'\u2502'}</span>

      {/* Center section: agent type + last activity */}
      <div className="flex items-center gap-2 min-w-0 flex-shrink">
        <span style={{ color: 'var(--text-primary)' }}>{agentLabel}</span>
        {lastActivity && (
          <>
            <span style={{ color: 'var(--text-muted)' }}>{'\u2014'}</span>
            <span className="truncate" style={{ color: 'var(--text-muted)' }}>
              {lastActivity}
            </span>
          </>
        )}
      </div>

      {/* Spacer */}
      <span className="flex-1" />

      {/* Right section: DevBox status + Metrics + CWD + keyboard hint */}
      <div className="flex items-center gap-2 shrink-0">
        {devBoxInfo && activeSession && (
          <>
            <DevBoxStatus
              sessionId={activeSession.id}
              devBoxName={devBoxInfo.devBoxName}
              connectionState={devBoxInfo.connectionState}
              lastSyncTime={devBoxInfo.lastSyncTime}
              onReconnect={handleDevBoxReconnect}
            />
            <span className="mx-0.5" style={{ color: 'var(--text-muted)' }}>{'\u2502'}</span>
          </>
        )}
        {activeSession?.metrics && (activeSession.metrics.inputTokens > 0 || activeSession.metrics.outputTokens > 0) && (
          <>
            <span style={{ color: 'var(--text-muted)' }} title="Token usage (input / output)">
              {formatTokens(activeSession.metrics.inputTokens)}/{formatTokens(activeSession.metrics.outputTokens)}
            </span>
            {activeSession.metrics.cost > 0 && (
              <span style={{ color: 'var(--text-muted)' }} title="Estimated cost">
                ${activeSession.metrics.cost.toFixed(4)}
              </span>
            )}
            <span className="mx-0.5" style={{ color: 'var(--text-muted)' }}>{'\u2502'}</span>
          </>
        )}
        {cwdPath && (
          <button
            className="max-w-[200px] truncate cursor-pointer hover:underline"
            style={{ color: 'var(--text-muted)', background: 'none', border: 'none', padding: 0, font: 'inherit', fontSize: 'inherit' }}
            title={`Open ${activeSession?.folderPath} in file explorer`}
            onClick={() => activeSession?.folderPath && tangentAPI.shell.openInExplorer(activeSession.folderPath)}
          >
            {cwdPath}
          </button>
        )}
        {activeSession?.folderPath && (
          <span className="relative">
            <button
              onClick={handleEditorClick}
              onContextMenu={handleEditorContextMenu}
              className="hover:underline cursor-pointer"
              style={{ color: 'var(--text-muted)', background: 'none', border: 'none', padding: 0, font: 'inherit', fontSize: 'inherit' }}
              title="Open in editor (right-click to configure)"
            >
              Editor
            </button>
            {editorPopupOpen && (
              <div
                ref={popupRef}
                className="absolute bottom-6 right-0 p-2 rounded shadow-lg border border-[var(--bg-hover)] z-50 flex items-center gap-1"
                style={{ background: 'var(--bg-secondary)' }}
              >
                <input
                  ref={inputRef}
                  type="text"
                  value={editorValue}
                  onChange={(e) => setEditorValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleEditorSave(); if (e.key === 'Escape') setEditorPopupOpen(false) }}
                  className="px-1.5 py-0.5 text-xs rounded border border-[var(--bg-hover)]"
                  style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', width: '120px' }}
                  placeholder="e.g. code"
                />
                <button
                  onClick={handleEditorSave}
                  className="px-1.5 py-0.5 text-xs rounded cursor-pointer"
                  style={{ background: 'var(--bg-hover)', color: 'var(--text-primary)' }}
                >
                  Save
                </button>
              </div>
            )}
          </span>
        )}
        <span className="mx-1" style={{ color: 'var(--text-muted)' }}>{'\u2502'}</span>
        <button
          onClick={onToggleSettings}
          className="cursor-pointer flex items-center justify-center"
          style={{ color: 'var(--text-muted)', background: 'none', border: 'none', font: 'inherit', fontSize: 'inherit', padding: 0 }}
          title="Settings"
        >
          ⚙
        </button>
        <span className="mx-1" style={{ color: 'var(--text-muted)' }}>{'\u2502'}</span>
        <span style={{ color: 'var(--text-muted)' }}>Ctrl+B panels</span>
      </div>
    </div>
  )
}
