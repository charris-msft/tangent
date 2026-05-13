import { useState, useCallback } from 'react'
import type { TaskTimelineItem } from '@shared/types'

interface PromptCardProps {
  item: TaskTimelineItem
}

function formatTimestamp(ts: number): string {
  const date = new Date(ts)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()

  if (isToday) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatDuration(startedAt: number, completedAt?: number): string {
  const end = completedAt || Date.now()
  const durationMs = end - startedAt
  const seconds = Math.floor(durationMs / 1000)

  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function stripControlChars(text: string | undefined): string {
  if (!text) return ''
  return text
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[P^_][^\x1b]*(?:\x1b\\|\x07)/g, '')
    .replace(/\x1b[()][0-9A-Za-z]/g, '')
    .replace(/\x1b[@-Z\\-_]/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
    .trim()
}

function getStatusColor(status: TaskTimelineItem['status']): string {
  switch (status) {
    case 'in-progress':
      return 'var(--running)'
    case 'success':
      return 'var(--idle)'
    case 'partial':
      return 'var(--attention)'
    case 'error':
      return 'var(--error)'
    case 'interrupted':
      return 'var(--attention)'
    default:
      return 'var(--text-muted)'
  }
}

function getStatusLabel(status: TaskTimelineItem['status']): string {
  switch (status) {
    case 'in-progress':
      return 'Running'
    case 'success':
      return 'Success'
    case 'partial':
      return 'Partial'
    case 'error':
      return 'Error'
    case 'interrupted':
      return 'Interrupted'
    default:
      return status
  }
}

export function PromptCard({ item }: PromptCardProps) {
  const [expanded, setExpanded] = useState(false)
  const promptText = stripControlChars(item.promptText)
  const responseText = stripControlChars(
    expanded && item.fullResponse ? item.fullResponse : item.responseSummary
  )
  const fullCopyResponse = stripControlChars(item.fullResponse || item.responseSummary)
  const errorMessage = stripControlChars(item.errorMessage)

  const handleCopyPrompt = useCallback(() => {
    void navigator.clipboard.writeText(promptText)
  }, [promptText])

  const handleCopyResponse = useCallback(() => {
    void navigator.clipboard.writeText(fullCopyResponse)
  }, [fullCopyResponse])

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => !prev)
  }, [])

  return (
    <div
      className="border border-[var(--bg-hover)] rounded p-3 mb-2"
      style={{
        background: 'var(--bg-secondary)',
        contentVisibility: 'auto'
      }}
    >
      <div className="flex items-start gap-2 mb-2">
        <button
          onClick={toggleExpanded}
          className="shrink-0 cursor-pointer hover:text-[var(--text-primary)]"
          style={{
            color: 'var(--text-secondary)',
            background: 'none',
            border: 'none',
            padding: 0,
            font: 'inherit',
            fontSize: 'inherit',
          }}
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? '▼' : '▶'}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className="inline-block px-1.5 py-0.5 rounded text-xs font-medium"
              style={{
                background: 'var(--bg-tertiary)',
                color: getStatusColor(item.status),
              }}
            >
              {getStatusLabel(item.status)}
            </span>
            <span style={{ color: 'var(--text-muted)' }} className="text-xs">
              {formatTimestamp(item.promptTimestamp)}
            </span>
            {item.completedAt && (
              <span style={{ color: 'var(--text-muted)' }} className="text-xs">
                • {formatDuration(item.startedAt, item.completedAt)}
              </span>
            )}
            {item.toolsUsed.length > 0 && (
              <span style={{ color: 'var(--text-muted)' }} className="text-xs">
                • {item.toolsUsed.length} tool{item.toolsUsed.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div
            className="text-sm mb-1 whitespace-pre-wrap break-words"
            style={{
              color: 'var(--text-primary)',
              ...(expanded ? {} : {
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }),
            }}
          >
            {promptText}
          </div>
          {responseText && (
            <div
              className="text-sm whitespace-pre-wrap break-words"
              style={{
                color: 'var(--text-secondary)',
                ...(expanded ? {} : {
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }),
              }}
            >
              {responseText}
            </div>
          )}
          {errorMessage && (
            <div
              className="text-sm mt-1 whitespace-pre-wrap break-words"
              style={{ color: 'var(--error)' }}
            >
              {errorMessage}
            </div>
          )}
        </div>
      </div>
      {expanded && (
        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-[var(--bg-hover)]">
          <button
            onClick={handleCopyPrompt}
            className="px-2 py-1 text-xs rounded cursor-pointer hover:bg-[var(--bg-hover)]"
            style={{
              background: 'var(--bg-tertiary)',
              color: 'var(--text-secondary)',
              border: 'none',
            }}
          >
            Copy Prompt
          </button>
          {fullCopyResponse && (
            <button
              onClick={handleCopyResponse}
              className="px-2 py-1 text-xs rounded cursor-pointer hover:bg-[var(--bg-hover)]"
              style={{
                background: 'var(--bg-tertiary)',
                color: 'var(--text-secondary)',
                border: 'none',
              }}
            >
              Copy Response
            </button>
          )}
        </div>
      )}
    </div>
  )
}
