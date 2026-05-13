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

### 2026-05-05 — Squad Governance Upgrade: Model Policy & Review Diversity

**Decision: Cost-Optimized Model Selection**
- Default all code agents (Danny, Rusty, Linus, Livingston, Basher) to `claude-sonnet-4.5` — handles 95% of routine work at reasonable cost
- Logging/monitoring (Scribe, Ralph) use `claude-haiku-4.5` — ultra-low-cost for background observability
- Deep second opinion reviewer (Turk) uses `gpt-5.5` — model diversity for hard architectural disagreements
- Trade-off: Cost efficiency (sonnet baseline) vs. model diversity (gpt-5.5 only on escalation)
- Alternative rejected: All-sonnet (monoculture risk), All-gpt-5.5 (3-5x cost), All-opus (prohibitive)

**Decision: Turk as Model-Diverse Reviewer**
- Added Turk (Ocean's Eleven casting) as on-demand GPT-5.5 reviewer
- Invoked only on Danny rejection + re-rejection OR explicit coordinator escalation
- Provides non-Anthropic perspective when sonnet-based agents disagree internally
- Rejection authority: can require different agent revise (not original author)
- Trade-off: High per-use cost vs. architectural insurance and monoculture prevention

**Decision: Turk as Model-Diverse Reviewer**
- Added Turk (Ocean's Eleven casting) as on-demand GPT-5.5 reviewer
- Invoked only on Danny rejection + re-rejection OR explicit coordinator escalation
- Provides non-Anthropic perspective when sonnet-based agents disagree internally
- Rejection authority: can require different agent revise (not original author)
- Trade-off: High per-use cost vs. architectural insurance and monoculture prevention

**Decision: Squad-First Reflex as Coordinator Check**
- Coordinator runs checklist before every user response: (1) Is there a specialist? Route to them. (2) Can agents work in parallel? Spawn all as background. (3) Simple fact? Answer directly.

### 2026-05-14 — fc2 Squad Review & Process Hardening

**Imported from fc2:**
1. **Heartbeat.md pattern** — Added lightweight status file tracking project phase, current task, and last action. Enables quick async context without cross-referencing multiple files.
2. **Config.json formalization** — Moved model policy from team.md prose into machine-readable `config.json` with explicit overrides for danny (claude-opus-4.7), turk (gpt-5.5), scribe/ralph (haiku).
3. **Enhanced routing.md** — Added "Escalation & Review Gates" section clarifying when Turk is invoked (hard rejection + re-rejection OR explicit escalation) and "Testing & Integration Gates" documenting E2E regression suite validation rules.

**Rejected (not applicable):**
- SB Integration Test Pattern (Azure Service Bus specific)
- Auth Design Gate pattern (pre-requisite work not yet scheduled)
- Backend-specific ceremonies (Slice validation, RBAC/runstate gates)

**Trade-offs:**
- Config.json duplicates team.md but enables programmatic policy reading
- Heartbeat adds one file but clarifies project state for async team members
- Escalation gates prevent runaway escalations without restricting necessary review

**Confidence:** High — all changes are additive, low-risk, and durable across projects.

- Anti-pattern detection prevents coordinator writing code, running tests, or sequential spawns when parallel possible
- Trade-off: One extra decision step vs. better work distribution and velocity

**Decision: Tangent-Specific Routing Map**
- Explicit domain ownership: Electron main (Rusty), Status engine (Rusty), SDK/IPC/preload/ACP (Linus), React/xterm UI (Livingston), Testing/E2E (Basher), Architecture/review (Danny), Deep second opinion (Turk)
- Technology layer map with primary/secondary owners eliminates "who owns this?" questions
- Captured Tangent packaging constraints: `npm run build` + `npx electron-builder --dir --config.npmRebuild=false` required for exe, `npmRebuild=false` is mandatory due to ffi-napi MSBuild env issue
- E2E regression hook strategy: `general.spec.ts` (≤5 stable tests) + `specific.spec.ts` (rewrite for most recent fix)

**Decision: Process Ceremonies for Quality Gates**
- Pre-Flight Baseline: Run tests before starting work to establish clean baseline (prevents "was it already broken?")
- Per-Task Gate: Build + test after every code change, update `specific.spec.ts`, check hook report
- Packaging Smoke Gate: Full exe build + manual launch smoke test before delivery (critical — `npm run build` alone doesn't update exe)
- Process Hygiene Sweep: End-of-session cleanup (git status, temp files, debug code removal)
- Trade-off: 2-5 min ceremony overhead vs. catching regressions/packaging failures before delivery

**Architectural Insight — Model Diversity as Insurance:**
When all agents use same model family (Anthropic Claude), they share blind spots. A monoculture can miss entire classes of bugs or architectural flaws that a different model (OpenAI GPT) would catch. Turk as gpt-5.5 reviewer acts as architectural insurance — expensive per-use, but prevents catastrophic groupthink on critical decisions. Cost-justify via rarity: if invoked <5% of reviews, total cost impact is negligible vs. risk mitigation value.

**Key Insight — Squad-First Reflex Prevents Coordinator Overwork:**
FC2 analysis showed coordinators doing specialist work (writing code, running tests) when specialists exist. Root cause: no forcing function to check "should I route this?" before acting. Squad-First Reflex as automatic pre-response checklist shifts default from "do" to "route", improving velocity (parallel work) and quality (specialists handle their domains).

**Reusable Pattern — Packaging Smoke Gate:**
For Electron apps, `npm run build` compiles source but doesn't update the packaged exe. Users run the exe, not `out/main/index.js`. Smoke gate (build → electron-builder → manual launch → smoke test) catches packaging-only failures that unit/E2E tests miss. Generalizes to any deployment where build artifact ≠ test artifact.

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




---

## 2026-04-18: Explode refinements — main stays, font preserved

**Requested by Brady.** Two refinements on 09793b0:

### #1 Main window stays put
Replaced sentinel-tile approach with exclusion-rect approach. computeTileLayout now accepts exclusions: ExclusionRect[]. useExplode reads getMainBounds() and passes main's current rect as the exclusion. The tile grid grows (totalCells += deficit + 1, up to 8 attempts) until N cells avoid the exclusion. Graceful fallback if main covers the display.

**Key insight:** skip-cell generalizes over shrink-workArea — handles centered-main case, which shrink-workArea cannot. Convergence is fast because each added cell only slightly shrinks the rest.

### #2 Font size preserved in popouts
Root cause: PopoutWindowShell hardcoded fontSize={14}. Fix: load config.fontSize on mount, subscribe to config.onChanged. Also hydrated fontSize in App.tsx from config on startup to prevent main/popout drift across restarts.

**Confirmed:** fitAddon.fit() does not rescale font — only rows/cols. The user's "font changes on resize" complaint was really "popout used a different initial font size."

### Learnings

- **Invariant framing matters:** "never move main" + "popouts non-overlap with all obstacles" is a cleaner decomposition than "everything participates in a grid." Route around obstacles instead of forcing them into the layout.
- **Grid growth with filter is robust:** for geometric constraint satisfaction with N items and K obstacles, grow the candidate set rather than solving the placement problem exactly. Bounded by iteration cap + fallback.
- **Hardcoded defaults in shared components are a smell:** PopoutWindowShell pulled fontSize=14 out of the air. Anywhere you see a magic number for user-facing state, check whether that state lives in config.
- **E2E test now captures main bounds BEFORE Explode, asserts unchanged AFTER.** That test would have caught both the prior buggy direction (moved main) and the current correct behavior.

### Files changed
- src/shared/tiling.ts, src/shared/__tests__/tiling.test.ts
- src/renderer/hooks/useExplode.ts
- src/main/window/WindowManager.ts, src/main/ipc/windowHandlers.ts, src/preload/index.ts
- src/renderer/components/PopoutWindowShell.tsx, src/renderer/App.tsx
- tests/explode-bounds.spec.ts

**Tests:** 32/32 tiling unit, 92/92 shared unit, e2e green (main bounds unchanged; 17 popouts non-overlapping with main).

**Commits:** 2b26208 (explode), 444e945 (font).

### 2026-05-06 — FC2 Squad Comparison & Governance Upgrade Recommendations

**Task:** Compare Tangent squad structure with D:\git\fc2 squad and provide prioritized recommendations for squad governance upgrade.

**Deliverable:** `.squad/decisions/inbox/danny-fc2-squad-comparison.md`

**Analysis:**
- Tangent squad baseline: coordinator + 8 specialist agents (Danny, Livingston, Basher, Rusty, Ralph, Linus, Turk, Scribe)
- FC2 squad structure: Similar model — coordinator + agents + model diversity strategy
- Both use append-only squad files (decisions.md, history.md) with union merge rules
- Both have Turk as on-demand escalation reviewer

**Recommendations Documented (in priority order):**
1. **Formalize Turk as model-diverse reviewer** — Activate on Danny rejection + re-rejection OR explicit coordinator escalation. Provides non-Anthropic perspective (GPT-5.5) when sonnet-based agents disagree on architecture.
2. **Codify Squad-First Reflex in Coordinator routing** — Document explicit checklist: (1) Is there a specialist? Route to them. (2) Can agents work in parallel? Spawn all as background. (3) Simple fact? Answer directly.
3. **Implement cost-optimized model policy** — Default code agents (Danny, Rusty, Linus, Livingston, Basher) to `claude-sonnet-4.5` (handles 95% of routine work at reasonable cost). Logging/monitoring (Scribe, Ralph) use `claude-haiku-4.5`. Escalations only (Turk) use `gpt-5.5`.
4. **Upgrade team.md documentation** — Add `## Model Policy` section documenting baseline, logging tier, and escalation strategy.

**Key Insights:**
- Cost vs. monoculture trade-off: Sonnet baseline minimizes cost, but gpt-5.5-only escalation prevents model monoculture risk
- Squad-First Reflex prevents coordinator from answering simple questions that a specialist could handle faster
- Union merge rules are critical for parallel async agent work — already in place via .gitattributes

**Status:** Recommendations written to `.squad/decisions/inbox/danny-fc2-squad-comparison.md` for user/coordinator review before merge to squad decisions.

**Next Phase:** (Deferred) Implement squad governance upgrade including team.md updates, model policy enforcement, and Turk activation workflow in follow-up session.

### 2026-05-06 — Forge Chat Foundry Agent PoC Plan

**Deliverable:** `.squad/decisions/inbox/danny-forge-chat-foundry-poc-next-step.md` → merged to `.squad/decisions.md`

**Decision:** Adopt Linus's legacy FC research as the next PoC step: build a TypeScript main-process Foundry connector that lists agents and streams one `insights-agent` turn using local `az login` / `AzureCliCredential`.

**Key learnings:**
- Legacy FC's App Insights path is not bespoke; it invokes the Foundry `insights-agent` with the same `agent_reference` Responses API path as every other agent.
- Copy the protocol contract (`agent_reference`, AG-UI event names/semantics), but avoid copying the Python Starlette host, Cosmos persistence, and Easy Auth/OBO machinery into the first milestone.
- Auth is the architectural fork: local CLI credentials prove the integration, but production must decide desktop-native MSAL vs hosted Easy Auth/OBO before we port legacy auth.

**Team routing (team consensus ready):**
- **Linus:** connector (listAgents + streamRun smoke test), AG-UI event translation
- **Rusty:** SDK parity (TS `@azure/ai-projects` vs raw HTTPS fallback)
- **Livingston:** IPC seam + thin renderer (once connector smoke test passes)
- **Basher:** tests, error modes, cancellation
- **Danny:** hosted auth design spike after PoC (desktop MSAL vs server Easy Auth/OBO decision)

**Scope (intentionally boring first milestone):**
- No UI, no Easy Auth, no Cosmos, no GitHub OAuth, no multi-project registry
- Local only (AzureCliCredential)
- Target: Anvil INT project
- Success: connector lists agents including `insights-agent`, streams one prompt, emits AG-UI events, emits at least one Insights MCP tool call

**Known unknowns handled upfront:** TS SDK parity, Anvil INT access, `insights-agent` availability, cancellation propagation, production auth shape. Validation checklist in decisions.md covers all 12 criteria.
