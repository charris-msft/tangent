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

<!-- Append learnings below -->
