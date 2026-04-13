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

<!-- Append learnings below -->
