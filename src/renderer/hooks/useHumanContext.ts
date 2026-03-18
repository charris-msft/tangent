import { useState, useEffect, useCallback } from 'react'
import type { HumanContext } from '@shared/types'

const COLLAPSED_KEY = 'tangent:contextPanel:collapsed'

/**
 * Hook for subscribing to human context updates for the active session.
 * Manages collapsed/expanded state persisted in localStorage.
 */
export function useHumanContext(sessionId: string | null) {
  const [context, setContext] = useState<HumanContext | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === 'true'
    } catch {
      return false
    }
  })

  // Fetch context when active session changes
  useEffect(() => {
    if (!sessionId) {
      setContext(null)
      return
    }

    setIsLoading(true)
    window.tangentAPI.context.get(sessionId).then((ctx: HumanContext | null) => {
      setContext(ctx)
      setIsLoading(false)
    }).catch(() => {
      setIsLoading(false)
    })
  }, [sessionId])

  // Subscribe to real-time context updates
  useEffect(() => {
    if (!sessionId) return

    const unsub = window.tangentAPI.context.onUpdated((ctx: HumanContext) => {
      if (ctx.sessionId === sessionId) {
        setContext(ctx)
      }
    })

    return () => unsub()
  }, [sessionId])

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed(prev => {
      const next = !prev
      try {
        localStorage.setItem(COLLAPSED_KEY, String(next))
      } catch { /* */ }
      return next
    })
  }, [])

  return { context, isLoading, isCollapsed, toggleCollapsed }
}
