# Copilot Instructions — Tangent

## Project Overview

Tangent is a standalone Electron terminal app with a built-in Agents sidebar. Users launch AI agents (Copilot CLI, Claude Code) from the sidebar into terminal sessions. The product spec lives in `.resources/tangent-prd.md`.

## Commands

```bash
npm run dev          # electron-vite dev server with HMR
npm run build        # Production build
npm run lint         # ESLint (src/ only)
npm run test         # Vitest unit tests
npm run test:watch   # Vitest watch mode
npm run test:e2e     # Playwright e2e tests
```

Run a single unit test file:
```bash
npx vitest run src/shared/__tests__/transitions.test.ts
```

Run a single e2e test:
```bash
npx playwright test tests/example.spec.ts
```

## Architecture

### Process Model (Electron)

Three build targets configured in `electron.vite.config.ts`, each with its own tsconfig:

| Target | Entry | tsconfig |
|--------|-------|----------|
| main | `src/main/index.ts` | `tsconfig.main.json` |
| preload | `src/preload/index.ts` | `tsconfig.preload.json` |
| renderer | `src/renderer/main.tsx` | `tsconfig.renderer.json` |

Shared pure-function code lives in `src/shared/` and is consumed by all three targets.

### Import Aliases

- `@/*` → `src/renderer/`
- `@shared/*` → `src/shared/`

### Data Flow

Main process is the single source of truth. Renderer is a read-only consumer via IPC events.

```
PtyManager (node-pty)
  → SessionManager (create/select/close sessions)
    → StatusEngine (per-session status detection)
      ├─ SystemA (file watcher — highest priority)
      ├─ SystemB (terminal output pattern matching)
      └─ OscParser (escape sequences: title, progress, cwd)
    → SessionStore (in-memory, EventEmitter)
      → IPC handlers (forward to renderer via webContents.send)
        → React hooks (useSessions, useAgents, useKeyboard)
```

### IPC Patterns

Three communication types, each with a specific use:

- **Request-reply**: `ipcRenderer.invoke()` / `ipcMain.handle()` — for async operations that return data
- **Fire-and-forget**: `ipcRenderer.send()` / `ipcMain.on()` — for terminal writes, resizes
- **Push events**: `webContents.send()` / `ipcRenderer.on()` — for session updates, terminal data

The preload script exposes a namespaced `tangentAPI` via contextBridge: `session.*`, `terminal.*`, `agents.*`, `dialog.*`, `shell.*`, `app.*`.

Renderer hooks subscribe in `useEffect` and return cleanup unsubscribers:
```ts
const unsub = tangentAPI.session.onCreated(handler)
return () => unsub()
```

### Status Engine

Dual detection system with explicit priority: System A (file watcher) always overrides System B (output parsing).

- 8 internal statuses (`shell_ready`, `agent_launching`, `agent_ready`, `processing`, `tool_executing`, `needs_input`, `failed`, `exited`) mapped to 4 UI states via `mapStatusToUI()`
- All state transitions are whitelisted in `src/shared/transitions.ts` via `canTransition()`. Invalid transitions are logged and ignored — never thrown.
- SystemB strips ANSI escapes before regex matching against `DetectionRule[]` with priorities
- Timing constants in `STATUS_TIMING`: debounce/hysteresis rules prevent flicker

To add a new status: update `types.ts` → `transitions.ts` → `statusMapping.ts` → SystemB rules.

### Session Naming

Three fields (`folderPath`, `folderName`, `name`) update atomically. Agent detection must NOT change the session name. Manual renames set `isRenamed: true` and are sticky.

## Key Conventions

### Error Handling

- Shared code: pure functions return `boolean` or void; no exceptions thrown
- Main process: catch and log with `[Tangent]` prefix; don't propagate to renderer
- PTY: silent fails — `get()` returns `undefined` if PTY not found
- Renderer: optimistic updates

### Testing

- Unit tests use Vitest in `src/**/__tests__/**/*.test.ts`
- E2e tests use Playwright in `tests/`
- Prefer table-driven tests with `it.each()`
- Test pure shared logic; no mocking needed for shared functions

### UI

- Tailwind CSS v4 with shadcn/ui (new-york style, slate base color, CSS variables)
- Add shadcn components via: `npx shadcn@latest add <component>` (configured in `components.json`)
- GitHub Dark theme defined in `src/renderer/styles/globals.css`

### Agent Launching

- PowerShell commands escape single quotes via `replace(/'/g, "''")`
- `launchTarget` options: `currentTab`, `newTab`, or specific path
- Agent launch promotes a shell session to an agent type and renames it
