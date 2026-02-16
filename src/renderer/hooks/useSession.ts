import { useState, useEffect, useCallback } from 'react'
import type { Session } from '@shared/types'

declare global {
  interface Window {
    tangentAPI: any
  }
}

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    window.tangentAPI.session.getAll().then((all: Session[]) => {
      setSessions(all)
      if (all.length > 0 && !activeId) {
        setActiveId(all[0].id)
      }
    })

    const unsubCreated = window.tangentAPI.session.onCreated((session: Session) => {
      setSessions(prev => [...prev, session])
      setActiveId(session.id)
    })

    const unsubUpdated = window.tangentAPI.session.onUpdated((session: Session) => {
      setSessions(prev => prev.map(s => s.id === session.id ? session : s))
    })

    const unsubClosed = window.tangentAPI.session.onClosed((sessionId: string) => {
      setSessions(prev => {
        const next = prev.filter(s => s.id !== sessionId)
        // Auto-select nearest session if the closed one was active
        setActiveId(currentActive => {
          if (currentActive === sessionId) {
            const oldIndex = prev.findIndex(s => s.id === sessionId)
            if (next.length === 0) return null
            const newIndex = Math.min(oldIndex, next.length - 1)
            return next[newIndex].id
          }
          return currentActive
        })
        return next
      })
    })

    return () => {
      unsubCreated()
      unsubUpdated()
      unsubClosed()
    }
  }, [])

  const createSession = useCallback(async () => {
    const session = await window.tangentAPI.session.create()
    return session
  }, [])

  const selectSession = useCallback((id: string) => {
    setActiveId(id)
    window.tangentAPI.session.select(id)
  }, [])

  const closeSession = useCallback((id: string) => {
    window.tangentAPI.session.close(id)
  }, [])

  const renameSession = useCallback((id: string, name: string) => {
    window.tangentAPI.session.rename(id, name)
  }, [])

  return {
    sessions,
    activeId,
    activeSession: sessions.find(s => s.id === activeId),
    createSession,
    selectSession,
    closeSession,
    renameSession
  }
}
