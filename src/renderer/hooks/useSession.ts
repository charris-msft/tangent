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
  const [poppedOutSessionIds, setPoppedOutSessionIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    window.tangentAPI.session.getAll().then((all: Session[]) => {
      setSessions(all)
      if (all.length > 0 && !activeId) {
        setActiveId(all[0].id)
      }
    })

    // Hydrate popout state from main process
    const winApi = (window.tangentAPI as any)?.window
    winApi?.getPoppedSessionIds?.().then((ids: string[]) => {
      if (Array.isArray(ids) && ids.length > 0) {
        setPoppedOutSessionIds(new Set(ids))
      }
    }).catch(() => {})

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
      // Clean up popout tracking for closed sessions
      setPoppedOutSessionIds(prev => {
        if (!prev.has(sessionId)) return prev
        const next = new Set(prev)
        next.delete(sessionId)
        return next
      })
    })

    // Subscribe to popout lifecycle events from main
    const unsubPopped = winApi?.onPoppedOut?.((sessionId: string) => {
      setPoppedOutSessionIds(prev => {
        if (prev.has(sessionId)) return prev
        const next = new Set(prev)
        next.add(sessionId)
        return next
      })
    })
    const unsubPulled = winApi?.onPulledBack?.((sessionId: string) => {
      setPoppedOutSessionIds(prev => {
        if (!prev.has(sessionId)) return prev
        const next = new Set(prev)
        next.delete(sessionId)
        return next
      })
    })
    const unsubCollapsed = winApi?.onCollapsedAll?.(() => {
      setPoppedOutSessionIds(new Set())
    })

    return () => {
      unsubCreated()
      unsubUpdated()
      unsubClosed()
      unsubPopped?.()
      unsubPulled?.()
      unsubCollapsed?.()
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

  const popOutSession = useCallback(async (id: string, bounds?: { x?: number; y?: number; width: number; height: number }) => {
    const winApi = (window.tangentAPI as any)?.window
    if (!winApi?.popOut) return false
    const ok = await winApi.popOut(id, bounds)
    // The 'poppedOut' event listener will update state; but also update
    // optimistically in case the event is coalesced with tiling.
    if (ok) {
      setPoppedOutSessionIds(prev => {
        if (prev.has(id)) return prev
        const next = new Set(prev)
        next.add(id)
        return next
      })
    }
    return ok
  }, [])

  const pullBackSession = useCallback(async (id: string) => {
    const winApi = (window.tangentAPI as any)?.window
    if (!winApi?.pullBack) return
    await winApi.pullBack(id)
    setPoppedOutSessionIds(prev => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  return {
    sessions,
    activeId,
    activeSession: sessions.find(s => s.id === activeId),
    poppedOutSessionIds,
    createSession,
    selectSession,
    closeSession,
    renameSession,
    popOutSession,
    pullBackSession
  }
}
