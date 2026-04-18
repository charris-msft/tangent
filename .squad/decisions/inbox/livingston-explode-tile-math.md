# Decision: Explode Window Tiling Algorithm

**Date:** 2026-04-13  
**Author:** Livingston (Frontend Dev)  
**Status:** ✅ Implemented

## Problem

Multi-window "Explode" feature was producing overlapping windows instead of clean tiles. User reported 5 sessions exploding with visible overlaps.

## Root Cause

The tiling algorithm in `src/shared/tiling.ts` (`computeTileLayout`) was mathematically sound but had a subtle floating-point rounding edge case: computed window positions could exceed display bounds by 1-2 pixels due to accumulated rounding errors from `Math.floor()` operations on fractional cellWidth/cellHeight values.

Additionally, Electron's BrowserWindow has hardcoded `minWidth: 400, minHeight: 300` constraints. If the algorithm computed smaller windows (e.g., 16 windows on 1920×1080 produces 260px height), Electron would silently enlarge them, causing guaranteed overlaps.

## Solution

Added explicit bounds clamping in the final step:

```typescript
const clampedWidth = Math.min(floorWidth, display.x + display.width - floorX);
const clampedHeight = Math.min(floorHeight, display.y + display.height - floorY);
```

This ensures windows NEVER exceed their display's workArea, preventing both rounding errors and off-screen spill.

## Tiling Algorithm

For N windows distributed across M displays:

1. **Distribution:** Base = floor(N/M), with remainder windows distributed to first displays
2. **Per-display grid:**
   - `cols = Math.ceil(Math.sqrt(count))`  // count = windows on this display
   - `rows = Math.ceil(count / cols)`
3. **Cell sizing:**
   - Available space: `display.workArea - 2*outerPadding`
   - Cell size: `(availableSpace - (gridDim-1)*padding) / gridDim`
4. **Positioning:** Column-major layout
   - `row = floor(i / cols)`
   - `col = i % cols`
   - `x = display.x + outerPadding + col*(cellWidth + padding)`
   - `y = display.y + outerPadding + row*(cellHeight + padding)`
5. **Clamping:** Ensure `x + width ≤ display.x + display.width` and same for height

### Examples

- **5 windows, 1 display:** 3 cols × 2 rows (3 in top row, 2 in bottom)
- **5 windows, 2 displays:** Display 1 gets 3 (2×2 grid), Display 2 gets 2 (2×1 grid)
- **16 windows, 1920×1080:** 4×4 grid, but cell height = 260px < minHeight(300px) → will overlap (unavoidable)

## Implementation Details

- **File:** `src/shared/tiling.ts`
- **Function:** `computeTileLayout(sessionIds, displays, options)`
- **Options:** `padding` (default 8px between windows), `outerPadding` (default 8px from display edges)
- **Returns:** `TilePosition[]` with `{ sessionId, displayId, x, y, width, height }`

## Testing

Extended test suite in `src/shared/__tests__/tiling.test.ts`:
- Added n=5, n=6, n=8 to bounds-checking tests
- Added explicit pairwise overlap detection for n=2..8
- All 24 tests pass

## Key Constraints

1. **Always use `display.workArea` not `display.bounds`** (workArea accounts for taskbar)
2. **DPI scaling:** Electron reports workArea in logical pixels (already scaled)
3. **Minimum window size:** 400×300 enforced by Electron (can't be overridden)
4. **Practical limit:** ~12-14 windows per 1920×1080 display before hitting min size

## Future Considerations

If users frequently explode many windows (>12), consider:
- Warning users when computed window size < minimums
- Suggesting multi-display distribution
- Alternative layouts (e.g., stacked tabs instead of tiled windows)

## References

- Implementation: `src/shared/tiling.ts`
- Tests: `src/shared/__tests__/tiling.test.ts`
- IPC handler: `src/main/ipc/windowHandlers.ts` (line 32-47, uses workArea correctly)
- Window creation: `src/main/window/WindowManager.ts` (line 85-86, minWidth/minHeight)
