import { useEffect, useCallback } from 'react'

export interface GlobalShortcutsConfig {
  onPopOutActive: () => void
  onExplode: () => void
  onCollapseAll: () => void
}

/**
 * Global keyboard shortcuts for window management.
 *
 * Shortcuts:
 *   Ctrl+Shift+P    Pop out active session into a separate window
 *   Ctrl+Shift+E    Explode — pop out all eligible sessions
 *   Ctrl+Shift+C    Collapse all popped-out windows back
 */
export function useGlobalShortcuts(config: GlobalShortcutsConfig): void {
  const { onPopOutActive, onExplode, onCollapseAll } = config

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey || e.altKey) return

      const key = e.key.toUpperCase()

      if (key === 'P') {
        e.preventDefault()
        onPopOutActive()
        return
      }

      if (key === 'E') {
        e.preventDefault()
        onExplode()
        return
      }

      if (key === 'C') {
        e.preventDefault()
        onCollapseAll()
        return
      }
    },
    [onPopOutActive, onExplode, onCollapseAll]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [handleKeyDown])
}
