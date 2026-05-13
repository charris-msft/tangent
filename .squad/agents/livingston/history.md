# Livingston — History

## Core Context

- **Project:** Electron terminal app with hybrid PTY+SDK architecture for AI agent orchestration
- **Role:** Frontend Dev
- **Joined:** 2026-04-13T01:57:51.242Z

## Learnings

### 2026-05-12: Terminal Column Clipping for Right Rail Layout

**Problem:** xterm could render wider than the terminal flex cell and leak stray wrapped fragments into the narrow area near the right AgentsSidebar rail/popup because the App terminal column and TerminalViewport containers allowed visible overflow.

**Solution:**
1. Made the App shell row and terminal column clip overflow while keeping compact mode's zero-width terminal behavior.
2. Added overflow clipping to `TerminalViewport`'s root and xterm host container.
3. Guarded xterm `fitAddon.fit()` behind positive container dimensions and routed resize/font-size fits through that helper.
4. Constrained xterm root and viewport horizontal overflow in `globals.css`.

**Files modified:**
- `src/renderer/App.tsx` — terminal flex cell now clips to its own layout box.
- `src/renderer/components/Terminal/TerminalViewport.tsx` — fits xterm only when its container has real available size.
- `src/renderer/styles/globals.css` — xterm root/viewport cannot paint horizontally outside the host.

**Outcome:** Terminal text is clipped and fitted to the available terminal column instead of painting underneath the right rail. Production build passed; lint could not run because `eslint` is not installed/resolvable in the current package environment.

### 2026-05-08: Keyboard Quick-Launch Compact Mode Restoration

**Problem:** `launchAgentByIndex` in App.tsx (invoked by Ctrl+Shift+1-9 shortcuts via useKeyboard) directly called `launchAgent(...)` without awaiting the result or checking compact mode state. If the app was in compact mode, keyboard shortcuts could launch an agent without restoring the BrowserWindow or selecting the new session. AgentsSidebar launch paths were already covered via `handleAgentLaunched`, but keyboard quick-launch bypassed that flow.

**Solution:**
1. Made `launchAgentByIndex` async
2. Awaited `launchAgent()` result and checked `result.launched && result.sessionId`
3. If successful, reused exact compact-mode restoration logic from `handleAgentLaunched`:
   - Call `window.tangentAPI.window.restoreFromCompact()`
   - Set `compactMode` state to `false`
   - Select the launched session via `selectSession(result.sessionId)`
4. Updated dependency array to include `compactMode` and `selectSession`

**Files modified:**
- `src/renderer/App.tsx` — updated `launchAgentByIndex` callback

**Outcome:** Keyboard quick-launch (Ctrl+Shift+1-9) now restores from compact mode and selects the launched session, matching the AgentsSidebar launch behavior. Build passed.

**Key insight:** `AgentLaunchResult` includes `sessionId` when `launched: true`, allowing keyboard shortcuts to follow the same expand-and-select UX as sidebar clicks. All compact-mode launch paths now restored.

## Core Context

- **Project:** Electron terminal app with hybrid PTY+SDK architecture for AI agent orchestration
- **Role:** Frontend Dev
- **Joined:** 2026-04-13T01:57:51.242Z

## Learnings

### 2026-05-07: Compact Mode API Integration

**Problem:** App.tsx maintained renderer-side `savedBounds` state and called `setMainBounds()` directly for compact mode, bypassing Rusty's new dedicated main-process APIs (`setCompactMode`, `restoreFromCompact`, `isInCompactMode`) that properly handle min-size constraints and restoration logic.

**Solution:**
1. Removed renderer `savedBounds` state entirely
2. Updated `toggleCompactMode` to:
   - Calculate compact width: `sessionsPanelWidth + 44 + 20`
   - Call `window.tangentAPI.window.setCompactMode(compactWidth)` when entering
   - Call `window.tangentAPI.window.restoreFromCompact()` when exiting
   - Only update React state after successful main-process response
3. Updated `handleSelectSession` and `handleAgentLaunched` to call `restoreFromCompact()` instead of manually restoring bounds
4. All callbacks now `async` to properly await API responses

**Files modified:**
- `src/renderer/App.tsx` — removed savedBounds state, switched to dedicated compact APIs

**Outcome:** Compact mode now uses Rusty's main-process logic that tracks original bounds and min-size constraints. No race conditions between renderer state and window geometry.

**Key insight:** The preload script already exposed `setCompactMode(compactWidth)`, `restoreFromCompact()`, and `isInCompactMode()` at lines 267-272. We just needed to refactor App.tsx to use them instead of the lower-level `setMainBounds()`.

### 2026-05-06: Compact Mode Window Resize

**Problem:** Compact mode successfully hid the terminal column via CSS but left the entire BrowserWindow at full width, creating large blank space. The user's screenshot showed terminal content hidden but window width unchanged — defeating the purpose of "compact" mode.

**Solution:**
1. Added `savedBounds` state to App.tsx to store original window dimensions before entering compact mode
2. Updated `toggleCompactMode` to:
   - Fetch current window bounds via `window.tangentAPI.window.getMainBounds()`
   - Save bounds to state
   - Calculate compact width: `sessionsPanelWidth + 44px (agents tab bar) + 20px (padding)`
   - Resize window via `window.tangentAPI.window.setMainBounds()` with new width but same x, y, height
3. Updated `handleSelectSession` and `handleAgentLaunched` to restore saved bounds before expanding
4. Reused existing preload/main window APIs (`setMainBounds`, `getMainBounds`) — no backend changes needed

**Files modified:**
- `src/renderer/App.tsx` — added savedBounds state, updated toggleCompactMode/handleSelectSession/handleAgentLaunched
- `.squad/agents/livingston/history.md` — documented implementation

**Outcome:** Compact mode now resizes the actual BrowserWindow to sessions+agents width. Clicking a session or launching an agent restores original window dimensions. Build pending.

**Key insight:** Tangent's WindowManager already supported `setMainBounds()` for the Explode feature (tiling popouts). We reused that same API to implement compact mode window resize without any main process changes.

### 2024-12-XX: Agent Launch Result Type Safety

**Problem:** Type-safety mismatch in agent launch result. `useAgents.ts` returned `{ launched: boolean; error?: string } | undefined`, but `AgentsSidebar.tsx` accessed `result.sessionId` to select the launched session and expand from compact mode. The main process handler returned `{ launched, agentId, agentName }` but not `sessionId`, even though `AgentLauncher.launch()` creates new sessions for `newTab` and `path` launch targets.

**Solution:**
1. Added `AgentLaunchResult` interface to `src/shared/types.ts` with all return fields: `launched`, `sessionId?`, `agentId?`, `agentName?`, `error?`
2. Updated `AgentLauncher.launch()` to return `string` (the target sessionId) instead of `void`
3. Updated `_launchLocal()` to return `targetSessionId` after all session creation logic
4. Updated `_launchRemote()` to return `sessionId` (remote sessions created async via event)
5. Updated IPC handler `agents:launch` to capture and return the `sessionId` from `agentLauncher.launch()`
6. Updated IPC handler `agents:launchByName` (test helper) to also return `sessionId`
7. Updated `useAgents.ts` to import and use `AgentLaunchResult` type

**Files modified:**
- `src/shared/types.ts` — added `AgentLaunchResult` interface
- `src/main/agents/AgentLauncher.ts` — changed return type to `string`, propagated sessionId
- `src/main/ipc/handlers.ts` — updated both launch handlers to return sessionId
- `src/renderer/hooks/useAgents.ts` — replaced inline type with `AgentLaunchResult`

**Outcome:** Build passes, compact mode auto-expand now type-safe with correct sessionId.

### 2026-05-05: Session Waiting Color Fix — Renderer Status Derivation Outcome

**Session:** session-waiting-color-fix (2026-05-05T23:22:13Z)

**Problem Solved:** Agent rows showing `Waiting...` status lost red attention visuals (dot, bar, glow) when selected or when backend status was `shell_ready`/`agent_ready`. The visible waiting state did not match the UI treatment.

**Solution Delivered:** Introduced renderer-side status composition in `SessionsPanel/sessionRowState.ts`:
- Derives visual status from `lastActivity` (empty or process-only paths) + `agentType`
- Non-shell rows with empty activity render as `needs_input` visual regardless of backend status
- Selected rows preserve derived color even during backend status transitions

**Outcome:** SessionsPanel unit tests pass. Regression coverage validated. Integrated by Coordinator.

### 2026-04-13: DevBoxPicker Component (P1.4)
**Created:** `src/renderer/components/DevBoxPicker.tsx` — modal dialog for selecting Dev Boxes from Azure.

**Key patterns learned:**
- **Existing dialog pattern:** Tangent uses custom modal overlays (not shadcn/ui Dialog). Pattern is fixed backdrop + centered card with GitHub Dark theme vars.
- **DevBox API:** Already exposed in preload as `window.tangentAPI.devbox.list()` returning `DevBoxResource[]` from `@shared/devbox-types`.
- **GitHub Dark theme:** Use CSS vars (`--bg-secondary`, `--text-primary`, etc.) from `globals.css`. Status badges use `--running`, `--error`, `--idle`, `--text-muted`.
- **State management:** Loading → data/error states. Empty state with external link pattern (Azure Portal).
- **Selection UX:** Clickable cards with highlighted border for selected state. Disabled Select button when nothing selected.

**Component features:**
- Fetches Dev Boxes on open via `tangentAPI.devbox.list()`
- Status badges with emoji + color coding (Running/Starting/Stopped/Failed/etc.)
- Displays name, project, location, OS type
- Loading state with pulse animation
- Error state with retry button
- Empty state with Azure Portal link
- Selected state with accent border
- Returns `{ name, projectName }` on selection

**Why manual dialog:** Attempted `npx shadcn@latest add dialog` but process hung on npm prompt. Existing dialogs (PermissionDialog, UserInputDialog) use simple custom overlays that match GitHub Dark theme perfectly. Followed that pattern instead.

### 2026-04-13: DevBoxStatus Component (P1.12)
**Created:** `src/renderer/components/DevBoxStatus.tsx` — compact status widget for Dev Box connection state.

**Key patterns learned:**
- **StatusBar integration:** StatusBar accepts optional `devBoxInfo?: DevBoxInfo` prop, shows DevBoxStatus widget when present (leftmost in right section).
- **Connection state indicators:** 7 states mapped to emoji + color + animated flag:
  - 🔵 Starting/Provisioning/Tunneling (blue, animated)
  - 🟢 Ready (green, steady)
  - 🟡 Syncing (yellow, animated)
  - ⚫ Disconnected (gray)
  - 🔴 Failed (red)
- **Hover tooltip:** Shows Dev Box name, status, last sync time, connection info (IP, SSH port, ACP port). Uses absolute positioning, bottom-6 offset, z-50.
- **Reconnect button:** Visible when disconnected/failed. Currently logs to console with TODO comment for RemoteSessionManager integration.
- **Event listeners:** Subscribes to `tangentAPI.devbox.onHealthUpdated()` for real-time connection info updates.

**Component features:**
- Compact widget (icon + name + state badge)
- Animated pulse for transitional states (starting/provisioning/tunneling/syncing)
- Reconnect button (conditionally visible)
- Rich tooltip with connection details (IP, ports, last sync)
- Listens for health updates via IPC events
- Respects GitHub Dark theme vars

**Integration points:**
- Modified `StatusBar.tsx`: added `devBoxInfo` prop, imported DevBoxStatus, added reconnect handler stub
- Ready for RemoteSessionManager wiring once implemented
- Positioned before metrics section in status bar right area

### 2026-04-13: Provisioning Consent Dialog + Sync Settings Panel (P2.6 + P3.9)
**Created:** `src/renderer/components/ProvisioningConsentDialog.tsx` and `src/renderer/components/SyncSettingsPanel.tsx`

**Key patterns learned:**
- **Modal dialog pattern:** Fixed backdrop with centered card, using GitHub Dark theme CSS variables
- **List presentation:** Structured change list with emoji icons (✅) and two-line details (title + subtitle)
- **Dev Box name emphasis:** Prominently display Dev Box name with accent color highlighting
- **Action buttons:** Standard Cancel (secondary) + Approve/Save (primary green) button pattern
- **Settings panel layout:** Input field with Add button, scrollable pattern list, default patterns marked as non-removable
- **Pattern management:** Allow adding/removing custom patterns while protecting DEFAULT_PATTERNS (node_modules, .git)
- **Keyboard shortcuts:** Enter key triggers Add action in input field for better UX

**ProvisioningConsentDialog features:**
- Modal consent dialog for first-time Dev Box provisioning
- Lists 4 changes: OpenSSH server, CopilotACP task, CLI config, sync hooks
- Dev Box name prominently displayed with accent color
- Approve/Cancel actions via callbacks
- Follows GitHub Dark theme and existing dialog patterns

**SyncSettingsPanel features:**
- Workspace sync exclusion configuration panel
- Displays current patterns with default (node_modules, .git) marked as non-removable
- Add new patterns via input field (glob format)
- Remove custom patterns with ✕ button
- Input validation (no duplicates, trim whitespace)
- Enter key support for quick pattern addition
- Save/Cancel buttons for persisting changes
- Expects parent to handle IPC save to ~/.tangent-2/sync-config.json

**Design decisions:**
- Both components follow existing dialog/panel patterns from DevBoxPicker, PermissionDialog
- Use inline styles with CSS variables for consistent GitHub Dark theming
- Stateful pattern management in SyncSettingsPanel (useState for local edits before save)
- Clean separation: components handle UI, parent handles IPC/persistence

### 2026-04-13: Remote Execution UI - Agent Profile Editor + Session Indicators (P4.3 + P4.14)
**Modified:** `src/renderer/components/AgentsSidebar/AgentForm.tsx`, `AgentItem.tsx`, `SessionsPanel/SessionItem.tsx`

**Key patterns learned:**
- **Agent profile remote config:** Extended AgentForm with optional `remote` object containing `enabled`, `devBoxProject`, `devBoxName`, `repoPath`, `sshUser` fields
- **DevBoxPicker integration:** Reused existing DevBoxPicker dialog component, triggered via button in remote section
- **Checkbox-gated sections:** Remote execution UI appears only when "Enable remote execution" checkbox is checked
- **Default values:** SSH user defaults to current OS user via `tangentAPI.app.getUsername()` when remote is first enabled
- **Badge patterns:** "Dev Box" badge on agent list items when `agent.remote?.enabled === true`, styled with accent background
- **Session kind detection:** Remote sessions identified by `session.kind === 'remote-agent'`
- **Remote state mapping:** 7 RemoteSessionState values mapped to emoji + color + animation + label:
  - 🔵 starting-devbox/tunneling/verifying-acp (blue, animated)
  - 🟡 syncing-out/syncing-back (yellow, animated)
  - 🟢 running (green, steady)
- **Tooltip on hover:** Remote badge shows connection details on 500ms hover (Dev Box name, project, state, connection ID, last sync)
- **Subtitle override:** Remote sessions show "Dev Box: {name} ({project})" instead of lastActivity

**Component features:**
- **AgentForm remote section:**
  - Checkbox to enable remote execution
  - Dev Box picker button (opens DevBoxPicker)
  - Selected Dev Box name display with project in muted text
  - Repo path input (workspace path on Dev Box)
  - SSH user input with auto-default
  - Remote config only saved when checkbox enabled
- **AgentItem badge:**
  - Blue accent "Dev Box" badge when remote.enabled
  - Tooltip shows Dev Box name on hover
- **SessionItem remote indicators:**
  - "Remote" badge (accent blue) on remote sessions
  - Remote state indicator with emoji, color, label, animation
  - Dev Box name + project in subtitle
  - Rich tooltip with connection details (name, project, state, connection ID, last sync time)

**Design decisions:**
- Follow existing GitHub Dark theme patterns with CSS variables
- Reuse DevBoxPicker instead of creating new dialog
- Conditionally render remote section based on checkbox (not separate form step)
- Auto-default SSH user to avoid empty input confusion
- Position remote badge before agent type badge for visual hierarchy
- Use animated pulse for transitional states (starting, syncing, tunneling)
- Tooltip positioned below badge with 500ms delay to avoid flicker
- Session subtitle shows Dev Box info for remote sessions (higher priority than lastActivity)

### 2026-04-13: Sync Status UI - SyncLogModal + DevBoxStatus Sync Indicators (P3.7)
**Created:** `src/renderer/components/SyncLogModal.tsx` — modal dialog showing sync history for Dev Boxes.
**Modified:** `src/renderer/components/DevBoxStatus.tsx`, `src/renderer/components/StatusBar/StatusBar.tsx` — extended with sync status indicators.

**Key patterns learned:**
- **Sync direction indicators:** Three-state direction icon (⬆ outbound, ⬇ inbound, ⏸ idle) with color coding (green/blue/gray)
- **Inline sync widget:** Compact sync status display (direction icon + file count) integrated into DevBoxStatus badge, separated by vertical divider
- **Animation during sync:** Pulse animation on direction icon when connectionState === 'syncing'
- **Modal click handler:** DevBoxStatus badge is clickable to open SyncLogModal, with hover opacity change for affordance
- **Event delegation:** Reconnect button uses stopPropagation to prevent triggering modal on button click
- **Tooltip enhancement:** Extended tooltip with sync info section (direction, last sync time, file count) separated by horizontal divider
- **Modal data:** SyncLogModal expects future IPC handler `tangentAPI.devbox.getSyncHistory()` returning `SyncLogEntry[]` (currently uses mock data)
- **Entry formatting:** Helper functions for bytes (KB/MB/GB), duration (ms/s/m), timestamp (relative time with date fallback)
- **Success/error badges:** Color-coded status badges (✓ Success / ✗ Failed) with matching background tints
- **Direction cards:** Each log entry shows direction indicator in colored card (green for outbound, blue for inbound)

**Component features:**
- **SyncLogModal:**
  - Shows last 10 sync operations (configurable limit)
  - Each entry displays: direction indicator, timestamp, file count, byte count, duration
  - Success/failure status badge per entry
  - Error message display for failed syncs
  - Scrollable list with hover states
  - Empty state for no sync history
  - Loading state while fetching
  - Standard modal overlay with GitHub Dark theme
- **DevBoxStatus sync indicators:**
  - Direction icon with color coding inline in badge
  - File count display (only when > 0)
  - Animated pulse during active sync
  - Tooltip shows detailed sync stats
  - Clickable to open SyncLogModal
  - Sync info separated from connection info in tooltip

**Integration points:**
- Extended `DevBoxInfo` interface in StatusBar with `lastSyncDirection` and `lastSyncFileCount` props
- StatusBar passes new props to DevBoxStatus component
- Ready for backend wiring when `tangentAPI.devbox.getSyncHistory()` IPC handler is implemented
- Sync data structure based on `SyncHistoryEntry` from `SyncListener.ts` (timestamp, fileCount, byteCount, duration, success, error)

**Design decisions:**
- Inline sync indicator within DevBoxStatus badge (not separate widget) to conserve status bar space
- Direction icon positioned after vertical divider for visual separation from connection state
- Click on entire badge opens modal (not just sync section) for larger click target
- File count hidden when 0 or undefined to avoid clutter
- Tooltip hint "Click to view sync history" at bottom to indicate interactivity
- Modal uses same dialog pattern as ProvisioningConsentDialog and SyncSettingsPanel (fixed backdrop, centered card)
- Success entries use green tint, failed entries use red tint (consistent with GitHub Dark theme)
- Direction cards use subtle background tints (not solid fills) for better readability

<!-- Append learnings below -->

### 2026-04-13: Explode Window Tiling - Bounds Clamping Fix
**Fixed:** Window overlap bug in multi-window "Explode" feature caused by floating-point rounding errors.

**Problem:** User reported 5 windows overlapping after explode. Investigation showed the tiling algorithm (`computeTileLayout` in `src/shared/tiling.ts`) was mathematically correct for typical cases, but had a subtle rounding edge case: when computing window positions and sizes via division with padding, floating-point arithmetic could produce windows whose right/bottom edges exceeded display bounds by 1-2 pixels due to `Math.floor()` rounding.

**Root cause examples:**
- 2560×1440 display with 5 windows: third window ended at x=2551 (display width = 2560) ✓ barely OK
- But with certain padding/outerPadding combinations or display scaling, accumulated rounding errors could push windows slightly out of bounds
- Electron's BrowserWindow has `minWidth: 400, minHeight: 300`, which would cause automatic enlargement if computed sizes fell below minimums, creating guaranteed overlaps

**Fix:** Added explicit bounds clamping in the final step of window positioning:
```typescript
const clampedWidth = Math.min(floorWidth, display.x + display.width - floorX);
const clampedHeight = Math.min(floorHeight, display.y + display.height - floorY);
```
This ensures windows NEVER exceed display bounds, even with floating-point rounding errors or edge cases.

**Testing:**
- Extended existing test suite with n=5, n=6, n=8 coverage (previously missing n=5)
- Added explicit pairwise overlap detection tests for n=2..8
- All 24 tiling tests pass
- Build succeeds

**Key learnings:**
- **Electron display bounds vs workArea:** Always use `screen.workArea` (accounts for taskbar) not `screen.bounds` when tiling windows. Confirmed windowHandlers.ts line 34 uses `d.workArea` correctly.
- **DPI scaling gotcha:** Electron reports workArea in logical pixels, already accounting for OS display scaling. No double-scaling issues found in our code.
- **Minimum window size constraint:** BrowserWindow `minWidth/minHeight` will silently enlarge windows that violate minimums, causing overlaps. With 16+ windows on 1920×1080, computed sizes fall below 300px height → automatic enlargement → guaranteed overlaps. Solution: clamp to display bounds, accept that many windows = small windows.
- **Rounding accumulation:** Even with perfect math, `Math.floor()` on fractional cellWidth/cellHeight can accumulate errors across columns/rows. Final clamp prevents windows from spilling 1-2 pixels beyond display edge.

**Grid algorithm:** For N windows on a display:
- `cols = Math.ceil(Math.sqrt(N))`
- `rows = Math.ceil(N / cols)`
- Column-major layout: `row = floor(i / cols)`, `col = i % cols`
- Example: 5 windows → 3 cols × 2 rows (3 in top row, 2 in bottom row)

**UPDATE (2026-04-18):** This fix addressed floating-point rounding in the algorithm itself, but the real root cause of persistent user complaints was elsewhere. Danny discovered that `WindowManager.popOut()` was ignoring the bounds parameter for already-existing windows. See 2026-04-18 Explode Multi-Window Tiling entry for the complete fix. **Key insight:** The algorithm fix was correct but insufficient — we needed BOTH algorithm correctness (your fix) AND application of results to existing windows (Danny's fix).

### 2026-04-18: Display Selection Persistence for Explode
**Added:** localStorage persistence to remember user's last selected displays in DisplayPicker modal.

**Implementation:**
- **Storage key:** `tangent.explode.lastDisplaySelection` stores array of display IDs (e.g., `[1, 2, 3]`)
- **On mount:** Reads localStorage, filters to only valid IDs (displays still connected), pre-checks those displays. Falls back to primary display if no valid IDs found.
- **On confirm:** Writes selected IDs to localStorage before calling onConfirm callback.
- **On cancel:** Does NOT update localStorage (preserves previous selection).
- **Error handling:** All localStorage access wrapped in try/catch to handle quota errors, invalid JSON, or localStorage unavailable.

**Files modified:**
- `src/renderer/components/DisplayPicker.tsx` — Added STORAGE_KEY constant, restore logic in useEffect, persistence in handleConfirm
- `vitest.config.ts` — Added `@` alias for renderer, enabled `jsdom` environment for localStorage tests
- `package.json` — Added jsdom dev dependency

**Testing:**
- Created `src/renderer/components/__tests__/DisplayPicker.test.ts` with 10 unit tests covering:
  - Save/restore selection
  - Filter out disconnected displays
  - Fallback to primary when no valid IDs
  - Invalid JSON handling
  - localStorage errors
  - Cancel does not update storage
  - Single and multiple display selections
- All 10 tests pass
- Build succeeds

**Pattern reused:**
- Followed existing localStorage pattern from `useHumanContext.ts` (simple direct localStorage with try/catch guards, no schema versioning needed for this simple preference).

### 2026-04-18: Explode Overlap Resolution — Historical Note

Two independent Danny runs (sonnet + opus) diagnosed the root cause of Explode overlaps that persisted after Livingston's bounds-clamping fix (commit 26c116e).

**Key finding:** Livingston's fix was correct for its scope (algorithm precision), but two additional bugs existed:
1. `useExplode.ts` filter excluded already-popped windows from tile calculation (Danny-v3)
2. Main Tangent window was never tiled alongside popouts (Danny-opus)

**Impact on Livingston's work:** Bounds-clamping fix (26c116e) remains valid and ships as part of the solution. It addressed real floating-point rounding edge cases. The bounds path (`WindowManager.popOut()` + new `setMainBounds()` from Danny-opus) is unchanged — existing code path intact.

**Lesson:** When multiple async agents diagnose a persistent bug, each may find a correct but incomplete root cause at their level of investigation. Shipping partial fixes based on incomplete test coverage can hide deeper bugs in higher-level logic or excluded components.

### 2026-05-05: Sessions Panel Waiting Color

**Fixed:** Copilot session rows that display `Waiting...` from empty/process-path activity now derive a renderer-only `needs_input` visual state.

**Learning:** Session row color must follow the user-visible row state, not just the backend status. Startup agents can still report `shell_ready` or `agent_ready` while the Copilot TUI is waiting on a resume/user-selection prompt, especially when `lastActivity` is only `cmd.exe`, `pwsh.exe`, or `powershell.exe`.

### 2026-05-06: Compact Mode UI Feature

**Implemented:** User-toggleable compact mode that hides terminal viewport and human context panel to minimize screen space usage.

**Key patterns learned:**
- **Auto-expand on interaction:** Wrapped session selection and agent launch callbacks to automatically exit compact mode when user initiates work
- **CSS transition for smooth collapse:** Used `max-height: 0px` with `overflow: hidden` + `transition: 'max-height 0.2s ease-in-out'` instead of `display: none` to enable smooth animation
- **State indicator in StatusBar:** Toggle button icon changes based on state (⬇ when expanded, ⬆ when compact) with color coding (`--text-primary` when active, `--text-muted` when inactive)
- **Preserve default behavior:** `compactMode` defaults to `false`, ensuring existing users see no change in initial layout

**Component features:**
- **App.tsx:**
  - Added `compactMode` state (default: false)
  - `handleSelectSession`: auto-expands from compact when user clicks a session
  - `handleLaunchAgent`: auto-expands from compact when agent launches
  - Conditional rendering: terminal and context panel only rendered when `!compactMode`
  - Smooth collapse animation via CSS transition on terminal container
- **StatusBar.tsx:**
  - New toggle button positioned before settings (⬇/⬆ icon)
  - Props: `compactMode`, `onToggleCompactMode`
  - Tooltip changes based on state for clarity
- **AgentsSidebar.tsx:**
  - New optional prop: `onLaunchAgent(agentId, sessionId)`
  - Calls callback after successful agent launch (when `result.launched === true`)
  - Enables parent to detect agent launches and trigger auto-expand

**Design decisions:**
- Default is expanded view (no change to existing behavior)
- Auto-expand ensures user never gets stuck in compact mode when trying to work
- Smooth 0.2s transition prevents jarring UI jumps
- Compact button uses active state color (`--text-primary`) to indicate current mode
- Positioned compact toggle near other layout controls (explode, collapse, history) for discoverability

**Testing:** TypeScript build passed. Manual testing recommended: toggle compact mode, verify smooth collapse/expand, test auto-expand on session click and agent launch.
