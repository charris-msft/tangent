import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import { SdkLineBuffer } from '@shared/SdkLineBuffer'
import type { SessionKind } from '@shared/types'

// Global registry so other modules (useKeyboard) can access terminal instances
export const terminalRegistry = new Map<string, Terminal>()
// Search addon registry for keyboard handler access
export const searchRegistry = new Map<string, SearchAddon>()

interface TerminalViewportProps {
  sessions: { id: string; kind: SessionKind }[]
  activeId: string | null
  fontSize: number
}

interface TerminalInstance {
  terminal: Terminal
  fitAddon: FitAddon
  searchAddon: SearchAddon
  div: HTMLDivElement
  cleanup: () => void
}

export function TerminalViewport({ sessions, activeId, fontSize }: TerminalViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const instancesRef = useRef<Map<string, TerminalInstance>>(new Map())
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Toggle search bar
  const toggleSearch = () => {
    setSearchOpen(prev => {
      if (!prev) {
        setTimeout(() => searchInputRef.current?.focus(), 50)
      } else {
        // Clear highlights when closing
        if (activeId) {
          const inst = instancesRef.current.get(activeId)
          inst?.searchAddon.clearDecorations()
        }
        setSearchQuery('')
      }
      return !prev
    })
  }

  const doSearch = (query: string, direction: 'next' | 'prev' = 'next') => {
    if (!activeId || !query) return
    const inst = instancesRef.current.get(activeId)
    if (!inst) return
    if (direction === 'next') {
      inst.searchAddon.findNext(query, { caseSensitive: false, regex: false })
    } else {
      inst.searchAddon.findPrevious(query, { caseSensitive: false, regex: false })
    }
  }

  // Create/destroy terminal instances as sessions change
  useEffect(() => {
    const currentIds = new Set(sessions.map(s => s.id))
    const instances = instancesRef.current

    // Remove terminals for closed sessions
    for (const [id, inst] of instances) {
      if (!currentIds.has(id)) {
        inst.cleanup()
        inst.terminal.dispose()
        inst.div.remove()
        instances.delete(id)
        terminalRegistry.delete(id)
        searchRegistry.delete(id)
      }
    }

    // Create terminals for new sessions
    for (const session of sessions) {
      if (!instances.has(session.id) && containerRef.current) {
        const terminal = new Terminal({
          fontFamily: "'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace",
          fontSize,
          theme: {
            background: '#0d1117',
            foreground: '#e6edf3',
            cursor: '#58a6ff',
            selectionBackground: '#264f78',
            black: '#484f58',
            red: '#ff7b72',
            green: '#3fb950',
            yellow: '#d29922',
            blue: '#58a6ff',
            magenta: '#bc8cff',
            cyan: '#39d353',
            white: '#e6edf3'
          },
          cursorBlink: true,
          allowProposedApi: true
        })
        const fitAddon = new FitAddon()
        terminal.loadAddon(fitAddon)
        const searchAddon = new SearchAddon()
        terminal.loadAddon(searchAddon)

        const div = document.createElement('div')
        div.style.height = '100%'
        div.style.width = '100%'
        div.style.display = 'none'
        div.dataset.sessionId = session.id
        containerRef.current.appendChild(div)

        terminal.open(div)

        // Intercept app shortcuts BEFORE xterm processes them.
        // Returning false tells xterm to NOT handle the key event,
        // allowing the window-level useKeyboard handler to process it.
        let sdkLineBuffer: SdkLineBuffer | null = null

        terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
          // Shift+Enter: new line (multiline input for agents)
          if (e.shiftKey && e.key === 'Enter' && !e.ctrlKey && !e.altKey && e.type === 'keydown') {
            if (session.kind === 'copilot-sdk' && sdkLineBuffer) {
              sdkLineBuffer.insertNewline()
            } else {
              window.tangentAPI.terminal.write(session.id, '\n')
            }
            return false
          }
          // Ctrl+Backspace: delete previous word (send ^W to PTY)
          if (e.ctrlKey && e.key === 'Backspace' && !e.shiftKey && !e.altKey && e.type === 'keydown') {
            window.tangentAPI.terminal.write(session.id, '\x17')
            return false
          }
          // Ctrl+Enter: new line in Copilot CLI input (send \n instead of \r)
          if (e.ctrlKey && e.key === 'Enter' && !e.shiftKey && !e.altKey && e.type === 'keydown') {
            window.tangentAPI.terminal.write(session.id, '\n')
            return false
          }
          if (!e.ctrlKey) return true
          const key = e.key.toLowerCase()
          // Ctrl+V: handled by useKeyboard (clipboard paste to PTY)
          if (key === 'v' && !e.shiftKey && !e.altKey) return false
          // Ctrl+C: copy selection if any, otherwise send SIGINT (or clear line for SDK)
          if (key === 'c' && !e.shiftKey && !e.altKey && e.type === 'keydown') {
            const selection = terminal.getSelection()
            if (selection) {
              navigator.clipboard.writeText(selection).catch(() => {})
              terminal.clearSelection()
              return false
            }
            return true // No selection — let xterm handle (PTY: ^C, SDK: line buffer handles it)
          }
          // Let xterm ignore these — they're app shortcuts
          if (key === 'b' || key === 'n' || key === 'tab' ||
              key === '=' || key === '+' || key === '-' || key === '0') {
            return false
          }
          // Ctrl+Shift+W: close session (app shortcut, don't send to terminal)
          if (key === 'w' && e.shiftKey) {
            return false
          }
          // Ctrl+Shift+F: terminal search
          if (key === 'f' && e.shiftKey) {
            return false
          }
          // Ctrl+Shift+1-9 for agent quick-launch
          if (e.shiftKey && /^[1-9!@#$%^&*(]$/.test(e.key)) {
            return false
          }
          return true
        })

        const cleanupFns: (() => void)[] = []

        if (session.kind === 'copilot-sdk') {
          // === SDK session: line-buffered input, SDK output ===
          const sessionId = session.id
          sdkLineBuffer = new SdkLineBuffer(
            (data) => terminal.write(data),
            (line) => {
              window.tangentAPI.sdk.sendMessage(sessionId, line)
              // Record prompt for the human context panel
              window.tangentAPI.context.recordPrompt(sessionId, line, 'sdk')
            }
          )

          // SDK output → terminal display
          const unsubSdkOutput = window.tangentAPI.sdk.onOutput(session.id, (data: string) => {
            terminal.write(data)
          })
          cleanupFns.push(unsubSdkOutput)

          // User keystrokes → line buffer (local echo + send on Enter)
          const onDataDisposable = terminal.onData((data) => {
            sdkLineBuffer!.handleInput(data)
          })
          cleanupFns.push(() => onDataDisposable.dispose())
        } else {
          // === PTY session: direct PTY I/O ===
          window.tangentAPI.terminal.attach(session.id)
          const unsubData = window.tangentAPI.terminal.onData(session.id, (data: string) => {
            terminal.write(data)
          })
          cleanupFns.push(unsubData)

          // Forward user input to PTY, with line buffer for prompt capture
          let inputBuffer = ''
          let inEscSeq = false
          const onDataDisposable = terminal.onData((data) => {
            window.tangentAPI.terminal.write(session.id, data)

            // Build a line buffer to capture prompts for the context panel.
            // When the user presses Enter, record accumulated text as a prompt.
            for (const ch of data) {
              const code = ch.charCodeAt(0)

              // Track escape sequences (ESC [ ... letter) to avoid capturing them
              if (ch === '\x1b') {
                inEscSeq = true
                continue
              }
              if (inEscSeq) {
                // CSI sequences end with a letter (A-Z, a-z)
                if (/[A-Za-z~]/.test(ch)) inEscSeq = false
                continue
              }

              if (ch === '\r' || ch === '\n') {
                const trimmed = inputBuffer.trim()
                if (trimmed.length >= 2) {
                  window.tangentAPI.context.recordPrompt(session.id, trimmed, 'terminal')
                }
                inputBuffer = ''
              } else if (ch === '\x7f' || ch === '\b') {
                inputBuffer = inputBuffer.slice(0, -1)
              } else if (code >= 32) {
                inputBuffer += ch
              } else {
                // Control characters (Ctrl+C, etc.) — reset
                inputBuffer = ''
              }
            }
          })
          cleanupFns.push(() => onDataDisposable.dispose())

          // Report resize
          const onResizeDisposable = terminal.onResize(({ cols, rows }) => {
            window.tangentAPI.terminal.resize(session.id, cols, rows)
          })
          cleanupFns.push(() => onResizeDisposable.dispose())
        }

        instances.set(session.id, {
          terminal,
          fitAddon,
          searchAddon,
          div,
          cleanup: () => cleanupFns.forEach(fn => fn())
        })
        terminalRegistry.set(session.id, terminal)
        searchRegistry.set(session.id, searchAddon)
      }
    }
  }, [sessions, fontSize])

  // Show/hide terminals based on active session
  useEffect(() => {
    const instances = instancesRef.current
    for (const [id, inst] of instances) {
      if (id === activeId) {
        inst.div.style.display = 'block'
        // Small delay to let DOM render before fitting
        requestAnimationFrame(() => {
          inst.fitAddon.fit()
          inst.terminal.focus()
        })
      } else {
        inst.div.style.display = 'none'
      }
    }
  }, [activeId])

  // Handle container resize
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver(() => {
      const inst = activeId ? instancesRef.current.get(activeId) : null
      if (inst) {
        inst.fitAddon.fit()
      }
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [activeId])

  // Update font size across all terminals
  useEffect(() => {
    for (const [, inst] of instancesRef.current) {
      inst.terminal.options.fontSize = fontSize
      inst.fitAddon.fit()
    }
  }, [fontSize])

  // Listen for Ctrl+Shift+F globally to toggle search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        toggleSearch()
      }
      // Escape closes search
      if (e.key === 'Escape' && searchOpen) {
        e.preventDefault()
        toggleSearch()
      }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [searchOpen])

  return (
    <div className="flex-1 min-w-0 h-full flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      {searchOpen && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              doSearch(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                doSearch(searchQuery, e.shiftKey ? 'prev' : 'next')
              }
              if (e.key === 'Escape') {
                toggleSearch()
              }
            }}
            placeholder="Search terminal..."
            className="flex-1 px-2 py-1 text-sm rounded outline-none"
            style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
          />
          <button
            onClick={() => doSearch(searchQuery, 'prev')}
            className="px-1.5 py-0.5 text-xs rounded hover:opacity-80"
            style={{ color: 'var(--text-secondary)' }}
            title="Previous (Shift+Enter)"
          >▲</button>
          <button
            onClick={() => doSearch(searchQuery, 'next')}
            className="px-1.5 py-0.5 text-xs rounded hover:opacity-80"
            style={{ color: 'var(--text-secondary)' }}
            title="Next (Enter)"
          >▼</button>
          <button
            onClick={toggleSearch}
            className="px-1.5 py-0.5 text-xs rounded hover:opacity-80"
            style={{ color: 'var(--text-secondary)' }}
            title="Close (Esc)"
          >✕</button>
        </div>
      )}
      <div ref={containerRef} className="flex-1 min-w-0" />
    </div>
  )
}
