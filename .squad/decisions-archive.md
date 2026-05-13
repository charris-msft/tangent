# Squad Decisions Archive

Archived entries (older than 2026-05-05) that are not actively driving current work. Active decisions relevant to Forge Chat PoC remain in `decisions.md`.

---

## Archived Decisions

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
**What:** Danny's 58-item work decomposition breaks Plan A across 4 phases with architectural decisions, dependency phases, effort estimates, team role assignments, npm dependencies, and risk mitigation strategies.
**Why:** Provides concrete work scope, dependency sequencing, and architectural commitments for 9–11 week Plan A implementation.
**Status:** Reference material for remote agent offloading feature (deferred scope).

### 2026-04-13: ACP SDK API Surface
**By:** Rusty  
**Status:** ✅ Accepted  
**What:** Exploration of `@agentclientprotocol/sdk` v0.18.2 API surface for ClientSideConnection, AgentSideConnection, Stream, and Client interface patterns.
**Key Decisions:**
- Use `ClientSideConnection` for Tangent's Dev Box ACP client
- Implement minimal required `Client` interface (requestPermission, sessionUpdate)
- Defer stream creation to DevBoxManager (SSH tunnel + stdio bridge)
- Use `unstable_resumeSession` with fallback to `loadSession`
- Use `unstable_closeSession` if available during disconnect

**Status:** Reference material for remote agent offloading (Plan A, deferred).

### 2026-04-18: Explode Multi-Window Tiling — Reposition Existing Windows
**By:** Danny (Lead/Architect)  
**Status:** ✅ Implemented  
**What:** Root cause of overlapping windows was `WindowManager.popOut()` ignoring bounds parameter for already-existing windows.
**Decision:** Modify `popOut()` to call `setBounds()` when explicit bounds provided.
**Status:** This was the first of 3 overlapping window bugs. See 2026-04-18 (filter fix) and 2026-04-18 (main window inclusion) for complete resolution.

### 2026-04-18: Explode Already-Popped Windows — Root Cause & Fix
**By:** Danny (Lead/Architect)  
**Status:** ✅ Fixed  
**Problem:** Explode still caused overlapping windows after first fix. With 5 already-popped sessions, windows stayed at cascaded positions.
**Root Cause:** `useExplode.ts` filtered OUT already-popped windows before computing tile layout.
**Decision:** Remove already-popped filter. Explode tiles ALL windows (popped or not).
**Status:** This was the second of 3 overlapping window bugs. See 2026-04-18 (main window inclusion) for final resolution.

### 2026-04-18: Explode — Include Main Window in Tile Grid (Final Root Cause)
**By:** Danny (Lead/Architect)  
**Status:** ✅ Implemented  
**Problem:** After two prior fixes, overlapping windows persisted. Evidence from Brady's dual DELL U2720Q @165% DPI showed 12 overlap pairs, all involving the main window.
**Root Cause — Proven by Live Evidence:** Explode moves only popouts. Main window stays at default bounds (~1200×800, centered), visually overlapping every popout.
**Decision:** Main Tangent window participates in tile grid as ordinary cell.
**Implementation:** WindowManager.setMainBounds(), IPC handler, useExplode sentinel tile, exclusion-rect approach.
**Status:** This was the third and final overlapping window bug. All 3 stacked on Brady's 12-popout scenario. Resolution confirmed: 17-window scenario with zero overlap.

---

*Archive maintained for reference. Active decisions driving current Forge Chat PoC and Squad governance remain in `decisions.md`.*
