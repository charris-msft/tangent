# Session: Explode popOut() Bounds Fix

**Date:** 2026-04-18T18:55:53Z  
**Agent:** Danny  
**Duration:** Complete  
**Status:** ✅ Merged

## Problem

Users reported window overlap in Explode multi-window feature despite Livingston's earlier bounds-clamping fix. Investigation revealed the tiling algorithm was correct, but existing windows weren't being repositioned during Explode.

## Root Cause

`WindowManager.popOut()` had two code paths:
- New window → create with bounds ✅
- Existing window → focus only, ignore bounds ❌

When users manually popped out sessions then clicked Explode, existing windows stayed at their cascaded positions.

## Solution

Added `setBounds()` call in `popOut()` for existing windows when bounds provided:
```ts
if (bounds) {
  existing.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height })
}
```

## Changes

- `src/main/window/WindowManager.ts` — 4-line modification
- `tests/explode-bounds.spec.ts` — new e2e diagnostic test

## Verification

- ✅ All 24 tiling unit tests pass
- ✅ New e2e test passes (was failing before fix)
- ✅ 6 multi-window regression tests pass
- ✅ Build green
