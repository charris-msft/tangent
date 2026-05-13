import { useEffect, useState, useCallback } from 'react'
import type { DisplayBounds } from '@shared/tiling'

interface DisplayPickerProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (displayIds: number[]) => void
  confirmLabel?: string
}

/**
 * Modal that lets the user pick which displays to use for Explode.
 * Fetches available displays from the main process and renders a
 * selectable minimap of each screen.
 */
export function DisplayPicker({ isOpen, onClose, onConfirm, confirmLabel = 'Confirm' }: DisplayPickerProps) {
  const [displays, setDisplays] = useState<DisplayBounds[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())

  useEffect(() => {
    if (!isOpen) return
    const winApi = (window.tangentAPI as any).window
    winApi?.getDisplays?.().then((d: DisplayBounds[]) => {
      setDisplays(d)
      // Pre-select all displays
      setSelected(new Set(d.map(dd => dd.id)))
    }).catch(() => {})
  }, [isOpen])

  const toggle = useCallback((id: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleConfirm = useCallback(() => {
    if (selected.size === 0) return
    onConfirm(Array.from(selected))
    onClose()
  }, [selected, onConfirm, onClose])

  if (!isOpen) return null

  // Compute minimap scaling
  const minX = Math.min(...displays.map(d => d.x), 0)
  const minY = Math.min(...displays.map(d => d.y), 0)
  const maxX = Math.max(...displays.map(d => d.x + d.width), 1)
  const maxY = Math.max(...displays.map(d => d.y + d.height), 1)
  const totalW = maxX - minX
  const totalH = maxY - minY
  const MAP_WIDTH = 400
  const scale = MAP_WIDTH / totalW
  const mapHeight = totalH * scale

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-[var(--color-bg-default)] border border-[var(--color-border-default)] rounded-lg p-5 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-[var(--color-fg-default)] mb-3">
          Select displays
        </h2>

        <div className="relative mx-auto" style={{ width: MAP_WIDTH, height: mapHeight }}>
          {displays.map(d => {
            const isSelected = selected.has(d.id)
            return (
              <button
                key={d.id}
                className={`absolute border-2 rounded transition-colors text-xs font-mono flex items-center justify-center ${
                  isSelected
                    ? 'border-blue-500 bg-blue-500/20 text-blue-300'
                    : 'border-[var(--color-border-muted)] bg-[var(--color-bg-subtle)] text-[var(--color-fg-muted)]'
                }`}
                style={{
                  left: (d.x - minX) * scale,
                  top: (d.y - minY) * scale,
                  width: d.width * scale,
                  height: d.height * scale
                }}
                onClick={() => toggle(d.id)}
                title={d.label || `Display ${d.id}`}
              >
                {d.label || `${d.width}×${d.height}`}
                {d.isPrimary && <span className="ml-1 text-[10px] opacity-60">★</span>}
              </button>
            )
          })}
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button
            className="px-3 py-1.5 text-xs rounded border border-[var(--color-border-default)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)]"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40"
            disabled={selected.size === 0}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
