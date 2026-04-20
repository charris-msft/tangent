# Session: Explode Tile Overlap Fix

**Date:** 2026-04-18  
**Agent:** Livingston  
**Outcome:** ✅ Fixed  

Floating-point rounding in `tiling.ts` caused windows to stack incorrectly when n≥5. Root cause: intermediate calculations for window positions weren't clamped to integer screen pixels. Fixed by adding `Math.floor()` bounds clamping on positions. Added test cases for n=5, 6, 8. All 24 tests pass.

**Files:**
- `src/shared/tiling.ts` (core fix)
- `src/shared/__tests__/tiling.test.ts` (coverage)

**Note:** Windows >16 on 1920×1080 will always overlap — minWidth/minHeight constraints. Expected.
