# Livingston — History

## Core Context

- **Project:** Electron terminal app with hybrid PTY+SDK architecture for AI agent orchestration
- **Role:** Frontend Dev
- **Joined:** 2026-04-13T01:57:51.242Z

## Learnings

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

