import { useState } from 'react'
import type { AgentProfile } from '@shared/types'

interface AgentItemProps {
  agent: AgentProfile
  index: number
  onLaunch: () => void
  onEdit: (agent: AgentProfile) => void
  onDelete: (id: string) => void
  onMoveUp: () => void
  onMoveDown: () => void
}

export function AgentItem({
  agent,
  index,
  onLaunch,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown
}: AgentItemProps) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer group"
      style={{
        transition: 'background 200ms ease'
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onLaunch}
    >
      {/* Number badge */}
      <span
        className="text-xs font-mono w-5 h-5 flex items-center justify-center rounded shrink-0"
        style={{
          color: hovered ? 'var(--accent)' : 'var(--text-muted)',
          background: hovered ? 'rgba(88, 166, 255, 0.1)' : 'transparent',
          transition: 'color 200ms ease, background 200ms ease'
        }}
      >
        {index + 1}
      </span>

      {/* Agent info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            className="text-sm truncate"
            style={{ color: 'var(--text-primary)' }}
          >
            {agent.name}
          </span>
          {agent.launchTarget !== 'currentTab' && (
            <span
              className="text-[10px] px-1 py-0 rounded shrink-0"
              style={{
                background: 'var(--bg-tertiary)',
                color: 'var(--text-muted)'
              }}
              title={agent.launchTarget === 'path' ? agent.cwdPath : undefined}
            >
              {agent.launchTarget === 'path' ? 'path' : 'tab'}
            </span>
          )}
        </div>
        <div
          className="text-xs truncate"
          style={{ color: 'var(--text-muted)' }}
        >
          {agent.command}{agent.args.length > 0 ? ' ' + agent.args.join(' ') : ''}
        </div>
      </div>

      {/* Action buttons (visible on hover) */}
      <div
        className="flex items-center gap-0.5 shrink-0"
        style={{
          opacity: hovered ? 1 : 0,
          transition: 'opacity 200ms ease'
        }}
      >
        <button
          onClick={(e) => { e.stopPropagation(); onMoveUp() }}
          className="text-xs px-1 py-0.5 rounded hover:bg-[var(--bg-hover)]"
          style={{ color: 'var(--text-muted)' }}
          title="Move up"
        >
          &#9650;
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onMoveDown() }}
          className="text-xs px-1 py-0.5 rounded hover:bg-[var(--bg-hover)]"
          style={{ color: 'var(--text-muted)' }}
          title="Move down"
        >
          &#9660;
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(agent) }}
          className="text-xs px-1 py-0.5 rounded hover:bg-[var(--bg-hover)]"
          style={{ color: 'var(--text-muted)' }}
          title="Edit"
        >
          &#9998;
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(agent.id) }}
          className="text-xs px-1 py-0.5 rounded hover:bg-[var(--bg-hover)]"
          style={{ color: 'var(--error)' }}
          title="Delete"
        >
          &times;
        </button>
      </div>
    </div>
  )
}
