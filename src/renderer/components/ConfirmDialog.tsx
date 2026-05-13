import { useEffect, useState, useCallback, useRef } from 'react'

interface ConfirmRequest {
  id: number
  message: string
  confirmLabel: string
  cancelLabel: string
  resolve: (result: boolean) => void
}

let dispatch: ((req: ConfirmRequest) => void) | null = null
let nextId = 1

/**
 * Imperative replacement for `window.confirm()` that works reliably inside
 * sandboxed / contextIsolated Electron renderer contexts. Returns a promise
 * that resolves to `true` if the user clicks confirm, `false` otherwise.
 *
 * Requires `<ConfirmDialog />` to be mounted once in the app tree.
 */
export function confirmDialog(
  message: string,
  options?: { confirmLabel?: string; cancelLabel?: string }
): Promise<boolean> {
  if (!dispatch) {
    // Fallback to native confirm if the modal host isn't mounted yet.
    // This should normally never happen.
    return Promise.resolve(window.confirm(message))
  }
  return new Promise<boolean>((resolve) => {
    dispatch!({
      id: nextId++,
      message,
      confirmLabel: options?.confirmLabel ?? 'OK',
      cancelLabel: options?.cancelLabel ?? 'Cancel',
      resolve
    })
  })
}

/**
 * Modal host for `confirmDialog()`. Mount once near the app root.
 */
export function ConfirmDialog(): JSX.Element | null {
  const [queue, setQueue] = useState<ConfirmRequest[]>([])
  const confirmBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    dispatch = (req) => setQueue((q) => [...q, req])
    return () => {
      dispatch = null
    }
  }, [])

  const active = queue[0]

  const resolve = useCallback((result: boolean) => {
    setQueue((q) => {
      const [head, ...rest] = q
      head?.resolve(result)
      return rest
    })
  }, [])

  useEffect(() => {
    if (!active) return
    // Focus the confirm button so Enter submits immediately
    confirmBtnRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        resolve(false)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        resolve(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, resolve])

  if (!active) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60"
      onClick={() => resolve(false)}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-[var(--bg-secondary,#161b22)] border border-[var(--bg-hover,#30363d)] rounded-lg p-5 shadow-xl min-w-[320px] max-w-[480px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm mb-4" style={{ color: 'var(--text-primary)' }}>
          {active.message}
        </div>
        <div className="flex justify-end gap-2">
          {active.cancelLabel ? (
            <button
              onClick={() => resolve(false)}
              className="px-3 py-1.5 text-xs rounded border border-[var(--bg-hover,#30363d)] hover:bg-[var(--bg-hover,#30363d)]"
              style={{ color: 'var(--text-primary)' }}
            >
              {active.cancelLabel}
            </button>
          ) : null}
          <button
            ref={confirmBtnRef}
            onClick={() => resolve(true)}
            className="px-3 py-1.5 text-xs rounded bg-red-600 text-white hover:bg-red-500 font-medium"
          >
            {active.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
