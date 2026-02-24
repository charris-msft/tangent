import { useState, useEffect, useRef } from 'react'
import type { ToolUseEntry } from '@shared/types'

declare global {
  interface Window {
    tangentAPI: {
      tooluse: {
        getAll: (sessionId: string) => Promise<ToolUseEntry[]>
        onEntry: (cb: (entry: ToolUseEntry) => void) => () => void
      }
      [key: string]: any
    }
  }
}

/**
 * Hook that provides a live stream of tool use entries for the active session.
 * Entries are sorted chronologically (oldest first).
 */
export function useToolUse(activeSessionId: string | null) {
  const [entries, setEntries] = useState<ToolUseEntry[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  // Load existing entries when session changes
  useEffect(() => {
    if (!activeSessionId) {
      setEntries([])
      return
    }
    window.tangentAPI.tooluse.getAll(activeSessionId).then(setEntries)
  }, [activeSessionId])

  // Subscribe to new entries
  useEffect(() => {
    if (!activeSessionId) return

    const unsub = window.tangentAPI.tooluse.onEntry((entry: ToolUseEntry) => {
      if (entry.sessionId !== activeSessionId) return

      setEntries(prev => {
        const idx = prev.findIndex(e => e.id === entry.id)
        if (idx >= 0) {
          // Update existing entry
          const updated = [...prev]
          updated[idx] = entry
          return updated
        }
        // Add new entry
        return [...prev, entry]
      })
    })

    return unsub
  }, [activeSessionId])

  // Auto-scroll when new entries arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [entries.length])

  return { entries, scrollRef }
}
