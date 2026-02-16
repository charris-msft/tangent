import { useEffect, useCallback } from 'react'
import type { Session } from '@shared/types'
import { ZOOM } from '@shared/constants'
import { terminalRegistry } from '@/components/Terminal/TerminalViewport'

export interface KeyboardConfig {
  createSession: () => void
  closeSession: (id: string) => void
  selectSession: (id: string) => void
  sessions: Session[]
  activeId: string | null
  fontSize: number
  setFontSize: (fn: (prev: number) => number) => void
  toggleSessionsPanel: () => void
  toggleSidebar: () => void
  launchAgentByIndex: (index: number) => void
}

/**
 * Global keyboard shortcut handler for Tangent.
 *
 * Shortcuts:
 *   Ctrl+B          Toggle sessions panel visibility
 *   Ctrl+N          New session
 *   Ctrl+W          Close active session
 *   Ctrl+Tab        Next session
 *   Ctrl+Shift+Tab  Previous session
 *   Ctrl+=          Zoom in
 *   Ctrl+-          Zoom out
 *   Ctrl+0          Reset zoom
 *   Ctrl+Shift+1-9  Quick-launch agent by index
 *
 * Right-click on terminal:
 *   Selected text -> copy
 *   No selection  -> paste
 */
export function useKeyboard(config: KeyboardConfig): void {
  const {
    createSession,
    closeSession,
    selectSession,
    sessions,
    activeId,
    setFontSize,
    toggleSessionsPanel,
    toggleSidebar,
    launchAgentByIndex
  } = config

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Only handle Ctrl+ shortcuts (or Ctrl+Shift+)
      if (!e.ctrlKey) return

      const key = e.key

      // Ctrl+V: paste from clipboard into active terminal
      if ((key === 'v' || key === 'V') && !e.shiftKey && !e.altKey) {
        if (activeId) {
          e.preventDefault()
          navigator.clipboard.readText().then(text => {
            if (text) {
              window.tangentAPI.terminal.write(activeId, text)
            }
          }).catch(() => {})
        }
        return
      }

      // Ctrl+B: toggle sessions panel
      if (key === 'b' || key === 'B') {
        if (!e.shiftKey && !e.altKey) {
          e.preventDefault()
          toggleSessionsPanel()
          return
        }
      }

      // Ctrl+N: new session
      if ((key === 'n' || key === 'N') && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        createSession()
        return
      }

      // Ctrl+W: close active session
      if ((key === 'w' || key === 'W') && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        if (activeId) {
          closeSession(activeId)
        }
        return
      }

      // Ctrl+Tab / Ctrl+Shift+Tab: next/prev session
      if (key === 'Tab') {
        if (sessions.length === 0 || !activeId) return
        e.preventDefault()
        const currentIndex = sessions.findIndex(s => s.id === activeId)
        if (currentIndex === -1) return

        let nextIndex: number
        if (e.shiftKey) {
          // Previous session
          nextIndex = currentIndex === 0 ? sessions.length - 1 : currentIndex - 1
        } else {
          // Next session
          nextIndex = currentIndex === sessions.length - 1 ? 0 : currentIndex + 1
        }
        selectSession(sessions[nextIndex].id)
        return
      }

      // Ctrl+= or Ctrl++: zoom in
      if (key === '=' || key === '+') {
        if (!e.shiftKey && !e.altKey) {
          e.preventDefault()
          setFontSize(prev => Math.min(prev + ZOOM.STEP, ZOOM.MAX))
          return
        }
      }

      // Ctrl+-: zoom out
      if (key === '-') {
        if (!e.shiftKey && !e.altKey) {
          e.preventDefault()
          setFontSize(prev => Math.max(prev - ZOOM.STEP, ZOOM.MIN))
          return
        }
      }

      // Ctrl+0: reset zoom
      if (key === '0') {
        if (!e.shiftKey && !e.altKey) {
          e.preventDefault()
          setFontSize(() => ZOOM.DEFAULT)
          return
        }
      }

      // Ctrl+Shift+1-9: quick-launch agent by number
      if (e.shiftKey && !e.altKey) {
        const digitMatch = key.match(/^[1-9]$/)
        if (digitMatch) {
          e.preventDefault()
          const index = parseInt(key, 10) - 1
          launchAgentByIndex(index)
          return
        }
        // Shift+digit often produces !, @, #, etc. Map those too.
        const shiftDigitMap: Record<string, number> = {
          '!': 0, '@': 1, '#': 2, '$': 3, '%': 4,
          '^': 5, '&': 6, '*': 7, '(': 8
        }
        if (key in shiftDigitMap) {
          e.preventDefault()
          launchAgentByIndex(shiftDigitMap[key])
          return
        }
      }
    },
    [
      activeId,
      sessions,
      createSession,
      closeSession,
      selectSession,
      setFontSize,
      toggleSessionsPanel,
      toggleSidebar,
      launchAgentByIndex
    ]
  )

  // Right-click handler for terminal: copy if selected, paste otherwise
  const handleContextMenu = useCallback(
    async (e: MouseEvent) => {
      // Only handle right-clicks on the terminal area
      const target = e.target as HTMLElement
      if (!target.closest('.xterm')) return

      e.preventDefault()

      const terminal = activeId ? terminalRegistry.get(activeId) : null
      const selection = terminal?.getSelection() || ''
      if (selection) {
        // Copy selected text to clipboard, then clear the highlight
        await navigator.clipboard.writeText(selection)
        terminal?.clearSelection()
      } else {
        // Paste from clipboard into active terminal
        if (activeId) {
          try {
            const text = await navigator.clipboard.readText()
            if (text) {
              window.tangentAPI.terminal.write(activeId, text)
            }
          } catch {
            // Clipboard access may be denied
          }
        }
      }
    },
    [activeId]
  )

  useEffect(() => {
    // Use capture phase so shortcuts fire before xterm's bubbling handlers
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    window.addEventListener('contextmenu', handleContextMenu)

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
      window.removeEventListener('contextmenu', handleContextMenu)
    }
  }, [handleKeyDown, handleContextMenu])
}
