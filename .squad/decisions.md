# Squad Decisions

## Active Decisions

### 2026-04-12 19:05: PRD intake — Remote Agent Offloading
**By:** charris-msft (Brady) via Copilot
**What:** PRD at D:\git\PMStudio\tangent\tangent_remote_prd.md defines remote agent offloading to Dev Boxes. Scope: Plan A only (Copilot CLI/Tangent + ACP over SSH). Plan B (VS Code) deferred.
**Why:** User provided PRD for new feature work.

### 2026-04-12 19:05: App identity — tangent-2
**By:** charris-msft (Brady) via Copilot
**What:** This copy runs as "tangent-2" to coexist side-by-side with the original Tangent in ../release. Branch: "remote". Package name, productName, appId all need updating.
**Why:** User directive — side-by-side development requirement.

### 2026-04-12 19:05: Dev Box target — charrisdb5
**By:** charris-msft (Brady) via Copilot
**What:** The target Dev Box for remote execution is "charrisdb5". Use this as the default/primary Dev Box for development and testing.
**Why:** User provided their Dev Box name for the remote offloading feature.

### 2026-04-13: PRD Decomposition — Plan A Architecture (58 items)
**By:** Danny (Architecture) via Copilot
**What:** Danny's 58-item work decomposition (D:\git\tangent\release-2\.squad\decisions\inbox\danny-prd-decomposition.md) breaks Plan A across 4 phases. Key architectural decisions from the decomposition:

**Upfront Architectural Decisions:**
1. **Local-as-Primary Model** — Local machine is source of truth for workspace files. Dev Boxes are ephemeral compute.
2. **Copilot CLI Cloud Sync for Sessions** — Use built-in `sessionSync.level = "account"` for session state. No custom rsync of `~/.copilot/session-state/`.
3. **Workspace Sync via Hooks** — `agentStop` hook triggers rsync from Dev Box → local after each agent turn. Outbound sync on connect.
4. **Remote as Opt-In** — Agent profiles get optional `remote.*` fields. Not a default for any agent.
5. **CopilotACP as Auto-Start Service** — Windows Scheduled Task ensures zero manual steps after first-time setup.
6. **First-Time Provisioning with Consent** — Tangent shows what it will change on Dev Box before doing it.
7. **Permission dialogs in local UI** — ACP permission requests bridged to Tangent's local UI, not remote terminal. Maintains security model and user control.
8. **Local-as-Primary for Failover** — If Dev Box crashes mid-turn, worst case is losing one agent turn's workspace changes. Session state already synced to cloud. Spin up new Dev Box and resume.

**Full decomposition includes:** 4 dependency phases (P0–P4), effort estimates (S/M/L), team role assignments, new npm dependencies (@agentclientprotocol/sdk, @microsoft/devbox-mcp, ssh2, node-rsync), and risk mitigation strategies. See full document for 58 items and timeline estimates.

**Why:** Provides concrete work scope, dependency sequencing, and architectural commitments for 9–11 week Plan A implementation.

### 2026-04-13: ACP SDK API Surface
**By:** Rusty  
**Status:** ✅ Accepted  
**Tags:** #acp #sdk #api

**What:** Exploration of `@agentclientprotocol/sdk` v0.18.2 reveals API surface for ClientSideConnection, AgentSideConnection, Stream, and Client interface patterns.

**Key Decisions:**
- Use `ClientSideConnection` for Tangent's Dev Box ACP client
- Implement minimal required `Client` interface (requestPermission, sessionUpdate)
- Defer stream creation to DevBoxManager (SSH tunnel + stdio bridge)
- Use `unstable_resumeSession` with fallback to `loadSession`
- Use `unstable_closeSession` if available during disconnect

**Rationale:** Tangent is a CLIENT connecting to remote ACP agents (not an agent itself). Minimal Client interface reduces complexity. Stream creation separated from AcpClient allows flexible transport.

**Impact:** 
- AcpClient wraps ClientSideConnection, maps Tangent sessions ↔ ACP sessions
- DevBoxManager responsible for creating Stream (SSH tunnel + stdio bridge)
- Future incremental expansion of Client capabilities as needed

**See:** Full discovery details in implementation PR, SDK Docs at https://agentclientprotocol.github.io/typescript-sdk

### 2026-04-18: Explode Multi-Window Tiling — Reposition Existing Windows
**By:** Danny (Lead/Architect)  
**Status:** ✅ Implemented  
**Tags:** #ui #windows #bugfix

**What:** Root cause of overlapping windows in Explode multi-window feature was NOT the tiling algorithm — it was `WindowManager.popOut()` ignoring the bounds parameter for already-existing windows.

**Root Cause:** When users manually popped out sessions then clicked Explode, `popOut()` would focus existing windows but not reposition them via `setBounds()`. Windows remained at their original cascaded positions.

**Decision:** Modify `popOut()` to call `setBounds()` when explicit bounds are provided, even for existing windows.

**Implementation:**
- Added `if (bounds) { existing.setBounds({...}) }` check in popOut() for existing window path
- Transparent API: call site (`useExplode`) doesn't need to know if window exists
- No breaking changes: existing callers without bounds param unaffected

**Testing:**
- Added `tests/explode-bounds.spec.ts` e2e diagnostic test
- Asserts: all windows within display workArea, pairwise non-overlap
- Test failed BEFORE fix (all windows at x=763, y=332), passes AFTER fix
- All 24 unit tiling tests pass, 6 multi-window regression tests pass, build green

**Files Changed:** `src/main/window/WindowManager.ts`, `tests/explode-bounds.spec.ts`

**Related Work:** Livingston's bounds-clamping fix (commit 26c116e) addressed algorithm precision. This fix addresses application of algorithm results to existing windows. Together they ensure: (1) Tile positions never exceed display bounds (algorithm), (2) Positions are actually applied to all windows (application).

**Key Learnings:**
- BrowserWindow constructor bounds only apply during creation. Existing windows require `setBounds()` or `setPosition()` + `setSize()`
- Always use `display.workArea` (excludes taskbar), not `display.bounds` which includes taskbar area
- Electron enforces `minWidth: 400, minHeight: 300` — will silently enlarge windows violating minimums, causing overlap. Known limitation with 16+ windows on smaller displays.

### 2026-04-18: Explode Already-Popped Windows — Root Cause & Fix
**By:** Danny (Lead/Architect)  
**Status:** ✅ Fixed  
**Tags:** #ui #windows #bugfix #explode

**Problem:** Explode still caused overlapping windows even after popOut-bounds fix. With 5 already-popped sessions, windows stayed at cascaded positions.

**Root Cause:** `useExplode.ts` filtered OUT already-popped windows before computing tile layout:
```ts
const poppedIds = await winApi.getPoppedSessionIds?.()
const eligible = sessions.filter((s) => !poppedIds.includes(s.id) && s.status !== 'exited')
```

When all 5 were popped, filter excluded all 5 → `computeTileLayout()` returned `[]` → loop never executed → no windows repositioned.

**Decision:** Remove already-popped filter. Explode tiles ALL windows (popped or not).

**Why Test Missed It:** `tests/explode-bounds.spec.ts` manually called `winApi.popOut()` directly, bypassing the hook's filter. Test verified the low-level method works but didn't test the hook's filter logic.

**Key Insight:** Integration tests that bypass higher-level logic (hooks) can pass while real bugs persist in that logic. Always test at the FULL user code path: button click → event handler → React hook → IPC call → main process → Electron API.

**Files Changed:** `src/renderer/hooks/useExplode.ts`, `src/renderer/App.tsx`, `tests/explode-real-ui.spec.ts`

### 2026-04-18: Explode — Include Main Window in Tile Grid (Final Root Cause)
**By:** Danny (Lead/Architect)  
**Status:** ✅ Implemented  
**Tags:** #ui #windows #bugfix #rootcause

**Problem:** After two prior fixes, users still observed overlapping windows. Both prior e2e tests passed but only asserted popout-to-popout non-overlap and ignored the main Tangent window.

**Root Cause — Proven by Live Evidence:** Explode moves only popouts. Main window stays at default bounds (~1200×800, centered), visually overlapping every popout. Evidence from Brady's dual DELL U2720Q @165% DPI, primary workArea 2328×1266 with 12 popouts:
```
overlap pairs (total): 12
  all 12 pairs involve id=1 (main window)
popout-to-popout overlaps: 0
```

**Decision:** Main Tangent window participates in tile grid as ordinary cell.

- **WindowManager.setMainBounds():** New method that lowers `minimumSize` (Electron silently enlarges windows violating minimums, defeating bounds), then calls `setBounds()`
- **IPC & Preload:** New handler `window:setMainBounds`, exposed as `tangentAPI.window.setMainBounds(bounds)`
- **useExplode:** Reserve sentinel tile slot `__tangent_main_window__` as first cell, call `setMainBounds(firstTile)` before popouts

**Why Not Minimize Main:** Brady's hint explicitly stated main window "should be" in grid. Hiding it makes Explode surprising — users lose Sessions panel and controls. Tiling keeps main visible and useful as "hub" cell.

**Test Coverage:** Rewrote `tests/explode-bounds.spec.ts` to:
1. Create 5 sessions + use real IPC flow
2. Collect bounds for EVERY BrowserWindow (main + popouts)
3. Assert pairwise non-overlap across ALL windows
4. Assert all windows fit in workArea

Old assertion space (popouts only) is retired. This test would have caught the bug before both prior shipped fixes.

**Governance Note:** Two prior fixes shipped based on tests that passed but did not reproduce actual failure mode. Lesson: when asserting "no overlap" on windowed layout, **include every visible BrowserWindow in assertion space, not filtered subset.** Filtering to subset hides bugs in excluded windows — exactly where the bug lived.

**Files Changed:** `src/main/window/WindowManager.ts`, `src/main/ipc/windowHandlers.ts`, `src/preload/index.ts`, `src/renderer/hooks/useExplode.ts`, `tests/explode-bounds.spec.ts`

### 2026-04-19: Explode Refinement #1 — Exclusion-Rect Tiling (Keep Main in Place)
**By:** Danny (Lead/Architect)  
**Status:** ✅ Implemented  
**Tags:** #ui #windows #explode #refinement

**Problem:** After main window was included in Explode grid, popouts would overlap it during repositioning.

**Root Cause:** Tiling algorithm computed tile positions as if entire display was available. No mechanism to "reserve" main window's current location.

**Decision:** Replace sentinel-tile approach with exclusion-rect approach:
- `computeTileLayout()` now accepts optional `excludeRect?: Rect` parameter
- Algorithm checks each tile position against exclusion bounds
- Grid grows to accommodate N cells while avoiding excluded area
- Main window position becomes hard constraint in layout

**Implementation:**
- Modified `src/shared/tiling.ts` — exclusion-rect parameter in computeTileLayout
- Updated `src/renderer/hooks/useExplode.ts` — fetch main bounds, pass as exclusion
- Added 8 test cases for exclusion scenarios in `tiling.test.ts` (32/32 passing)

**Key Design Decision:** Main window is NOT moved during Explode. It remains visible and functional as the "hub" cell. Popouts tile around its current location.

**Trade-off (Architect Named):** When main covers >50% of display, grid returns fewer cells than requested. Graceful degradation over silent overlap.

**Files Changed:** `src/shared/tiling.ts`, `src/renderer/hooks/useExplode.ts`, `src/shared/__tests__/tiling.test.ts`

**Related Commits:** `2b26208`

### 2026-04-19: Explode Refinement #2 — Font Size Preservation in Popouts
**By:** Danny (Lead/Architect)  
**Status:** ✅ Implemented  
**Tags:** #ui #terminal #popout #refinement

**Problem:** Popout windows would reset to hardcoded `fontSize={14}`, losing user's configured font size.

**Root Cause:** `PopoutWindowShell.tsx` had hardcoded font size. No subscription to config changes.

**Decision:** All terminal instances (main + popout) read font size from single config source.

**Implementation:**
- Read `config.fontSize` on popout mount
- Subscribe to config change events in popout
- Gracefully update terminal when config changes
- Main window already subscribed (no changes needed)

**Key Design Decision:** Font size is user-configured and must not be rescaled by popout logic. Config is the authority; all instances follow it.

**Files Changed:** `src/renderer/components/PopoutWindowShell.tsx`, `src/renderer/hooks/useExplode.ts`

**Related Commits:** `444e945`

### 2026-04-19: Explode Refinement #3 — Terminal Mirroring in Dual Windows
**By:** Livingston (Integration Dev)  
**Status:** ✅ Implemented  
**Tags:** #ui #terminal #pty #refinement

**Problem:** When a session was popped out, terminal content appeared ONLY in popout window. Main window lost visibility into session activity.

**Root Cause:** IPC infrastructure was already broadcasting to both windows, but UI blockers (placeholder overlays) prevented dual rendering. Resize ownership was undefined — both windows tried to size the PTY.

**Decision:** Mirror terminal content (both windows render same stream) + coordinate resize ownership.

**Implementation:**
- Both main window tab AND popout render same PTY stream (mirrored)
- Removed placeholder overlays blocking dual rendering
- **Popout owns PTY sizing when open** — sends resize events; main scrolls
- Main reclaims ownership if popout closes unexpectedly
- Extended `SessionManager` to track both renderers per session

**Key Design Decision:** 
1. **Mirror not move:** Session is mirrored (both render) vs. moved (one renders)
2. **Popout owns sizing:** When popout open, it dictates PTY dimensions. Main observes, doesn't force resize. Prevents thrash.
3. **Graceful fallback:** If popout closes unexpectedly, main gracefully takes sizing ownership again.

**Rationale for Sizing Ownership:** Multiple windows rendering same content must coordinate sizing to avoid:
- Simultaneous resize requests (PTY thrash)
- Conflicting terminal dimensions
- Scrollback corruption

**Files Changed:** `src/main/terminal/TerminalManager.ts`, `src/main/session/SessionManager.ts`, `src/renderer/components/Terminal.tsx`, `src/renderer/components/PopoutWindow.tsx`, `src/main/window/WindowManager.ts`, `tests/terminal-mirror.spec.ts`

**Related Commits:** `500fc15`

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
