import { useCallback } from 'react'
import { computeTileLayout, type DisplayBounds, type ExclusionRect } from '@shared/tiling'
import type { Session } from '@shared/types'

/**
 * Returns an `explodeAll` function that tiles all non-exited sessions across
 * the user-selected displays. Sessions are popped out if not already;
 * already-popped windows are repositioned to fit the tile layout.
 *
 * The main Tangent window is NOT moved — Brady wants it to stay wherever
 * the user put it. Instead we read its current bounds and pass them as an
 * exclusion rect so popouts tile AROUND it. The layout grid grows as
 * needed to still produce N non-overlapping cells.
 *
 * If the main window isn't on any selected display, no exclusion is
 * applied and popouts tile the full workArea normally.
 */
export function useExplode(sessions: Session[]) {
  return useCallback(
    async (selectedDisplayIds: number[]) => {
      const winApi = (window.tangentAPI as any).window
      if (!winApi) return

      const allDisplays: DisplayBounds[] = await winApi.getDisplays()
      const displays = allDisplays.filter((d) => selectedDisplayIds.includes(d.id))
      if (displays.length === 0) return

      const eligible = sessions.filter((s) => s.status !== 'exited')
      if (eligible.length === 0) return

      const sessionIds = eligible.map((s) => s.id)

      // Read main window's current bounds. If it's on one of the selected
      // displays, use it as an exclusion rect so popouts tile around it.
      let exclusions: ExclusionRect[] = []
      try {
        const mainBounds = await winApi.getMainBounds?.()
        if (mainBounds) {
          const hostDisplay = displays.find((d) => {
            const cx = mainBounds.x + mainBounds.width / 2
            const cy = mainBounds.y + mainBounds.height / 2
            return cx >= d.x && cx < d.x + d.width && cy >= d.y && cy < d.y + d.height
          })
          if (hostDisplay) {
            exclusions = [{ displayId: hostDisplay.id, ...mainBounds }]
          }
        }
      } catch (err) {
        console.warn('[useExplode] getMainBounds failed, tiling without exclusion:', err)
      }

      const layout = computeTileLayout(sessionIds, displays, { exclusions })

      for (const tile of layout) {
        try {
          const ok = await winApi.popOut(tile.sessionId, {
            x: tile.x,
            y: tile.y,
            width: tile.width,
            height: tile.height
          })
          if (!ok) {
            console.warn('[useExplode] popOut returned false for', tile.sessionId)
          }
        } catch (err) {
          console.warn('[useExplode] popOut failed for', tile.sessionId, err)
        }
      }
    },
    [sessions]
  )
}
