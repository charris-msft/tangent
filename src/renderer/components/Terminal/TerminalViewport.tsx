import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { SdkLineBuffer } from '@shared/SdkLineBuffer'
import type { SessionKind } from '@shared/types'

// Global registry so other modules (useKeyboard) can access terminal instances
export const terminalRegistry = new Map<string, Terminal>()

interface TerminalViewportProps {
  sessions: { id: string; kind: SessionKind }[]
  activeId: string | null
  fontSize: number
}

interface TerminalInstance {
  terminal: Terminal
  fitAddon: FitAddon
  div: HTMLDivElement
  cleanup: () => void
}

export function TerminalViewport({ sessions, activeId, fontSize }: TerminalViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const instancesRef = useRef<Map<string, TerminalInstance>>(new Map())

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
        terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
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
          if (key === 'b' || key === 'n' || key === 'w' || key === 'tab' ||
              key === '=' || key === '+' || key === '-' || key === '0') {
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
          const lineBuffer = new SdkLineBuffer(
            (data) => terminal.write(data),
            (line) => window.tangentAPI.sdk.sendMessage(sessionId, line)
          )

          // SDK output → terminal display
          const unsubSdkOutput = window.tangentAPI.sdk.onOutput(session.id, (data: string) => {
            terminal.write(data)
          })
          cleanupFns.push(unsubSdkOutput)

          // User keystrokes → line buffer (local echo + send on Enter)
          const onDataDisposable = terminal.onData((data) => {
            lineBuffer.handleInput(data)
          })
          cleanupFns.push(() => onDataDisposable.dispose())
        } else {
          // === PTY session: direct PTY I/O ===
          window.tangentAPI.terminal.attach(session.id)
          const unsubData = window.tangentAPI.terminal.onData(session.id, (data: string) => {
            terminal.write(data)
          })
          cleanupFns.push(unsubData)

          // Forward user input to PTY
          const onDataDisposable = terminal.onData((data) => {
            window.tangentAPI.terminal.write(session.id, data)
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
          div,
          cleanup: () => cleanupFns.forEach(fn => fn())
        })
        terminalRegistry.set(session.id, terminal)
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

  return (
    <div ref={containerRef} className="flex-1 min-w-0 h-full" style={{ background: 'var(--bg-primary)' }} />
  )
}
