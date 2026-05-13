# Basher — History

## Core Context

- **Project:** Electron terminal app with hybrid PTY+SDK architecture for AI agent orchestration
- **Role:** Tester
- **Joined:** 2026-04-13T01:57:51.252Z

## Learnings

### 2026-05-12: Terminal/Rail Layout Regression Pattern

**Session:** terminal-wrap-agent-rail-regression (2026-05-12T23:00:00Z)

**Problem Solved:** User reported xterm text wrapping/render fragments into the narrow area under or behind the right AgentsSidebar rail.

**Regression Pattern:** For terminal layout bugs, assert bounding boxes for the visible contract rather than screenshots:
- Anchor the terminal area with `data-testid="terminal-column"`.
- Anchor the always-visible right rail from the accessible "Add project" button and its rail ancestor.
- Force a long terminal line, then assert `.xterm`, `.xterm-screen`, `.xterm-rows`, and `.xterm-viewport` stay within the terminal column and end before the rail.
- Check both edge containment and overlap so width expansion and sidebar underlap fail deterministically.

**Outcome:** Rewrote `tests/regression/specific.spec.ts` for the latest xterm/AgentsSidebar layout fix. Targeted Playwright regression passed.

### 2026-05-06: Keyboard Quick-Launch Auto-Expand Coverage Decision

**Session:** compact-mode-keyboard-quicklaunch (2026-05-06T11:52:00Z)

**Problem Analyzed:** After Livingston fixes the keyboard quick-launch restore path (Ctrl+Shift+1-9 to launch agents while in compact mode), Coordinator requested regression coverage if practical.

**Technical Analysis:**
- Keyboard quick-launch (Ctrl+Shift+1-9) calls `launchAgentByIndex()` → `launchAgent()` in `AgentStore`
- The fix would add compact-mode awareness to the launch path (similar to session-click auto-expand)
- E2E test would require:
  1. Agents pre-configured in test environment (AgentStore reads from disk via `tangentAPI.agents.list()`)
  2. Knowing which agent index maps to which key (brittle, environment-dependent)
  3. Predictable agent profiles in the sidebar (external dependency, not controlled by test)

**Solution Delivered:** Documented limitation with explicit NOTE comment in `tests/regression/specific.spec.ts`:
```typescript
// NOTE: Keyboard quick-launch (Ctrl+Shift+1-9) auto-expand is NOT tested here.
// Testing it would require:
//   1. Agents pre-configured in the test environment (AgentStore reads from disk)
//   2. Knowing which agent index maps to which session/key (brittle)
//   3. Predictable agent launch state (external dependency)
// The session-click path above validates the core BrowserWindow expand/collapse
// behavior. The keyboard shortcut path is covered by manual testing.
```

**Outcome:** Kept existing session-click BrowserWindow regression (test passes). Keyboard quick-launch auto-expand will be validated through manual testing due to agent configuration brittleness in E2E environment.

**Regression Suite Status:** All tests pass (general=5 passed, specific=1 passed).

### 2026-05-06: Compact Mode BrowserWindow Regression

**Session:** compact-mode-window-resize (2026-05-06T00:00:00Z)

**Problem Solved:** User reported compact mode only hides terminal DOM content but doesn't resize the actual Electron BrowserWindow. Existing regression only checked terminal column width, missing the window-level behavior.

**Solution Delivered:** Strengthened `tests/regression/specific.spec.ts` to verify BrowserWindow resizing:
- Added `app.evaluate(({ BrowserWindow }) => ...)` calls to read window bounds before/during/after compact mode
- Assert window width reduces by >400px when entering compact mode (measured: ~896px reduction)
- Assert compact window stays below 600px wide
- Assert window expands by >400px when auto-exiting compact mode
- Verified implementation was already in place and working correctly

**Outcome:** Full regression suite passes (6/6). Test now catches both DOM-only and window-resize regressions. Implementation confirmed functional with 1201px → 305px → 1202px width transitions.

**Key Technique:** Used Playwright Electron `app.evaluate()` API to access main process BrowserWindow.getAllWindows()[0].getBounds() for window-level assertions, complementing existing DOM boundingBox checks.

### 2026-05-05: Session Waiting Color Fix — Test Instrumentation Outcome

**Session:** session-waiting-color-fix (2026-05-05T23:22:13Z)

**Problem Solved:** Session panel waiting color regression required deterministic automation. Real Copilot launch/resume scenarios are slow/flaky; no stable test hooks existed for asserting visual state on selected rows.

**Solution Delivered:** Test instrumentation for visual regression coverage:
- Exposed session row test identifiers via `data-test-*` attributes
- Implemented `tangentAPI.test.setSessionState()` helper (NODE_ENV=test only)
- Rewrote `tests/regression/specific.spec.ts` with selected-waiting scenario
- Assert visible waiting color (dot, bar, background, glow) on active Copilot row

**Outcome:** Focused Playwright test passes. Regression suite green. Ready for Coordinator merge.

### 2026-04-13 — Anticipatory Test Scaffolding for Remote Execution Managers

**Context:** Three manager classes are being built in parallel by Rusty (backend engineer) for the remote agent offloading feature:
1. `DevBoxManager` — Azure Dev Box lifecycle and health checks
2. `SshTunnelManager` — SSH tunnel management with auto-reconnect
3. `AcpClient` — Agent Client Protocol integration

**What I did:**
Created comprehensive test scaffolds for all three managers based on type definitions from `src/shared/devbox-types.ts` and `src/shared/acp-types.ts`. Tests cover happy path, error cases, edge cases, and complex flows like exponential backoff and reconnection logic.

**Test file structure:**
- `src/main/devbox/__tests__/DevBoxManager.test.ts` (370 LOC)
  - listDevBoxes: arrays, empty, errors
  - startDevBox/stopDevBox: lifecycle, idempotency, timeouts
  - getConnectionInfo: connection details, missing boxes
  - checkHealth: SSH reachability, health status
  - autoStart: polling, timeout, already-running optimization

- `src/main/devbox/__tests__/SshTunnelManager.test.ts` (390 LOC)
  - createTunnel/closeTunnel: success, auth failures, already-closed
  - getTunnelStatus: connected/disconnected/reconnecting states
  - Health monitoring: error detection, event emission
  - Auto-reconnect: exponential backoff (1s, 2s, 4s, 8s, max 30s), max retry exhaustion

- `src/main/devbox/__tests__/AcpClient.test.ts` (450 LOC)
  - connect/disconnect: success, ECONNREFUSED, auth failures
  - createSession/sendPrompt: session lifecycle, invalid config
  - Permission bridge: request/response flow, approval/denial
  - Session ID mapping: tangent ↔ ACP bidirectional lookup
  - Reconnection: tunnel recovery, session restoration, state events

**Testing patterns followed:**
- Vitest (`describe`/`it`/`expect`/`vi.mock()`)
- Mock external dependencies (@microsoft/devbox-mcp, ssh2, @agentclientprotocol/sdk, net)
- EventEmitter pattern for manager events
- Fake timers for async delays (polling, backoff)
- Table-driven tests where appropriate (not used here, but considered)

### 2026-04-13 — Validation Script False Alarm

**Context:** Copilot reported PowerShell syntax errors in `.squad/scripts/validate-squad-process.ps1`:
- "The Try statement is missing its Catch or Finally block" at line 133
- "Missing closing '}' for the `if (Test-Path $hookReportPath)` block around line 115"

**What I did:**
Ran the validation script from the repo root. It executed successfully with exit code 0, all 6 structural checks passed (team.md, routing.md, ceremonies.md, .gitattributes union rules, hook report parsing, packaged exe check). No PowerShell parse errors were encountered.

**Outcome:**
The script is syntactically correct and functionally sound. The reported errors may have been from an earlier transient state or a different file version. No changes needed.

### 2026-04-13 — ACP Integration Tests (P2.11)

**Context:** Needed comprehensive integration tests for `AcpClient` that cover the full protocol lifecycle, not just unit behaviors. Tests should validate end-to-end flows: connection → session creation → permission handling → error recovery → disconnect.

**What I did:**
Created `src/main/devbox/__tests__/acp-integration.test.ts` with 37 tests organized into 6 suites:

**Test suite structure:**
1. **Connection Lifecycle** (6 tests)
   - Connects and initializes ACP protocol with version negotiation
   - Handles connection failures gracefully (network timeout, init errors)
   - Disconnects cleanly with session cleanup
   - Prevents multiple simultaneous connections
   - Handles connection closed (graceful + error paths)

2. **Session Management** (9 tests)
   - Creates sessions with full workspace config (cwd, env, mcpServers)
   - Resumes sessions via `unstable_resumeSession` (preferred path)
   - Falls back to `loadSession` when `unstable_resumeSession` unavailable
   - Throws error when agent lacks session resumption support
   - Closes sessions and removes bidirectional ID mappings
   - Tracks multiple concurrent sessions independently
   - Maps Tangent session IDs ↔ ACP session IDs bidirectionally
   - Sends prompts to correct ACP session via ID mapping
   - Updates `lastActiveAt` timestamp on prompt send

3. **Permission Bridge** (7 tests)
   - Forwards permission requests from ACP server to client (via `requestPermission` handler)
   - Sends approval back to ACP (`allow` outcome)
   - Sends approval with remember choice (`allow_always`)
   - Sends denial back to ACP (`deny` outcome)
   - Sends denial with remember choice (`deny_always`)
   - Handles permission timeout (60s default → auto-deny)
   - Denies permission for unknown sessions

4. **Error Recovery** (7 tests)
   - Reconnects after tunnel drop (create new client, resume sessions)
   - Retries failed operations (temporary failure → success on retry)
   - Reports unrecoverable errors (protocol version mismatch)
   - Handles session creation errors gracefully (invalid workspace path)
   - Handles prompt send errors gracefully (session terminated)
   - Handles session close errors gracefully (close failed)
   - Continues disconnect even if individual session closes fail

5. **Session Updates & Messages** (6 tests)
   - Processes session updates with text messages (extracts assistant content)
   - Processes session updates with tool executions (maps toolCalls → AcpToolExecution)
   - Maps stop reason to status (`end_turn` → `completed`, `error` → `error`)
   - Updates session metrics from usage data (inputTokens, outputTokens, cacheTokens)
   - Updates `lastActiveAt` on session update
   - Handles session updates for unknown sessions gracefully (logs warning, no crash)

6. **End-to-End Workflow** (2 tests)
   - Completes full session lifecycle (connect → create → prompt → close → disconnect)
   - Manages multiple concurrent sessions (create 3, prompt all 3, close 1, verify mappings)

**Mock challenges solved:**
- **Closed promise handling:** Required nullable resolve/reject refs to avoid stale closures across test cases
- **Dynamic mock methods:** Mock `unstable_resumeSession`/`loadSession` availability by creating fresh `ClientSideConnection` instances per test
- **Client handler capture:** Captured `requestPermission` and `sessionUpdate` handlers from `ClientSideConnection` constructor to simulate ACP server → client calls
- **Fake timers:** Used `vi.useFakeTimers()` for permission timeout test (60s fast-forward)

**Key insight:**
Integration tests require mocking at the SDK boundary (ClientSideConnection, ndJsonStream) but exercising the full AcpClient logic. Unit tests (`AcpClient.test.ts`) already cover individual methods; integration tests validate the *orchestration* across connection → sessions → permissions → updates → errors.


**Important notes:**
1. **These are anticipatory tests** — written based on type signatures and PRD requirements, NOT final implementations
2. Some method signatures may not match actual implementations (e.g., `manager.dispose()`, `client.reconnect()`, `manager.checkHealth()`)
3. Exponential backoff test logic may need adjustment after seeing real reconnect implementation
4. Event names (`tunnel-error`, `connection-state-changed`, etc.) are inferred from similar patterns in SessionStore/StatusEngine — may need updates
5. Mock structure assumes common patterns but actual SDK APIs may differ

**Next steps:**
- Once Rusty completes manager implementations, review test failures and adjust
- Add integration tests for orchestration flows (P2.4, P3.4)
- Coordinate with Linus on IPC handler tests once preload bridge exists

**Why this matters:**
Proactive test scaffolding enables:
- Rusty to run tests as implementations progress (TDD-style feedback)
- Earlier detection of API mismatches between types and implementations
- Faster convergence on correct interfaces through test-driven iteration
- Clear documentation of expected behavior for all three managers

### 2026-04-13 — DevBox Lifecycle Integration Tests (P1.13)

**Context:** Created comprehensive integration tests for the complete DevBox connection flow orchestrated by `DevBoxConnector`. Unlike unit tests that mock dependencies, integration tests validate end-to-end workflows with multiple components working together.

**What I did:**
Created `src/main/devbox/__tests__/integration.test.ts` with 33 tests (all passing) organized into 9 suites:

**Test suite structure:**
1. **Full Connection Flow** (2 tests)
   - Orchestrates complete flow: autoStart → ensureOpenSsh → createTunnel → verify → ready
   - Validates custom SSH config (localPort, remotePort) is passed through correctly

2. **Auto-Start Polling** (4 tests)
   - Polls Dev Box state until Running with progress callbacks
   - Handles Dev Box already running (no-op optimization)
   - Fails if Dev Box enters Failed state
   - Fails on timeout (5 minutes) waiting for Dev Box to start

3. **SSH Tunnel Creation** (3 tests)
   - Creates SSH tunnel with correct ports from connection info
   - Passes SSH config to tunnel manager
   - Fails if tunnel creation throws error

4. **Health Monitoring** (3 tests)
   - Waits for tunnel to be ready (polls until status=connected)
   - Detects tunnel health check failures (reflects in connection status)
   - Times out if tunnel never becomes ready (5s timeout)

5. **Reconnection with Backoff** (3 tests)
   - Triggers reconnect when tunnel enters error state
   - Reflects exponential backoff attempts (1s, 2s, 4s, 8s, max 30s)
   - Handles max reconnect attempts reached (updates state to failed)

6. **OpenSSH Provisioning** (4 tests)
   - Provisions OpenSSH on first-time setup (install → enable → verify)
   - Skips provisioning if OpenSSH already running
   - Fails if OpenSSH installation fails
   - Fails if OpenSSH verification fails

7. **Connection Failure Scenarios** (5 tests)
   - Fails at step 1: Dev Box won't start
   - Fails at step 2: SSH provisioning fails
   - Fails at step 3: tunnel creation fails
   - Fails at step 4: health check fails
   - Fails if Dev Box has no connection info

8. **State Transitions** (4 tests)
   - Emits events through complete connection lifecycle (starting → provisioning → tunneling → ready)
   - Emits failed event on any error
   - Emits disconnected event on manual disconnect
   - Tracks state through internal connection handle (ConnectionHandle)

9. **Disconnect Flow** (3 tests)
   - Cleans up tunnel and removes connection from registry
   - Handles disconnect of non-existent connection gracefully
   - Handles disconnect when tunnel close fails (marks as failed but continues)

10. **Multiple Connections** (2 tests)
    - Manages multiple connections independently (different tunnels, states)
    - Disconnects one connection without affecting others

**Mock architecture:**
- Mocked `DevBoxManager`, `SshTunnelManager`, `OpenSshProvisioner`, `RsyncManager` (EventEmitter-based mocks)
- Mocked `ssh2.Client` module to avoid real SSH connections
- Mocked `fs.readFileSync` to avoid file system access
- Injected SSH client factory into `DevBoxConnector` for testability
- Followed exact pattern from existing `DevBoxConnector.test.ts` unit tests

**Key testing patterns:**
- Event tracking: Capture all emitted events to verify orchestration order
- State verification: Check `ConnectionHandle` state at each step
- Async coordination: Use `mockImplementation` + `setTimeout` for async readiness
- Error injection: Mock failures at each orchestration step to validate error handling
- Timeout simulation: Mock `getTunnelStatus` to return 'connecting' indefinitely for timeout tests

**Mock challenges solved:**
- **SSH client factory injection:** DevBoxConnector accepts optional factory; tests inject factory that creates MockSshClient instances
- **File system access:** Avoided keyPath tests that require real file reading (delegated to unit tests)
- **EventEmitter coordination:** Used `vi.fn().mockImplementation()` to capture events and simulate async state changes
- **Test isolation:** Clear `mockSshClients` array in `beforeEach` to prevent cross-test pollution

**Important insights:**
1. Integration tests validate *orchestration* (step sequencing, event flow), not individual method behavior
2. Mocks should be at component boundaries (managers) not internal implementation (fs, net, ssh2)
3. Real SSH connections would make tests slow and flaky — always mock external I/O
4. `sshClientFactory` injection enables test isolation without breaking production code
5. Test timeouts (e.g., 10s for tunnel timeout test) must account for polling intervals

**Next steps:**
- Monitor test stability as DevBoxConnector evolves
- Add integration tests for rsync sync operations when implemented
- Coordinate with Rusty if DevBoxManager API changes break tests


### 2026-04-13 — Fixed DevBoxConnector Tests After SSH Elimination (P1.14)

**Context:** Rusty eliminated SSH as a middleman for ACP connectivity in DevBoxConnector.ts. The new architecture uses DevTunnelManager to forward the ACP port (3000) directly via devtunnel connect, bypassing SSH entirely. This broke 14 of 21 tests in DevBoxConnector.test.ts and 27 of 33 tests in integration.test.ts.

**Root cause:** Tests didn't inject MockDevTunnelManager, connection info lacked tunnelId, and SSH-specific assertions were obsolete.

**What I did:**
1. Added MockDevTunnelManager class to both test files with connect/disconnect/getLocalAcpPort methods
2. Injected MockDevTunnelManager into DevBoxConnector constructor (4th param)
3. Updated all mock DevBox connection info to include tunnelId: 'test-tunnel-id'
4. Removed SSH-specific assertions (ensureOpenSsh, createTunnel, SSH tunnel ID checks)
5. Replaced with DevTunnel assertions (devTunnelManager.connect, acpLocalPort checks)
6. Replaced obsolete SSH tests with DevTunnel equivalents
7. Updated state transition tests to remove 'ensuring-ssh' state
8. Fixed net module mock for _waitForAcpReady() TCP probes using process.nextTick()

**Test results after fixes:**
- DevBoxConnector.test.ts: 10 of 21 passing (11 timing out due to ACP port verification delay)
- integration.test.ts: Updates partially complete (MockDevTunnelManager added, tunnelId added to fixtures)

**Remaining issues:**
- 11 tests timeout waiting for _waitForAcpReady() (5s timeout in code, 5s test timeout)
- Net mock emits 'connect' on process.nextTick(), but promise wrapper may not register listeners in time
- May need to adjust test timeouts or mock event emission timing

**Key learnings:**
1. When eliminating a dependency (SSH), ALL test mocks need corresponding updates
2. Connection info structure changes (adding tunnelId) must propagate to test fixtures
3. Mocking net.createConnection for TCP probes requires careful event timing
4. Test timeouts should exceed code-under-test timeouts to avoid false negatives
5. State transition tests are fragile — document expected state flow in test names

### 2026-04-19: Exclusion-Rect Tiling Invariant (New Tester Checklist)

From Danny's refinement #1 (Explode keeps main window in place):

**New architectural invariant to validate in Explode tests:**

When Explode runs with the exclusion-rect approach:
1. **Main window position is preserved** — exact same bounds before/after Explode (x, y, width, height unchanged)
2. **Popouts tile around main** — no popout overlaps main window's exclusion rect
3. **Graceful degradation** — if main covers >50% of display, grid returns fewer cells (not fewer cells + overlap)
4. **No resizing of main** — main window is never repositioned or resized by Explode

**Test Coverage (Danny's work):**
- `tests/explode-bounds.spec.ts`: Captures main bounds before/after, asserts unchanged
- `src/shared/__tests__/tiling.test.ts`: 8 new exclusion-rect tests (32/32 passing)
  - Main at center → popouts tile around edges
  - Main at corner → popouts use remaining space
  - Main covers >50% → fewer cells returned
  - Invalid exclusion rect → silently ignored

**For future Explode bugs:**
- Always capture ALL windows in overlap assertion, not filtered subset (lesson from prior bug: assertion on popout-only subset missed overlap with main)
- Verify exclusion rect is correctly computed from main's actual bounds (common bug: stale/default bounds instead of current position)
- Test with Brady's multi-monitor setup: verify tiles respect display.workArea (excludes taskbar)

### 2026-05-06: StatusBar Label Removal Regression

**Session:** statusbar-label-cleanup (2026-05-06T14:06:42Z)

**Problem Solved:** After removing the agent type label display from the status bar (e.g., "Copilot CLI", "Shell", "Claude Code"), needed targeted regression test to prevent reintroduction.

**Solution Delivered:** Updated `tests/regression/specific.spec.ts` with precise DOM selector strategy:
- Used `button[title="Settings"]` as anchor to locate status bar via XPath ancestor traversal
- Selected only the center section div (`.flex.items-center.gap-2.min-w-0.flex-shrink`) to avoid false positives from session panel or terminal content
- Verified forbidden labels ('Copilot CLI', 'Claude Code', 'Shell', 'No Session') do not appear in that specific region
- Maintained sanity check that 'Ctrl+B panels' still renders

**Initial Test Failure:** First attempt used `.filter({ hasText: /Ctrl\+B panels/i })` which captured entire page content including session rows and terminal output, causing false positives when "Shell" appeared elsewhere in the UI.

**Key Technique:** When testing status bar elements, use structural selectors (class combinations, aria attributes, XPath ancestors) rather than text-based filters to avoid capturing unrelated UI regions with similar text.

**Outcome:** Full regression suite passes (6/6). Test now specifically validates the status bar center section isolation, not global page text.

### 2026-05-05 — Squad V2 Validation Guardrails

**Context:** Tangent Squad is upgrading from V1 to V2. Need validation guardrails for structural compliance that are safe on dirty worktree and don't run expensive builds/tests.

**What I did:**
Created three artifacts to support Squad V2 upgrade:

1. **Verified .gitattributes union merge rules** (already present):
   - `.squad/decisions.md merge=union`
   - `.squad/agents/*/history.md merge=union`
   - `.squad/log/** merge=union`
   - `.squad/orchestration-log/** merge=union`

2. **Created .squad/scripts/validate-squad-process.ps1** — Non-destructive validation script with 6 checks:
   - `.squad/team.md` has `## Members` and `## Model Policy`
   - `.squad/routing.md` mentions Response Mode Selection and Squad-First Reflex
   - `.squad/ceremonies.md` mentions Per-Task Gate and Packaging Smoke Gate
   - `.gitattributes` contains union merge rules for append-only Squad files
   - Reports latest regression hook status from `test-results/hook-report.json` (informational only, never fails)
   - Reports package status at `dist\win-unpacked\Tangent.exe` (warns by default, fails with `-RequirePackage` switch)

3. **Created .squad/scripts/README.md** — Usage documentation with examples

4. **Created .squad/decisions/inbox/basher-validation-guardrails.md** — Decision record documenting the validation approach and constraints

**Key constraints honored:**
- Does NOT copy FC2's Playwright multi-webserver assumptions (Tangent E2E launches Electron, not web servers)
- Does NOT run or modify the existing e2e hook
- Does NOT run packaging — only detects and reports package state
- Safe on dirty worktree (read-only checks, no process kills)
- Windows PowerShell style (backslashes, native cmdlets)

**Design decisions:**
- Exit 0 when required structural checks pass, exit 1 when they fail
- Package check is warning-only by default; `-RequirePackage` switch promotes to failure
- Regression hook check is informational only (never fails validation)
- Color-coded output: Yellow for section headers, Green for pass, Red for fail, Cyan for info

**Test results:**
Ran validation script — correctly detected:
- ✅ gitattributes has all 4 union merge rules
- ✅ Package exists at dist\win-unpacked\Tangent.exe (208 MB)
- ❌ team.md missing "## Model Policy" (expected — Danny handling in parallel)
- ❌ routing.md missing Squad V2 concepts (expected — Danny handling in parallel)
- ❌ ceremonies.md missing gate concepts (expected — Danny handling in parallel)
- ℹ️ No regression hook report yet (expected)

**Key learnings:**
1. **Union merge prevents Squad file conflicts** — Git will append changes to decisions.md and history.md files instead of creating merge conflicts. Critical for parallel agent work.
2. **Fast validation enables pre-commit checks** — Script runs in <1s without building/testing. Can be run after every file edit to catch regressions early.
3. **Informational vs. required checks** — Package and regression hook are informational (useful to see, but not blockers). Structural Squad files are required (must pass for Squad V2 compliance).
4. **Tangent-specific packaging workflow** — Must NOT assume FC2's multi-webserver e2e setup. Tangent packages to `dist\win-unpacked\Tangent.exe` via electron-builder, not Playwright server start.
5. **Switch-based strictness** — `-RequirePackage` allows CI/release pipelines to enforce package existence while allowing local dev to skip it.

**Impact:**
- Enables quick pre-commit checks for Squad V2 compliance (~1s runtime)
- Detects structural regressions without running full test/build pipeline
- Documents expected Squad file structure in executable form
- Provides visibility into package + regression hook status without file system navigation

### 2026-05-05 — Prompt Timeline Regression Test

**Context:** The HumanContextPanel component displays a timeline of recent user prompts captured from terminal and SDK interactions. The ContextStore maintains a ring buffer (MAX_PROMPTS=10) of prompt entries per session and exposes them via context:get and context:getPrompts IPC handlers.

**What I did:**
Created a targeted regression test in 	ests/regression/specific.spec.ts that validates the prompt timeline MVP. The test:
1. Creates/uses an existing session
2. Injects test prompts via 	angentAPI.context.recordPrompt IPC (stable test seam)
3. Verifies prompts appear in the context store via 	angentAPI.context.get
4. Asserts prompt text is visible in the HumanContextPanel DOM

**Test strategy:**
- Uses existing context:recordPrompt IPC handler (no new test helpers needed)
- Avoids flaky agent orchestration by directly injecting prompts
- Validates both backend state (ContextStore) and frontend rendering (HumanContextPanel)
- Follows ContextStore debounce timing (DEBOUNCE_MS=150) with 800ms wait

**Test coverage:**
- ✅ Prompt capture via IPC
- ✅ Context retrieval returns prompt entries
- ✅ HumanContextPanel renders prompt text in DOM
- ❌ Copy/expand controls (out of scope for MVP — panel only shows truncated text)
- ❌ History button in status bar (not implemented — panel auto-shows when session active)

**Key learnings:**
1. **HumanContextPanel is already integrated** — Lives above the terminal viewport in App.tsx, displays automatically when a session is active. No modal/status-bar button required for MVP.
2. **Stable test seam exists** — 	angentAPI.context.recordPrompt allows direct prompt injection without launching real agents or capturing terminal output.
3. **ContextStore uses ring buffer** — Only last 10 prompts retained, deduplicates consecutive identical entries, filters agent launch commands.
4. **PromptItem click searches terminal** — Panel entries are clickable and trigger xterm.js findPrevious() to locate the prompt in scrollback.

**Would fail if:**
- HumanContextPanel component removed or renamed
- Context IPC handlers broken (context:recordPrompt, context:get)
- Prompt rendering logic removed from PromptItem component
- ContextStore ring buffer logic broken


### 2026-05-05 — Session Panel State Styling Regression Pattern

**Context:** Added targeted regression coverage for a selected Copilot session waiting at startup or in `needs_input` state after a bug where the selected row lost its waiting color during resume-session selection.

**Learning:** For visual state regressions, test the externally visible contract (selected row + status + computed waiting color) rather than internal React class names. A narrow `tangentAPI.test` state injector keeps E2E coverage deterministic without launching real Copilot.



---

### 2026-05-06: Status Bar Agent Label Removal Regression

**Session:** statusbar-label-cleanup (2026-05-06T14:11:51Z)

**Problem Solved:** After Livingston removed the agent type label display from status bar (e.g., "Copilot CLI", "Shell", "Claude Code"), needed targeted regression test to prevent reintroduction.

**Solution Delivered:** Updated `tests/regression/specific.spec.ts` with structural selector strategy:
- Used `button[title="Settings"]` as anchor to locate status bar via XPath ancestor traversal
- Selected only the center section div (`.flex.items-center.gap-2.min-w-0.flex-shrink`) to isolate status bar region
- Verified forbidden labels ('Copilot CLI', 'Claude Code', 'Shell', 'No Session') do not appear in that specific section
- Maintained sanity check that 'Ctrl+B panels' still renders

**Initial Test Failure:** First attempt used `.filter({ hasText: /Ctrl\+B panels/i })` which captured entire page content including session rows and terminal output, causing false positives when "Shell" appeared elsewhere in the UI.

**Key Technique:** When testing status bar elements, use structural selectors (class combinations, aria attributes, XPath ancestors) rather than text-based filters to avoid capturing unrelated UI regions with similar text.

**Outcome:** Full regression suite passes (6/6). Test specifically validates the status bar center section isolation, not global page text.

**Test Learning Appended to:** `.squad/agents/basher/history.md` (this file).

---

### 2025-01-18 — Compact Mode Horizontal Collapse

**Context**: Previous test verified `.xterm` visibility toggle but didn't catch the earlier bug where the terminal column consumed horizontal space as blank area while hidden.

**Changes**:
- Added `data-testid="terminal-column"` to `App.tsx` terminal column container
- Rewrote `tests/regression/specific.spec.ts` to assert:
  - Default view: terminal column width > 200px
  - Compact mode: terminal column width ≤ 10px (not just opacity 0)
  - Session click auto-expand: terminal column width > 200px again
- Test now uses `boundingBox()` to validate horizontal collapse, not just visibility

**Result**: Test passes. Would now fail if compact mode hides content without collapsing the column width.

