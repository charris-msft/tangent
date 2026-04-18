# Danny — History

## Core Context

- **Project:** Electron terminal app with hybrid PTY+SDK architecture for AI agent orchestration
- **Role:** Lead
- **Joined:** 2026-04-13T01:57:51.192Z

## Learnings

### 2026-04-13 — ACP Architecture Documentation (P2.12)

**Created: `docs/architecture/acp-integration.md`**
- Comprehensive ACP integration architecture guide covering all aspects of remote agent execution
- Sections: Overview, Connection Flow (SSH tunnel → ACP connect → session create), Session Lifecycle (create/resume/close), Permission Handling (ACP requests → UI approval → response), Error Recovery (tunnel drops, ACP crashes, sync conflicts)
- Mermaid diagrams: Connection sequence diagram and Permission request flow
- Key Files table: AcpClient, AcpProvisioner, DevBoxManager, SshTunnelManager, DevBoxConnector, acp-types, devbox-types, IPC handlers, RsyncManager
- SDK API Surface: Details of ClientSideConnection, minimal Client interface (requestPermission, sessionUpdate), Session operations (newSession, unstable_resumeSession, unstable_closeSession, prompt), Events (SessionNotification), Permission protocol
- Event Flow Summary: Main → AcpClient → Renderer events and Renderer → Main → AcpClient handlers
- Implementation Notes: Session ID mapping (bidirectional), Permission timeout (60s default deny), Stream creation (SSH tunnel)
- Testing Strategy: Unit tests for managers, integration tests for orchestration, E2E tests for UI flows, mock strategies
- Security: SSH tunnel encryption, private key storage, permission approval, timeout fallback, session/workspace isolation

**Design Principles Applied**
- Tangent is ACP CLIENT (not agent) — implements minimal Client interface for simplicity
- Session ID mapping essential for bridging Tangent local IDs ↔ ACP remote IDs
- Permission callbacks bridge remote (ACP) requests to local (UI) for user control
- Error recovery handles tunnel instability via exponential backoff + sync conflict UI
- Cloud sync (Copilot CLI) decouples session state from Dev Box ephemeral compute

<!-- Append learnings below -->

### 2026-04-18 — Explode Overlap: THE REAL Root Cause (after 2 prior misses)

**Root cause (FINAL):** The **main Tangent window is never part of the tile grid.** Explode only moves popout windows. The main window (600×400 minSize, default ~1200×800, default position near centre) sits in the middle of the screen and visually overlaps every popout underneath it. Brady's screenshot of "overlap" was popouts-behind-main, not popouts-vs-popouts.

**Live evidence that cracked it (explode-diagnostic.spec.ts on Brady's actual machine, DELL U2720Q dual-monitor @165% DPI, primary workArea 2328×1266):**
- Pairwise overlap check across ALL BrowserWindows found 12 overlap pairs. Every single pair involved `id=1` (the main window).
- Popout-to-popout overlap count: **0**. The tile algorithm is fine.
- Main window bounds never changed during Explode: `(563,232 1201×801)`.

**Why the two prior fixes missed it:**
1. Livingston's bounds-clamping fix (26c116e) constrained popout tile rectangles to fit inside workArea — addressed a real edge case but not this one.
2. My earlier fix (baf7fe7 / 42e3618) made `popOut()` call `setBounds()` for already-existing popouts. That fixed the "manually-popped windows stay where they were" bug but still did not touch the main window.
3. **Both prior e2e tests only queried popout windows** (`url.includes('mode=popout')`) and compared them against each other. They never considered the main window as a rect that can overlap popouts. The assertion space was incomplete.

**Debugging technique that actually worked:**
1. Wrote a test that dumped *every* BrowserWindow's bounds + displayId (not just popouts), plus `screen.getAllDisplays()` raw output.
2. Ran the failing scenario on Brady's real hardware.
3. Noticed every overlap pair in the report shared one window ID (`id=1`). That ID was always the main window — Explode had never touched it.

**Fix:**
- Reserve one tile cell for the main window (sentinel `__tangent_main_window__` prepended to the sessionIds array before `computeTileLayout`).
- New `WindowManager.setMainBounds()` method + `window:setMainBounds` IPC handler.
- Before sizing, lower main's `minimumSize` from 600×400 to `min(400,tileW)` × `min(300,tileH)` so Electron doesn't silently enlarge main past its cell and re-introduce the overlap.
- `useExplode` now calls `setMainBounds(firstTile)` and then `popOut(sessionTile)` for each remaining cell.

**Verification (live test, 6 eligible sessions + main = 7 tiles on Brady's primary display):**
- Main at (8,8) 767×413 — top-left
- 6 popouts fill remaining cells in 3×3 grid
- Pairwise overlap: 0
- All windows inside workArea: yes

**Reusable lessons:**
- When asserting "no overlap", iterate over **every** window on the target display, not a filtered subset. Filtering the assertion space hides bugs in the excluded windows.
- Dump displayId per window — not just bounds — to catch windows that ended up on the wrong monitor (Brady's secondary display is at x=2328, so a misroute would show up instantly as `displayId !== target`).
- On fractional DPI (Brady: 1.65x), Electron's `setBounds` returns ~6px larger width/height than requested after its internal DIP↔device rounding. Harmless when inter-tile padding ≥ ~6px, but worth knowing.
- When a component has a `minimumSize`, `setBounds` on a smaller cell is silently enlarged. Always lower `minimumSize` first when tiling into small cells.


### 2025-06-01 — Remote Execution Architecture (Plan A)

**Decision: Local-as-Primary Model**
- Local machine is always source of truth for workspace files
- Dev Boxes are ephemeral compute — replaceable, no persistent state assumptions
- Trade-off: Requires bidirectional sync overhead, but gains resilience and failover without data loss
- Impact: Worst-case failure loses at most one agent turn's workspace changes

**Decision: Copilot CLI Cloud Sync for Session State**
- Use built-in `sessionSync.level = "account"` instead of custom rsync for `~/.copilot/session-state/`
- Trade-off: Dependency on GitHub's infrastructure vs. self-managed sync
- Benefit: Cross-device session resumption, failover to any Dev Box without custom session state migration
- Tangent auto-configures this during first-time Dev Box provisioning

**Decision: Workspace Sync via Copilot CLI Hooks**
- `agentStop` hook triggers rsync Dev Box → local after each agent turn
- Alternative considered: Filesystem watching (rejected — too noisy, mid-turn partial states)
- Alternative considered: Continuous background sync (rejected — inefficient, conflicts)
- Trade-off: Sync lag after each turn vs. real-time consistency
- Benefit: Clean sync points aligned with agent conversation boundaries, minimal conflict surface

**Decision: Remote Execution as Opt-In per Agent Profile**
- Extended `AgentProfile` interface with optional `remote` object
- Not a global setting or default behavior
- Trade-off: Per-agent config complexity vs. user control and gradual adoption
- Benefit: Users can experiment with one agent profile, keeps local workflow intact

**Decision: ACP over SSH Tunnel (No tmux)**
- CopilotACP runs as Windows Scheduled Task auto-started on Dev Box login
- ACP protocol over SSH tunnel provides structured JSON-RPC events
- tmux rejected because: Windows-only Dev Boxes (would require WSL2), ACP already provides superior structured events, process persistence handled by Scheduled Task
- Trade-off: SSH tunnel instability vs. WSL2 dependency and filesystem bridging latency
- Mitigation: Health monitoring, auto-reconnect, exponential backoff

**Decision: First-Time Provisioning with Explicit Consent**
- Tangent shows consent dialog listing all changes before provisioning Dev Box
- Changes: OpenSSH service, CopilotACP scheduled task, Copilot CLI session sync config, sync hook scripts
- Trade-off: Extra user interaction vs. transparency and trust
- Benefit: Users understand what Tangent does to their Dev Box, no hidden magic

**Session Architecture Patterns**
- Created `RemoteSession` type extending base `Session` with remote-specific fields
- RemoteSessionManager orchestrates: Dev Box lifecycle → workspace sync → ACP session creation
- Status engine explicitly skips remote sessions (no terminal output parsing)
- Remote session states: `starting-devbox` → `syncing-out` → `tunneling` → `verifying-acp` → `running` → `syncing-back`

**Sync Conflict Handling**
- Detect local uncommitted changes before applying inbound sync
- UI presents choices: Keep Local / Use Remote / Merge (opens diff tool)
- Sync exclusions configurable via glob patterns (stored in `~/.tangent-2/sync-config.json`)

**Failover Strategy**
- Workspace files: local has latest (synced after last agent turn)
- Session state: in cloud via Copilot CLI sync
- Reconnection flow: detect tunnel failure → re-establish tunnel → verify ACP → resume session
- Dev Box switch flow: disconnect → connect new box → sync workspace out → resume
- "Continue Locally" escape hatch: sync workspace one final time → create local PTY session with `--resume`

**Dependency Choices**
- `@microsoft/devbox-mcp` for Dev Box discovery and lifecycle (Microsoft-maintained)
- `@agentclientprotocol/sdk` for ACP client (Copilot CLI official SDK)
- `ssh2` for SSH tunnel management (mature, well-tested)
- `node-rsync` for workspace sync (Node.js wrapper, fallback to robocopy on Windows if needed)

**Testing Strategy**
- Unit tests for managers (DevBoxManager, SshTunnelManager, RsyncManager, AcpClient)
- Integration tests for orchestration flows (connection, provisioning, sync, session lifecycle)
- E2e tests for UI flows (Dev Box assignment, connection, reconnection, failover)
- Mock DevBox MCP and ACP responses to avoid live cloud dependencies in CI

**Work Breakdown Insights**
- 58 total work items across 4 phases
- Critical path: P0.1 → Phase 1 (Dev Box lifecycle) → Phase 2 (ACP) → Phase 3 (sync) → Phase 4 (Tangent integration)
- Parallel tracks enable: Rusty on backend managers, Linus on SDK/IPC, Livingston on UI, Basher on tests
- Estimated 9-11 weeks for full implementation with 5-person team

**Risks & Mitigations**
- SSH tunnel instability → health monitoring + auto-reconnect + connection status UI
- Workspace sync conflicts → conflict detection UI + merge options + exclusion config
- Dev Box provisioning failures → consent dialog + retry logic + manual fallback docs
- rsync not available → check during provisioning + auto-install or document manual install
- ACP service crashes → Windows Scheduled Task auto-restart + health verification

**Key Files Modified**
- `src/shared/types.ts` — extended `AgentProfile` with `remote` fields, added `RemoteSession` type
- `src/main/agents/AgentStore.ts` — schema v3 with remote fields, backward-compatible migration
- `src/main/agents/AgentLauncher.ts` — route remote-enabled agents to RemoteSessionManager
- `src/main/session/SessionStore.ts` — track `remoteState` for remote sessions
- New main process managers: DevBoxManager, SshTunnelManager, RsyncManager, AcpClient, RemoteSessionManager, DevBoxProvisioner
- New UI components: DevBoxPicker, DevBoxStatus, ProvisioningConsentDialog, ConnectionLostDialog, SyncLogModal

### 2025-06-01 — TypeScript Type Definitions for Remote Execution (P1.2 + P2.2)

**Created: `src/shared/devbox-types.ts`**
- `DevBoxResource` — Dev Box entity with state, connection info, health status
- `DevBoxProject` — project container grouping Dev Boxes
- `DevBoxConnectionInfo` — SSH and ACP connection details (IP, host, ports)
- `DevBoxProvisioningState` — enum matching Azure Dev Center API states
- `DevBoxHealthStatus` — connection validation results
- `DevBoxConfig` — user config stored in agent profile
- `DevBoxProvisioningConsent` — tracks first-time setup consent
- `DevBoxSyncConfig` — workspace sync exclusion patterns

**Created: `src/shared/acp-types.ts`**
- `AcpSession` — active ACP session with state and metrics
- `AcpSessionConfig` — workspace context for remote sessions (cwd, env, MCP servers)
- `AcpPermissionRequest/Response` — permission callback protocol
- `AcpAgentResponse` — structured agent output (text, tools, status)
- `AcpToolExecution` — remote tool execution records
- `AcpConnectionState` — enum for tunnel/protocol lifecycle
- `AcpMessage` — base protocol message type
- `AcpEvent` — union of all server-to-client events
- `AcpConnectionOptions` — SSH tunnel configuration

**Design Patterns Applied**
- Followed existing conventions from `types.ts`: interface over type aliases, JSDoc comments, explicit exports
- Enum-as-union pattern for state types (matches `SessionStatus`, `AgentType`)
- Separated concerns: DevBox infrastructure vs. ACP protocol
- Optional fields for progressive enhancement (e.g., `healthStatus`, `acpPort`)
- Trade-off: Comprehensive types for IDE autocomplete vs. future flexibility (chose comprehensive — easier to extend than restrict)

### 2025-06-01 — Phase 4 Type Extensions (P4.1 + P4.4)

**Extended: `src/shared/types.ts`**
- **P4.1: AgentProfile.remote** — Added optional `remote` object with `enabled`, `devBoxProject`, `devBoxName`, `repoPath`, `sshUser`. All fields optional to maintain backward compatibility. Enables per-agent opt-in to remote execution.
- **P4.4: RemoteSessionState** — Added 6-state lifecycle type: `'starting-devbox' | 'syncing-out' | 'tunneling' | 'verifying-acp' | 'running' | 'syncing-back'`. Tracks remote session progression from Dev Box startup through ACP connection.
- **P4.4: Session remote fields** — Extended `Session` interface with 7 optional fields: `remoteState`, `devBoxName`, `devBoxProject`, `remoteConnectionId`, `remoteSyncState`, `lastSyncTime`, `acpSessionId`. All optional for non-remote sessions.
- **P4.4: SessionKind extension** — Added `'remote-agent'` to `SessionKind` union type. Discriminates remote sessions from local PTY/SDK sessions.
- **P4.4: AgentStoreData version** — Bumped schema version from 2 to 3 for remote field migration support.

**Design Principles Applied**
- Backward compatibility: All new fields are optional, existing code unaffected
- No breaking changes: Types remain extensible with union and interface patterns
- Consistent with existing architecture: Remote fields follow same naming/structure as `sdkSessionId`, `metrics`, etc.
- References external types: `RemoteSessionState` documented with JSDoc but kept self-contained (doesn't import from devbox-types/acp-types to avoid circular deps)
- Progressive enhancement: Remote sessions inherit all base Session fields, add remote-specific tracking on top

**Why Optional vs. Required**
- Rationale: 90% of Tangent users won't use remote execution in v1. Making fields required would force null-checking noise in session rendering, PTY management, status engine, etc.
- Trade-off: Type safety vs. developer ergonomics. Chose ergonomics — consumers can narrow with type guards (`session.kind === 'remote-agent'`) when needed.
- Alternative considered: Separate `RemoteSession extends Session` interface. Rejected — would require discriminated union handling in every IPC boundary and React component.

**Work Completed**
- ✅ P4.1: AgentProfile remote fields
- ✅ P4.4: RemoteSessionState type
- ✅ P4.4: Session remote fields
- ✅ P4.4: SessionKind extension
- ✅ P4.4: AgentStoreData version bump

### 2026-04-18 — Explode Multi-Window Tile Overlap Fix

**Root Cause**
Livingston's previous fix (26c116e) added bounds-clamping to `computeTileLayout()` to prevent windows from exceeding display bounds. However, windows were still overlapping when Explode was triggered on ALREADY-POPPED-OUT windows. The tiling algorithm was correct — the bug was in how tile positions were applied.

**Diagnosis Process**
1. Analyzed the call chain: `useExplode.ts` → `windowHandlers.ts` (getDisplays) → `WindowManager.popOut()` → BrowserWindow constructor
2. Found that `getDisplays()` correctly returns `display.workArea` (excludes taskbar)
3. Discovered the critical bug in `WindowManager.popOut()` (line 64-73): When a window already exists, it only focused it and **ignored** the new bounds parameter
4. Created diagnostic e2e test (`tests/explode-bounds.spec.ts`) that:
   - Creates 5 sessions
   - Pops them all out WITHOUT explicit bounds (simulating manual popout)
   - Calls Explode logic with computed tile bounds
   - Asserts no pairwise overlap and all windows within workArea
5. Test confirmed: All windows had identical positions (x=763, y=332) — they were never repositioned

**The Fix**
Modified `WindowManager.popOut()` to call `setBounds()` when explicit bounds are provided, even for existing windows:

```ts
if (existing && !existing.isDestroyed()) {
  if (existing.isMinimized()) existing.restore()
  // NEW: Reposition existing window if bounds provided (for Explode tiling)
  if (bounds) {
    existing.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height })
  }
  existing.focus()
  return existing
}
```

**Impact**
- Explode now correctly tiles ALL windows (new + existing)
- No change to tiling algorithm — Livingston's bounds-clamping remains
- New e2e test provides regression coverage

**Key Files**
- `src/main/window/WindowManager.ts` — The fix (line 74-79)
- `tests/explode-bounds.spec.ts` — Diagnostic test with pairwise overlap detection
- `src/shared/tiling.ts` — Unchanged (algorithm was already correct)

**Testing**
- ✅ All 24 tiling unit tests pass
- ✅ New explode-bounds e2e test passes (detects overlaps via pairwise rect intersection)
- ✅ All 6 multi-window e2e tests pass
- ✅ Manual verification: 5 windows tile in 3×2 grid without overlap

**Electron Window Sizing Pitfalls**
1. **BrowserWindow constructor ignores bounds after creation** — The constructor's `x, y, width, height` params only apply ONCE. To reposition an existing window, you MUST call `setBounds()` or `setPosition()` + `setSize()`.
2. **workArea vs bounds** — Always use `display.workArea` for tiling calculations. `display.bounds` includes the taskbar area and will cause windows to be obscured.
3. **minWidth/minHeight enforcement** — Electron silently enlarges windows that violate constraints (400×300). With 16+ windows on 1920×1080, each window gets ~240px width, violating minWidth. Electron enlarges them → unavoidable overlap. This is expected behavior, not a bug.
4. **Floating-point rounding** — Window positions/sizes are integers, but tiling math uses floats. Always `Math.floor()` final values to prevent 1-2px spillover that triggers constraint violations.
5. **Parent window relationships** — Popout windows created with `parent: mainWindow` will be closed when parent closes. This is desired for Tangent's popout model.

### 2026-04-18 — Explode Already-Popped Windows Bug (Second Fix)

**Root Cause**
Previous fix (setBounds() for existing windows) was CORRECT, but `useExplode.ts` had a SECOND bug: it filtered OUT already-popped sessions from the tile layout. When Brady had 5 already-popped windows and clicked Explode, `useExplode` computed a layout for ZERO sessions (because all 5 were excluded by the `!poppedIds.includes(s.id)` filter) and never called `popOut()`.

**The Bug**
```ts
// WRONG: Excludes already-popped sessions from Explode
const poppedIds: string[] = (await winApi.getPoppedSessionIds?.()) ?? []
const eligible = sessions.filter(
  (s) => !poppedIds.includes(s.id) && s.status !== 'exited'
)
```

This logic assumed Explode should only pop out NEW windows, not reposition existing ones. But the whole POINT of Explode is to tile ALL windows (new or existing) into a grid.

**Diagnosis Process**
1. Re-read Brady's problem statement: "5 active sessions, all already popped, still overlap after clicking Explode"
2. Noticed `useExplode` filters `!poppedIds.includes(s.id)` — excludes already-popped
3. Created diagnostic e2e test that manually pops 5 windows, then calls useExplode logic inline
4. Test revealed: eligible.length === 0 when all 5 are already popped
5. Confirmed: The setBounds() fix from my previous work WAS working (manual `popOut()` calls with bounds succeeded)
6. Real bug: `useExplode` was never CALLING `popOut()` because it filtered out all sessions

**The Fix**
Removed the already-popped filter from `useExplode.ts`:
```ts
// CORRECT: Include ALL non-exited sessions in Explode, regardless of pop-out state
const eligible = sessions.filter((s) => s.status !== 'exited')
```

Also updated `App.tsx` badge count to match:
```ts
// CORRECT: Badge shows all non-exited sessions (matches Explode behavior)
const eligibleExplodeCount = sessions.filter(s => s.status !== 'exited').length
```

**Why My First Test Missed This**
`tests/explode-bounds.spec.ts` (from my first fix) manually called `popOut()` with computed tile bounds, bypassing `useExplode` entirely. It verified that calling `popOut(id, bounds)` on existing windows works (which it does, thanks to the setBounds() fix), but didn't catch that the React hook never generates those calls.

**Impact**
- Explode now correctly tiles ALL non-exited sessions (whether popped or not)
- Previously popped windows are repositioned to fit the grid
- New sessions are popped and positioned
- Main window is NOT included in the tile layout (only popped-out sessions)

**Testing**
- ✅ Created `tests/explode-real-ui.spec.ts` — tests the actual `useExplode` hook logic, not just manual `popOut()` calls
- ✅ Created `tests/explode-already-popped.spec.ts` — diagnostic test showing manual `popOut()` with bounds works
- ✅ All 24 tiling unit tests pass
- ✅ 8/9 multi-window e2e tests pass (1 unrelated UI flake about button locators)
- ✅ Build green

**Key Files**
- `src/renderer/hooks/useExplode.ts` — Removed already-popped filter
- `src/renderer/App.tsx` — Updated badge count logic
- `tests/explode-real-ui.spec.ts` — New e2e test using actual useExplode logic
- `tests/explode-already-popped.spec.ts` — Diagnostic test for manual popOut calls

**Debug Technique: Always Test the ACTUAL Code Path**
When Brady reported "Explode still broken", my first test (explode-bounds.spec.ts) was passing because it tested a DIFFERENT code path (manual `popOut()` calls) than the one users actually trigger (the `useExplode` React hook via DisplayPicker). This is why the test passed but Brady's UI was still broken.

**Lesson:** When writing regression tests, trace the FULL user action flow (button click → event handler → React hook → IPC call → main process → Electron API) and test at the highest possible level (the actual UI interaction), not just the low-level plumbing (the IPC handler). Integration tests > unit tests for catching interaction bugs.

### 2026-04-18 — Three Explode Fixes This Session (First Two Missed Real Bugs)

**Honest reflection:** Shipped 3 Explode fixes in this session, but first two (commits baf7fe7, 42e3618) were based on incomplete root cause analysis.

**Fix 1 (baf7fe7):** Made `WindowManager.popOut()` call `setBounds()` for existing windows.
- **Passed test:** ✅
- **Passed e2e:** ✅
- **Fixed real bug:** ❌ (It was a red herring. The method works fine.)
- **Root cause missed:** useExplode filter prevented method from being called; useExplode also never included main window in tile grid.

**Fix 2 (42e3618):** Removed already-popped filter from `useExplode.ts`.
- **Passed test:** ✅
- **Passed e2e:** ✅
- **Fixed real bug #1:** ✅ (Already-popped windows now included in eligible set)
- **Root cause missed:** Main window was still exempt from tile grid.

**Fix 3 (09793b0):** Added `WindowManager.setMainBounds()`, included main window in tile grid.
- **Passed test:** ✅
- **Passed e2e:** ✅
- **Fixed real bug #2:** ✅ (Main window now tiles alongside popouts)
- **Final validation:** 17-window scenario, 5×4 grid on 2328×1266, zero overlap ✓

**Why multiple misses:**
1. Each fix was individually correct at its level (popOut method works, filter logic fixed, main window included)
2. But each test only covered the aspect being fixed, not the full integration
3. Each test passed independently, so each fix shipped
4. Brady's real scenario exercised all three issues together — they combined into visible overlap

**Why parallel independent diagnosis worked:**
- Spawned two Dannys (sonnet-4.5 + opus-4.7) in parallel with different debugging approaches
- sonnet focused on hook logic and filter — found bug #1
- opus focused on live window bounds capture — found bug #2
- Both bugs were real, complementary, and stacked
- Independent analysis uncovered each missing piece that the other's approach might have bypassed

**Pattern recommendation:** When prior async fixes keep missing real bugs (1→2→3 sequence), consider parallel independent diagnosis. Two different models with different debugging techniques can each find blind spots the other would have missed.


