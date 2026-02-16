import { useState, useCallback, useRef, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useAgents } from '@/hooks/useAgents'
import { AgentItem } from './AgentItem'
import { AgentForm } from './AgentForm'
import type { AgentProfile, AgentGroup } from '@shared/types'

interface AgentsSidebarProps {
  activeSessionId: string | null
}

export function AgentsSidebar({ activeSessionId }: AgentsSidebarProps) {
  const { groups, saveGroups, launchAgent } = useAgents()
  const [openGroupIndex, setOpenGroupIndex] = useState<number | null>(null)
  const [editingAgent, setEditingAgent] = useState<AgentProfile | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const popupRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)

  const openGroup: AgentGroup | undefined = openGroupIndex !== null ? groups[openGroupIndex] : undefined

  // Ctrl+1-9: toggle agent group tabs
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.shiftKey || e.altKey) return
      const digit = e.key.match(/^[1-9]$/)
      if (!digit) return
      const idx = parseInt(digit[0], 10) - 1
      if (idx >= groups.length) return
      e.preventDefault()
      setOpenGroupIndex(prev => prev === idx ? null : idx)
      setShowForm(false)
      setEditingAgent(null)
    }
    window.addEventListener('keydown', handleKey, { capture: true })
    return () => window.removeEventListener('keydown', handleKey, { capture: true })
  }, [groups.length])

  // Close popup when clicking outside
  useEffect(() => {
    if (openGroupIndex === null) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (popupRef.current?.contains(target)) return
      if (tabsRef.current?.contains(target)) return
      setOpenGroupIndex(null)
      setShowForm(false)
      setEditingAgent(null)
    }
    window.addEventListener('mousedown', handleClick)
    return () => window.removeEventListener('mousedown', handleClick)
  }, [openGroupIndex])

  // --- Tab click ---
  const handleTabClick = useCallback((index: number) => {
    setOpenGroupIndex(prev => {
      if (prev === index) return null // toggle off
      return index
    })
    setShowForm(false)
    setEditingAgent(null)
  }, [])

  // --- Group operations ---

  const addGroup = useCallback(() => {
    const newGroup: AgentGroup = {
      id: uuidv4(),
      name: `Group ${groups.length + 1}`,
      agents: []
    }
    const updated = [...groups, newGroup]
    saveGroups(updated)
    setOpenGroupIndex(updated.length - 1)
  }, [groups, saveGroups])

  const deleteGroup = useCallback((groupId: string) => {
    const updated = groups.filter(g => g.id !== groupId)
    saveGroups(updated)
    setOpenGroupIndex(null)
  }, [groups, saveGroups])

  const handleSetGroupIcon = useCallback(async (groupId: string) => {
    const selected = await (window as any).tangentAPI.dialog.openFile([
      { name: 'Icons', extensions: ['ico', 'png'] }
    ])
    if (selected) {
      const updated = groups.map(g =>
        g.id === groupId ? { ...g, iconPath: selected } : g
      )
      saveGroups(updated)
    }
  }, [groups, saveGroups])

  const handleClearGroupIcon = useCallback((groupId: string) => {
    const updated = groups.map(g =>
      g.id === groupId ? { ...g, iconPath: undefined } : g
    )
    saveGroups(updated)
  }, [groups, saveGroups])

  const startRenameGroup = useCallback((group: AgentGroup) => {
    setRenamingGroupId(group.id)
    setRenameValue(group.name)
  }, [])

  const commitRenameGroup = useCallback(() => {
    if (!renamingGroupId) return
    const trimmed = renameValue.trim()
    if (!trimmed) {
      setRenamingGroupId(null)
      return
    }
    const updated = groups.map(g =>
      g.id === renamingGroupId ? { ...g, name: trimmed } : g
    )
    saveGroups(updated)
    setRenamingGroupId(null)
  }, [renamingGroupId, renameValue, groups, saveGroups])

  // --- Agent operations ---

  const handleLaunch = useCallback((agentId: string) => {
    if (!activeSessionId) return
    launchAgent(agentId, activeSessionId)
    setOpenGroupIndex(null)
  }, [activeSessionId, launchAgent])

  const handleSaveAgent = useCallback((agent: AgentProfile) => {
    if (!openGroup || openGroupIndex === null) return

    const existingIndex = openGroup.agents.findIndex(a => a.id === agent.id)
    let updatedAgents: AgentProfile[]
    if (existingIndex >= 0) {
      updatedAgents = openGroup.agents.map(a => a.id === agent.id ? agent : a)
    } else {
      updatedAgents = [...openGroup.agents, agent]
    }

    const updated = groups.map((g, i) =>
      i === openGroupIndex ? { ...g, agents: updatedAgents } : g
    )
    saveGroups(updated)
    setShowForm(false)
    setEditingAgent(null)
  }, [openGroup, openGroupIndex, groups, saveGroups])

  const handleDeleteAgent = useCallback((agentId: string) => {
    if (!openGroup || openGroupIndex === null) return
    const updatedAgents = openGroup.agents.filter(a => a.id !== agentId)
    const updated = groups.map((g, i) =>
      i === openGroupIndex ? { ...g, agents: updatedAgents } : g
    )
    saveGroups(updated)
  }, [openGroup, openGroupIndex, groups, saveGroups])

  const handleMoveAgent = useCallback((agentId: string, direction: 'up' | 'down') => {
    if (!openGroup || openGroupIndex === null) return
    const idx = openGroup.agents.findIndex(a => a.id === agentId)
    if (idx < 0) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= openGroup.agents.length) return

    const updatedAgents = [...openGroup.agents]
    const temp = updatedAgents[idx]
    updatedAgents[idx] = updatedAgents[swapIdx]
    updatedAgents[swapIdx] = temp

    const updated = groups.map((g, i) =>
      i === openGroupIndex ? { ...g, agents: updatedAgents } : g
    )
    saveGroups(updated)
  }, [openGroup, openGroupIndex, groups, saveGroups])

  const handleEditAgent = useCallback((agent: AgentProfile) => {
    setEditingAgent(agent)
    setShowForm(true)
  }, [])

  const handleCancelForm = useCallback(() => {
    setShowForm(false)
    setEditingAgent(null)
  }, [])

  return (
    <div className="flex h-full shrink-0">
      {/* Popup panel (appears to the left of tabs) */}
      {openGroupIndex !== null && openGroup && (
        <div
          ref={popupRef}
          className="w-[240px] h-full flex flex-col border-l border-[var(--bg-hover)]"
          style={{ background: 'var(--bg-secondary)' }}
        >
          {/* Group header */}
          <div className="flex items-center justify-between p-3 border-b border-[var(--bg-hover)]">
            {renamingGroupId === openGroup.id ? (
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRenameGroup()
                  if (e.key === 'Escape') setRenamingGroupId(null)
                }}
                onBlur={commitRenameGroup}
                autoFocus
                className="text-sm px-2 py-0.5 rounded border border-[var(--accent)] outline-none flex-1 mr-2"
                style={{
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)'
                }}
              />
            ) : (
              <span
                className="text-sm font-medium truncate"
                style={{ color: 'var(--text-primary)' }}
              >
                {openGroup.name}
              </span>
            )}
            <div className="flex items-center gap-1 shrink-0">
              {openGroup.iconPath ? (
                <button
                  onClick={() => handleClearGroupIcon(openGroup.id)}
                  className="text-xs px-1 py-0.5 rounded hover:bg-[var(--bg-hover)] transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                  title="Remove icon"
                >
                  &#128465;
                </button>
              ) : (
                <button
                  onClick={() => handleSetGroupIcon(openGroup.id)}
                  className="text-xs px-1 py-0.5 rounded hover:bg-[var(--bg-hover)] transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                  title="Set icon"
                >
                  &#128247;
                </button>
              )}
              <button
                onClick={() => startRenameGroup(openGroup)}
                className="text-xs px-1 py-0.5 rounded hover:bg-[var(--bg-hover)] transition-colors"
                style={{ color: 'var(--text-muted)' }}
                title="Rename group"
              >
                &#9998;
              </button>
              {groups.length > 1 && (
                <button
                  onClick={() => deleteGroup(openGroup.id)}
                  className="text-xs px-1 py-0.5 rounded hover:bg-[var(--bg-hover)] transition-colors"
                  style={{ color: 'var(--error)' }}
                  title="Delete group"
                >
                  &times;
                </button>
              )}
            </div>
          </div>

          {/* Agents list */}
          <div className="flex-1 overflow-y-auto px-1 py-1">
            {openGroup.agents.length > 0 ? (
              openGroup.agents.map((agent, idx) => (
                <AgentItem
                  key={agent.id}
                  agent={agent}
                  index={idx}
                  onLaunch={() => handleLaunch(agent.id)}
                  onEdit={handleEditAgent}
                  onDelete={handleDeleteAgent}
                  onMoveUp={() => handleMoveAgent(agent.id, 'up')}
                  onMoveDown={() => handleMoveAgent(agent.id, 'down')}
                />
              ))
            ) : (
              <div
                className="text-xs p-3 text-center"
                style={{ color: 'var(--text-muted)' }}
              >
                No agents in this group
              </div>
            )}
          </div>

          {/* Form or Add button */}
          {showForm ? (
            <AgentForm
              initialValues={editingAgent ?? undefined}
              onSave={handleSaveAgent}
              onCancel={handleCancelForm}
            />
          ) : (
            <div className="p-2 border-t border-[var(--bg-hover)]">
              <button
                onClick={() => { setEditingAgent(null); setShowForm(true) }}
                className="w-full px-2 py-1.5 text-sm rounded border border-[var(--bg-hover)] hover:bg-[var(--bg-hover)] transition-colors"
                style={{ color: 'var(--text-secondary)' }}
              >
                + Add Agent
              </button>
            </div>
          )}
        </div>
      )}

      {/* Vertical tab strip */}
      <div
        ref={tabsRef}
        className="w-11 min-w-11 h-full flex flex-col items-center py-2 gap-0.5 shrink-0 border-l border-[var(--bg-hover)]"
        style={{ background: 'var(--bg-secondary)' }}
      >
        {groups.map((group, idx) => (
          <AgentTab
            key={group.id}
            name={group.name}
            iconPath={group.iconPath}
            isOpen={openGroupIndex === idx}
            onClick={() => handleTabClick(idx)}
          />
        ))}

        {/* Add group button */}
        <button
          onClick={addGroup}
          className="w-8 h-8 flex items-center justify-center rounded transition-all"
          style={{
            color: 'var(--text-muted)',
            opacity: 0.7
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '1' }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.7' }}
          title="Add group"
          aria-label="Add group"
        >
          <span className="text-lg">+</span>
        </button>
      </div>
    </div>
  )
}

// --- Helpers ---

// Split "🤖 Copilot" into { emoji: "🤖", text: "Copilot" }
// Uses Extended_Pictographic to catch emoji that default to text presentation (e.g. 🕵️ U+1F575)
const EMOJI_RE = /^([\p{Emoji_Presentation}\p{Extended_Pictographic}][\u{FE00}-\u{FE0F}\u{200D}\p{Emoji_Presentation}\p{Extended_Pictographic}]*)\s*/u

function parseGroupName(name: string): { emoji: string | null; text: string } {
  const m = name.match(EMOJI_RE)
  if (m) {
    return { emoji: m[1], text: name.slice(m[0].length) }
  }
  return { emoji: null, text: name }
}

// --- Vertical Tab Component ---

function AgentTab({ name, iconPath, isOpen, onClick }: { name: string; iconPath?: string; isOpen: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  const { emoji, text } = parseGroupName(name)
  const initial = text.charAt(0).toUpperCase()
  const active = isOpen || hovered

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="w-9 flex flex-col items-center gap-1 py-2 rounded cursor-pointer"
      style={{
        background: isOpen ? 'var(--bg-hover)' : hovered ? 'rgba(255,255,255,0.06)' : 'transparent',
        borderLeft: isOpen ? '2px solid var(--accent)' : hovered ? '2px solid rgba(255,255,255,0.3)' : '2px solid transparent',
        transition: 'background 150ms ease, border-color 150ms ease'
      }}
      title={name}
    >
      {/* Icon: .ico/.png file, emoji, or first letter */}
      {iconPath ? (
        <div
          className="w-7 h-7 rounded flex items-center justify-center shrink-0 overflow-hidden"
          style={{
            background: isOpen ? 'var(--accent)' : active ? 'var(--bg-tertiary)' : 'transparent',
            transition: 'background 150ms ease'
          }}
        >
          <img
            src={`tangent-file:///${iconPath.replace(/\\/g, '/')}`}
            alt={name}
            className="w-5 h-5 object-contain"
            draggable={false}
          />
        </div>
      ) : (
        <div
          className="w-7 h-7 rounded flex items-center justify-center shrink-0"
          style={{
            fontSize: emoji ? '16px' : '12px',
            fontWeight: emoji ? 'normal' : 'bold',
            background: isOpen ? 'var(--accent)' : active ? 'var(--bg-tertiary)' : 'transparent',
            color: isOpen ? '#fff' : active ? 'var(--text-primary)' : 'var(--text-muted)',
            transition: 'background 150ms ease, color 150ms ease'
          }}
        >
          {emoji ?? initial}
        </div>
      )}
      {/* Vertical text (emoji stripped) */}
      <span
        className="text-[9px] uppercase tracking-widest leading-tight font-medium"
        style={{
          writingMode: 'vertical-rl',
          transform: 'rotate(180deg)',
          color: active ? 'var(--text-primary)' : 'var(--text-muted)',
          maxHeight: '65px',
          overflow: 'hidden',
          transition: 'color 150ms ease'
        }}
      >
        {text}
      </span>
    </button>
  )
}
