import { useMemo } from 'react'
import { useHumanContext } from '@/hooks/useHumanContext'
import { searchRegistry, terminalRegistry } from '@/components/Terminal/TerminalViewport'
import type { HumanContext, PromptEntry } from '@shared/types'

interface HumanContextPanelProps {
  sessionId: string | null
}

const AGENT_ICONS: Record<string, string> = {
  'copilot-cli': '🤖',
  'claude-code': '🔮',
  'shell': '🐚',
}

const AGENT_LABELS: Record<string, string> = {
  'copilot-cli': 'Copilot CLI',
  'claude-code': 'Claude Code',
  'shell': 'Shell',
}

function formatTimeAgo(ms: number): string {
  if (ms < 0) ms = 0
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function truncatePath(p: string, maxLen: number = 40): string {
  if (p.length <= maxLen) return p
  const parts = p.replace(/\//g, '\\').split('\\')
  if (parts.length <= 2) return '...' + p.slice(-(maxLen - 3))
  // Show drive + ... + last 2 segments
  const head = parts[0]
  const tail = parts.slice(-2).join('\\')
  return `${head}\\...\\${tail}`
}

function PromptItem({ entry, sessionId }: { entry: PromptEntry; sessionId: string | null }) {
  const truncated = entry.text.length > 120
    ? entry.text.slice(0, 117) + '...'
    : entry.text

  const handleClick = () => {
    if (!sessionId) return
    const searchAddon = searchRegistry.get(sessionId)
    if (!searchAddon) return
    // Use first 200 chars to avoid overly long search queries
    const query = entry.text.slice(0, 200)
    // findPrevious searches bottom-up, so it finds the most recent occurrence
    searchAddon.findPrevious(query, { caseSensitive: false, regex: false })
    // Refocus the terminal so the user can continue working
    const terminal = terminalRegistry.get(sessionId)
    terminal?.focus()
  }

  return (
    <div
      className="flex items-start gap-2 min-w-0 cursor-pointer rounded px-1 -mx-1 transition-colors"
      style={{ color: 'var(--text-secondary)' }}
      onClick={handleClick}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick() }}
      title="Click to find in terminal"
    >
      <span
        className="shrink-0 mt-0.5 text-xs"
        style={{ color: 'var(--text-muted)' }}
      >
        ›
      </span>
      <p
        className="font-mono text-xs leading-relaxed break-all min-w-0 flex-1"
      >
        {truncated}
      </p>
    </div>
  )
}

function SnapshotBar({ context }: { context: HumanContext }) {
  const { snapshot } = context
  const icon = AGENT_ICONS[snapshot.agentType] || '📋'
  const label = AGENT_LABELS[snapshot.agentType] || snapshot.agentType
  const path = truncatePath(snapshot.folderPath)

  const hasMetrics = snapshot.metrics &&
    (snapshot.metrics.inputTokens > 0 || snapshot.metrics.outputTokens > 0)

  const formatTokens = (n: number) => {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
    return String(n)
  }

  return (
    <div
      className="flex items-center gap-3 text-xs flex-wrap"
      style={{ color: 'var(--text-secondary)' }}
    >
      <span className="flex items-center gap-1 font-medium" style={{ color: 'var(--text-primary)' }}>
        {icon} {label}
      </span>
      <span style={{ color: 'var(--text-muted)' }}>•</span>
      <span
        className="truncate"
        title={snapshot.folderPath}
        style={{ color: 'var(--text-muted)', maxWidth: '200px' }}
      >
        {path}
      </span>
      {hasMetrics && (
        <>
          <span style={{ color: 'var(--text-muted)' }}>•</span>
          <span style={{ color: 'var(--text-muted)' }}>
            ↗{formatTokens(snapshot.metrics!.inputTokens)} ↙{formatTokens(snapshot.metrics!.outputTokens)}
          </span>
        </>
      )}
    </div>
  )
}

function ResumeBadge({ context }: { context: HumanContext }) {
  const { resumeSuggestion } = context

  return (
    <div
      className="flex items-center gap-2 text-xs px-2 py-1 rounded"
      style={{
        background: 'var(--bg-hover)',
        color: 'var(--text-secondary)',
      }}
    >
      <span>{resumeSuggestion.icon}</span>
      <span>{resumeSuggestion.text}</span>
    </div>
  )
}

export function HumanContextPanel({ sessionId }: HumanContextPanelProps) {
  const { context, isLoading, isCollapsed, toggleCollapsed } = useHumanContext(sessionId)

  // Don't render if there's no session
  if (!sessionId) return null

  // Collapsed state: show a minimal toggle strip
  if (isCollapsed) {
    return (
      <div
        className="flex items-center justify-between px-3 py-1 cursor-pointer select-none shrink-0"
        style={{
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border)',
        }}
        onClick={toggleCollapsed}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleCollapsed() }}
        aria-label="Expand context panel"
        aria-expanded={false}
      >
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          <span>▼</span>
          <span>Context</span>
          {context && (
            <>
              <span style={{ color: 'var(--text-muted)' }}>•</span>
              <span>
                {AGENT_ICONS[context.snapshot.agentType] || '📋'}{' '}
                {AGENT_LABELS[context.snapshot.agentType] || context.snapshot.agentType}
              </span>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className="shrink-0 overflow-hidden"
      style={{
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)',
        transition: 'max-height 200ms ease-out',
      }}
    >
      <div className="px-3 py-2 space-y-2">
        {/* Snapshot bar */}
        {context && <SnapshotBar context={context} />}

        {/* Last 2 prompts */}
        {context && context.prompts.length > 0 && (
          <div className="space-y-1.5">
            {context.prompts.map((p, i) => (
              <PromptItem key={`${p.timestamp}-${i}`} entry={p} sessionId={sessionId} />
            ))}
          </div>
        )}

        {/* No prompts yet */}
        {context && context.prompts.length === 0 && (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            No prompts recorded yet — start typing to build context
          </p>
        )}

        {/* Loading state */}
        {isLoading && !context && (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Loading context...
          </p>
        )}

        {/* Resume suggestion + collapse toggle */}
        <div className="flex items-center justify-between">
          {context && <ResumeBadge context={context} />}
          <button
            className="text-xs px-2 py-0.5 rounded cursor-pointer"
            style={{
              color: 'var(--text-muted)',
              background: 'transparent',
              border: 'none',
            }}
            onClick={toggleCollapsed}
            aria-label="Collapse context panel"
            aria-expanded={true}
          >
            ▲ Hide
          </button>
        </div>
      </div>
    </div>
  )
}
