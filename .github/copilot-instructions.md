# Copilot Instructions — Tangent

## Project Overview

Tangent is a standalone Electron terminal app with a built-in Agents sidebar. Users launch AI agents (Copilot CLI, Claude Code) from the sidebar into terminal sessions. The product spec lives in `.resources/tangent-prd.md`.

## Commands

```bash
npm run dev          # electron-vite dev server with HMR
npm run build        # Production build (renderer/main/preload only → out/)
npm run lint         # ESLint (src/ only)
npm run test         # Vitest unit tests
npm run test:watch   # Vitest watch mode
npm run test:e2e     # Playwright e2e tests
```

### Packaging the standalone `Tangent.exe` (CRITICAL)

The user's desktop shortcut points at `D:\git\tangent\release\dist\win-unpacked\Tangent.exe`. Whenever they ask for a "new exe" or "build", **both** steps must run — `npm run build` alone does NOT update the packaged exe:

```bash
npm run build
npx electron-builder --dir --config.npmRebuild=false
```

- `--dir` produces `dist/win-unpacked/Tangent.exe` without building an installer (fast).
- `--config.npmRebuild=false` is **required** on this machine — the default native rebuild fails on `ffi-napi` due to an MSBuild/preprocess_asm.cmd environment issue. The prebuilt native modules in `node_modules` already match the electron version.
- Do NOT use `npm run package` — it runs `electron-builder --dir` without the `npmRebuild=false` flag and will fail.
- The root-level `D:\git\tangent\release\tangent.exe` is legacy/stale and should be ignored. The canonical binary is `dist\win-unpacked\Tangent.exe`.

Run a single unit test file:
```bash
npx vitest run src/shared/__tests__/transitions.test.ts
```

Run a single e2e test:
```bash
npx playwright test tests/example.spec.ts
```

### E2E hook workflow (runs automatically at end of every turn)

`.github/hooks/e2e-on-stop.json` registers an `agentStop` Copilot hook that invokes `scripts/hooks/run-e2e-on-stop.ps1`. After every coding turn:

1. The hook detects whether `src/`, `tests/`, `scripts/`, `.github/`, `electron.vite.config.*`, or `package.json` changed. If not, it exits 0 silently.
2. If changes are present and `out/main/index.js` exists, it runs `npx playwright test tests/regression --reporter=line,json --timeout=45000` with a 6 min ceiling.
3. A summary (pass/fail counts, failed test titles) is written to `test-results/hook-report.json` and printed to the transcript.

**Test layout**:
- `tests/regression/general.spec.ts` — up to **5** load-bearing behaviors (app launches, sessions render, close modal works, status-bar popout buttons render, agent rows clickable). Stable across fixes.
- `tests/regression/specific.spec.ts` — targeted checks for the **most recent fix**. Rewrite this file each time a new bug is fixed.

**Responsibilities after each fix**:
1. Add / rewrite `tests/regression/specific.spec.ts` so it would fail if the bug you just fixed returned.
2. After the hook runs, read `test-results/hook-report.json`. If a failure escaped the general suite, **replace the least-valuable test in `general.spec.ts`** with one that would have caught it (keep the file at ≤ 5 tests).
3. If the bug the user just reported proves a general suite test is obsolete or too weak, rewrite it in place.

Manual escape hatch: set `TANGENT_SKIP_E2E_HOOK=1` to skip the hook (e.g. docs-only commits). The hook also skips when nothing in `src/` / `tests/` has changed.

Run the regression suite manually:
```bash
npm run test:regression
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

### Copilot SDK & CLI Source

Tangent integrates with the Copilot SDK and CLI via a hybrid PTY+SDK architecture. The source repos are available locally for modifications:

- **Copilot SDK**: `d:\git\tools\copilot-sdk\nodejs` — `CopilotClient`, `CopilotSession`, JSON-RPC protocol
- **Copilot CLI (agent runtime)**: `d:\git\tools\copilot-agent-runtime` — TUI app, `--ui-server` embedded server, OSC signals

After modifying SDK source: rebuild with `npm run build` in the SDK dir, then `npm install` in Tangent.

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
