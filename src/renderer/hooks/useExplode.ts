import { useCallback } from 'react'
import { computeTileLayout, type DisplayBounds } from '@shared/tiling'
import type { Session } from '@shared/types'

/**
 * Sentinel session ID used to reserve a tile slot for the main Tangent
 * window. The main window participates in the grid so it doesn't end up
 * sitting on top of popouts (root cause of the overlap bug observed in
 * 2026-04-18 after two prior fix attempts).
 */
const MAIN_WINDOW_TILE_SENTINEL = '__tangent_main_window__'

/**
 * Returns an `explodeAll` function that tiles all non-exited sessions across
 * the user-selected displays. Sessions are popped out if not already.
 * Already-popped windows are repositioned to fit the tile layout.
 *
 * The main Tangent window is included in the tile grid as its own cell so
 * it does not overlap the popouts.
 */
export function useExplode(sessions: Session[]) {
  return useCallback(
    async (selectedDisplayIds: number[]) => {
      const winApi = (window.tangentAPI as any).window
      if (!winApi) return

      const allDisplays: DisplayBounds[] = await winApi.getDisplays()
      const displays = allDisplays.filter((d) => selectedDisplayIds.includes(d.id))
      if (displays.length === 0) return

      // Include ALL non-exited sessions in the tile layout, regardless of pop-out state
      const eligible = sessions.filter((s) => s.status !== 'exited')
      if (eligible.length === 0) return

      const sessionIds = eligible.map((s) => s.id)

      // Reserve a tile slot for the main window as the FIRST cell. Popouts
      // fill the remaining cells. This keeps the main window tiled alongside
      // popouts and prevents it from covering them.
      const idsWithMain = [MAIN_WINDOW_TILE_SENTINEL, ...sessionIds]
      const layout = computeTileLayout(idsWithMain, displays)

      // Move the main window to its reserved tile first.
      const mainTile = layout.find((t) => t.sessionId === MAIN_WINDOW_TILE_SENTINEL)
      if (mainTile && typeof winApi.setMainBounds === 'function') {
        try {
          await winApi.setMainBounds({
            x: mainTile.x,
            y: mainTile.y,
            width: mainTile.width,
            height: mainTile.height
          })
        } catch (err) {
          console.warn('[useExplode] setMainBounds failed:', err)
        }
      }

      // Pop out (or reposition) each session window into its tile.
      for (const tile of layout) {
        if (tile.sessionId === MAIN_WINDOW_TILE_SENTINEL) continue
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
