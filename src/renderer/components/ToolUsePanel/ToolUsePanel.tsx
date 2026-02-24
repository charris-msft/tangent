import { useState } from 'react'
import { useToolUse } from '@/hooks/useToolUse'
import { searchRegistry } from '@/components/Terminal/TerminalViewport'
import type { ToolUseEntry } from '@shared/types'

interface ToolUsePanelProps {
  activeSessionId: string | null
}

function kindIcon(kind: ToolUseEntry['kind']): string {
  switch (kind) {
    case 'tool': return '🔧'
    case 'skill': return '⚡'
    case 'subagent': return '🤖'
  }
}

function statusIndicator(status: ToolUseEntry['status']): JSX.Element {
  switch (status) {
    case 'running':
      return <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse-slow" title="Running" />
    case 'success':
      return <span className="text-green-400 text-xs" title="Success">✓</span>
    case 'error':
      return <span className="text-red-400 text-xs" title="Error">✗</span>
  }
}

function formatDuration(startedAt: number, completedAt?: number): string {
  if (!completedAt) return '...'
  const ms = completedAt - startedAt
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function sourceLabel(entry: ToolUseEntry): string {
  if (entry.source === 'mcp' && entry.mcpServerName) return entry.mcpServerName
  if (entry.source === 'skill' && entry.pluginName) return entry.pluginName
  if (entry.source === 'built-in') return 'built-in'
  return entry.source
}

function ToolUseRow({ entry, onJump }: { entry: ToolUseEntry; onJump?: (name: string) => void }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      className="border-b border-[var(--bg-hover)] last:border-b-0"
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-[var(--bg-hover)] transition-colors"
      >
        {/* Icon */}
        <span className="text-sm shrink-0" title={entry.kind}>{kindIcon(entry.kind)}</span>

        {/* Name */}
        <span className="font-mono text-[var(--text-primary)] truncate flex-1" title={entry.name}>
          {entry.name}
        </span>

        {/* Source badge */}
        <span
          className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium"
          style={{
            background: 'var(--bg-hover)',
            color: 'var(--text-muted)',
          }}
          title={entry.pluginVersion ? `v${entry.pluginVersion}` : undefined}
        >
          {sourceLabel(entry)}
          {entry.pluginVersion && <span className="ml-1 opacity-60">v{entry.pluginVersion}</span>}
        </span>

        {/* Duration */}
        <span className="shrink-0 text-[var(--text-muted)] tabular-nums w-12 text-right">
          {formatDuration(entry.startedAt, entry.completedAt)}
        </span>

        {/* Status */}
        <span className="shrink-0 w-4 flex items-center justify-center">
          {statusIndicator(entry.status)}
        </span>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 py-2 text-xs space-y-1" style={{ background: 'var(--bg-hover)' }}>
          {entry.mcpServerName && (
            <div>
              <span className="text-[var(--text-muted)]">MCP Server: </span>
              <span className="text-[var(--text-primary)] font-mono">{entry.mcpServerName}</span>
              {entry.mcpToolName && entry.mcpToolName !== entry.name && (
                <span className="text-[var(--text-muted)]"> → {entry.mcpToolName}</span>
              )}
            </div>
          )}
          {entry.pluginName && (
            <div>
              <span className="text-[var(--text-muted)]">Plugin: </span>
              <span className="text-[var(--text-primary)] font-mono">{entry.pluginName}</span>
              {entry.pluginVersion && <span className="text-[var(--text-muted)]"> v{entry.pluginVersion}</span>}
            </div>
          )}
          {entry.progressMessage && (
            <div>
              <span className="text-[var(--text-muted)]">Progress: </span>
              <span className="text-[var(--text-primary)]">{entry.progressMessage}</span>
            </div>
          )}
          {entry.args && (
            <div>
              <span className="text-[var(--text-muted)]">Args: </span>
              <pre className="mt-0.5 p-1.5 rounded text-[10px] font-mono overflow-x-auto max-h-24 overflow-y-auto"
                style={{ background: 'var(--bg-primary)' }}>
                {typeof entry.args === 'string' ? entry.args : JSON.stringify(entry.args, null, 2)}
              </pre>
            </div>
          )}
          {entry.result && (
            <div>
              <span className="text-[var(--text-muted)]">Result: </span>
              <pre className="mt-0.5 p-1.5 rounded text-[10px] font-mono overflow-x-auto max-h-24 overflow-y-auto whitespace-pre-wrap"
                style={{ background: 'var(--bg-primary)' }}>
                {entry.result.length > 500 ? entry.result.slice(0, 500) + '…' : entry.result}
              </pre>
            </div>
          )}
          {entry.error && (
            <div>
              <span className="text-red-400">Error: </span>
              <span className="text-red-300">{entry.error}</span>
            </div>
          )}
          {onJump && (
            <button
              onClick={(e) => { e.stopPropagation(); onJump(entry.name) }}
              className="mt-1 px-2 py-0.5 rounded text-[10px] hover:bg-[var(--bg-primary)] transition-colors"
              style={{ color: 'var(--accent)', border: '1px solid var(--bg-hover)' }}
            >
              ↗ Find in terminal
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function ToolUsePanel({ activeSessionId }: ToolUsePanelProps) {
  const { entries, scrollRef } = useToolUse(activeSessionId)

  const running = entries.filter(e => e.status === 'running').length
  const total = entries.length

  const handleJump = (toolName: string) => {
    if (!activeSessionId) return
    const search = searchRegistry.get(activeSessionId)
    if (search) {
      search.findNext(toolName, { caseSensitive: false, regex: false })
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b border-[var(--bg-hover)]"
        style={{ background: 'var(--bg-secondary)' }}
      >
        <span className="text-xs font-medium text-[var(--text-primary)]">
          Tool Use
        </span>
        <span className="text-[10px] text-[var(--text-muted)]">
          {total > 0 && (
            <>
              {total} tool{total !== 1 ? 's' : ''}
              {running > 0 && <span className="text-blue-400 ml-1">({running} running)</span>}
            </>
          )}
        </span>
      </div>

      {/* Entries */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto"
        style={{ background: 'var(--bg-primary)' }}
      >
        {entries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-[var(--text-muted)] opacity-50">
            {activeSessionId ? 'No tool activity yet' : 'Select a session'}
          </div>
        ) : (
          entries.map(entry => (
            <ToolUseRow key={entry.id} entry={entry} onJump={handleJump} />
          ))
        )}
      </div>
    </div>
  )
}
