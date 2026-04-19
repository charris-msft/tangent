# 2026-04-18: Explode — Main Window Stays, Popouts Tile Around It

**By:** Danny (Lead/Architect)
**Status:** ✅ Implemented
**Tags:** #ui #windows #explode #refinement #fontsize

## Context

Brady provided two refinements on top of commit `09793b0`:

1. Main Tangent window **must not move** when Explode is triggered.
2. Popout windows **must preserve** the user's configured xterm font size.

Prior fix (09793b0) tiled `[main, ...sessions]` so the main window became the first tile cell. That avoided the overlap bug but violated Brady's intent — users want main to stay where they put it.

## Decision #1 — Tile popouts around main, never move main

**Algorithm: Skip-cell with grid growth.**
- `useExplode` reads `winApi.getMainBounds()`.
- If main's centerpoint lies on one of the selected displays, that rect is passed to `computeTileLayout({ exclusions })`.
- Inside `cellsForDisplay`, start with `totalCells = N`. Generate cells. Filter out any cell overlapping an exclusion. If fewer than N usable cells remain, grow `totalCells = totalCells + deficit + 1` and retry (capped at 8 attempts).
- If main isn't on any selected display, no exclusion applied — original behavior preserved.

**Why this over the "shrink workArea" alternative:** skip-cell handles the centered-main case naturally (user may have main in middle of screen); workArea-shrinking degenerates there. Convergence is fast because each grown cell is only slightly smaller.

**Fallback:** if 8 attempts still can't produce enough cells (e.g., main covers the display), return whatever non-overlapping cells we have. The remaining popouts won't be moved — better than throwing or stacking on top of main.

**What I kept:** `WindowManager.setMainBounds()` remains — it's still useful for Collapse (future) and symmetrical with `getMainBounds()`. Just not called from Explode anymore.

## Decision #2 — Popout reads fontSize from config

Root cause: `PopoutWindowShell.tsx` hardcoded `fontSize={14}`. Anything other than 14 in main = visible drift in popout.

**Fix:**
- PopoutWindowShell loads `config.fontSize` on mount and subscribes to `config.onChanged`.
- App.tsx also hydrates `fontSize` from config on startup (previously only used ZOOM.DEFAULT initial) so main ↔ popout stay in sync across restarts.

**Confirmed with xterm docs and code review:** `fitAddon.fit()` recomputes rows/cols from container size ÷ cell size. It does **not** rescale the font. So the original "font changes on resize" user complaint was really "popout uses wrong initial font size" — resize itself was innocent.

## Test Coverage

**Unit (`tiling.test.ts`, +8 tests):**
- No exclusion ≡ baseline behavior.
- Exclusion on different display ignored.
- Edge-band exclusion (n = 3,4,5,6,8) → all cells miss main; pairwise non-overlap.
- Centered exclusion → grid grows, all cells miss main.

**E2E (`explode-bounds.spec.ts`, rewritten):**
- Captures main `getBounds()` before Explode; asserts identical bounds after.
- Asserts all popouts fit target display workArea.
- Asserts pairwise non-overlap across **the full window set** (main + popouts).
- Verified live on Brady's dual-monitor setup — 17 popouts tiled cleanly around an 1201×801 main window with zero overlap.

## Governance Note

Prior fix was the right shape (symptom: overlap) but wrong direction (moved main). Brady's correction kept the root-cause insight — "assert invariants on the full window set, never filter" — and refined the solution: route around main instead of joining the grid. That's a cleaner invariant: **Explode never moves main; popouts must satisfy non-overlap against all obstacles including main.**

## Files Changed

- `src/shared/tiling.ts` — `ExclusionRect`, `cellsForDisplay` grid-growth algorithm
- `src/shared/__tests__/tiling.test.ts` — +8 exclusion tests
- `src/renderer/hooks/useExplode.ts` — no sentinel; reads main bounds as exclusion
- `src/main/window/WindowManager.ts` — `getMainBounds()`
- `src/main/ipc/windowHandlers.ts` + `src/preload/index.ts` — `window:getMainBounds`
- `tests/explode-bounds.spec.ts` — bounds-unchanged assertion + all-windows non-overlap
- `src/renderer/components/PopoutWindowShell.tsx` — config-driven fontSize
- `src/renderer/App.tsx` — hydrate fontSize from config

**Commits:**
- `fix: Explode leaves main window in place, tiles popouts around it`
- `fix: Explode/popout preserves user's configured xterm font size`
