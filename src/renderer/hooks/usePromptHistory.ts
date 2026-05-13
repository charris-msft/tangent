import { useState, useEffect, useCallback } from 'react'
import type { TaskTimelineItem, TaskOutcome } from '@shared/types'

declare const tangentAPI: {
  timeline: {
    get: (sessionId: string, opts?: { limit?: number; offset?: number }) => Promise<TaskTimelineItem[]>
    onItemAdded: (callback: (item: TaskTimelineItem) => void) => () => void
    onItemUpdated: (callback: (item: TaskTimelineItem) => void) => () => void
  }
}

interface UsePromptHistoryOptions {
  sessionId: string | undefined
  enabled: boolean
  limit?: number
}

export function usePromptHistory({ sessionId, enabled, limit = 50 }: UsePromptHistoryOptions) {
  const [items, setItems] = useState<TaskTimelineItem[]>([])
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)

  const refresh = useCallback(() => {
    if (!enabled || !sessionId) {
      setItems([])
      setLoading(false)
      setHasMore(false)
      return
    }

    setLoading(true)
    tangentAPI.timeline
      .get(sessionId, { limit })
      .then((result) => {
        setItems(result)
        setHasMore(result.length === limit)
      })
      .catch((err) => {
        console.error('[usePromptHistory] Failed to load timeline:', err)
        setItems([])
        setHasMore(false)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [sessionId, enabled, limit])

  // Initial load and explicit session refresh.
  useEffect(() => {
    refresh()
  }, [refresh])

  // Subscribe to live updates only while enabled
  useEffect(() => {
    if (!enabled || !sessionId) return

    const unsubAdd = tangentAPI.timeline.onItemAdded((item) => {
      if (item.sessionId === sessionId) {
        setItems((prev) => {
          if (prev.some((existing) => existing.id === item.id)) return prev
          return [item, ...prev]
        })
      }
    })

    const unsubUpdate = tangentAPI.timeline.onItemUpdated((item) => {
      if (item.sessionId === sessionId) {
        setItems((prev) => {
          let found = false
          const next = prev.map((existing) => {
            if (existing.id !== item.id) return existing
            found = true
            return item
          })
          return found ? next : [item, ...prev]
        })
      }
    })

    return () => {
      unsubAdd()
      unsubUpdate()
    }
  }, [sessionId, enabled])

  const loadMore = useCallback(() => {
    if (!sessionId || loading || !hasMore) return

    setLoading(true)
    tangentAPI.timeline
      .get(sessionId, { limit, offset: items.length })
      .then((result) => {
        setItems((prev) => [...prev, ...result])
        setHasMore(result.length === limit)
      })
      .catch((err) => {
        console.error('[usePromptHistory] Failed to load more:', err)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [sessionId, loading, hasMore, items.length, limit])

  return { items, loading, hasMore, loadMore, refresh }
}

export function filterByStatus(items: TaskTimelineItem[], filter: TaskOutcome | 'all'): TaskTimelineItem[] {
  if (filter === 'all') return items
  return items.filter((item) => item.status === filter)
}
