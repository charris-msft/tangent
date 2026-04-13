# Linus — History

## Core Context

- **Project:** Electron terminal app with hybrid PTY+SDK architecture for AI agent orchestration
- **Role:** Integration Dev
- **Joined:** 2026-04-13T01:57:51.241Z

## Learnings

<!-- Append learnings below -->

### 2026-04-13 — npm Dependencies for Remote Execution

Installed all 4 npm packages for the remote agent offloading feature:
- **@microsoft/devbox-mcp** (v0.0.3-alpha.4) — Dev Box MCP for discovery and lifecycle management (P1.1)
- **ssh2** (v1.17.0) — SSH tunnel creation and management (P1.7)
- **@agentclientprotocol/sdk** (v0.18.2) — ACP SDK for Copilot CLI's ACP server (P2.1)
- **node-rsync** (v1.0.3) — Node.js rsync wrapper for workspace sync (P3.1)

All packages existed on npm and installed successfully (added 323 packages total). No missing packages to document.

### 2026-04-13 — IPC Handlers for DevBox + ACP Permission Bridge (P1.5 + P2.8)

Wired up IPC integration for Dev Box operations and ACP permission dialogs:

**DevBox IPC handlers (P1.5):**
- `devbox:list` → DevBoxManager.listDevBoxes()
- `devbox:start` → DevBoxManager.startDevBox(projectName, devBoxName)
- `devbox:stop` → DevBoxManager.stopDevBox(projectName, devBoxName)
- `devbox:getConnectionInfo` → DevBoxManager.getConnectionInfo(projectName, devBoxName)
- `devbox:checkHealth` → DevBoxManager.checkHealth(projectName, devBoxName)
- `devbox:autoStart` → DevBoxManager.autoStart(projectName, devBoxName, progressCallback)
- Forward DevBoxManager events (`state-changed`, `health-updated`, `error`) to renderer via webContents.send

**ACP Permission Bridge (P2.8):**
- `acp:permission-response` (renderer → main) → AcpClient.respondToPermission()
- Forward AcpClient events (`permission-request`, `connected`, `disconnected`, `session-created`, `message`, `error`) to renderer
- Established full bidirectional permission flow: AcpClient request → IPC push to renderer → UI dialog → renderer response → IPC send → AcpClient resolve

**Preload API namespaces added:**
- `tangentAPI.devbox.*` — 6 invoke methods + 4 event listeners
- `tangentAPI.acp.*` — 1 send method (respondPermission) + 6 event listeners

**Pattern adherence:**
- Followed existing handler registration patterns (ipcMain.handle for request-reply, ipcMain.on for fire-and-forget)
- Used webContents.send for push events with unsubscribe pattern in preload
- Optional deps check (`if (!devBoxManager)`) with graceful fallbacks
- Auto-start progress callback uses optional `reportProgress` flag to avoid spamming renderer

**Integration readiness:**
- DevBox UI can now invoke lifecycle operations and subscribe to state changes
- ACP permission dialogs can be triggered from main and approved/denied from renderer
- Both managers are optional (undefined checks) for environments where they're not initialized yet

### 2026-04-13 — Sync Hooks Deployment + ACP Output Streaming (P3.5 + P4.7)

Implemented two critical features for remote agent orchestration:

**P3.5 — Sync hooks deployment during provisioning:**
- Added `deploySyncHooks(sshClient, workspacePath)` method to DevBoxProvisioner
- Deploys 3 files from `assets/devbox-templates/` to Dev Box workspace `.github/hooks/`:
  - `sync.json` — Hook configuration (agentStop, sessionEnd triggers)
  - `sync-workspace-to-primary.ps1` — Incremental rsync after each agent turn
  - `full-workspace-sync.ps1` — Full checksum-verified sync on session end
- Creates `.github/hooks/` directory on Dev Box via PowerShell remote execution
- Reads local template files, escapes content for PowerShell Set-Content, copies via SSH exec
- Verifies all 3 files deployed successfully via Test-Path validation
- Wired into provisioning flow as Step 6 (between session sync and state saving)
- Provision signature updated to accept optional `workspacePath` parameter
- Gracefully skips if no workspace path provided (logs message, continues provisioning)

**P4.7 — ACP message streaming to xterm.js:**
- Added `formatAcpResponseForTerminal()` helper in handlers.ts to convert ACP JSON to human-readable text
- Formats agent text, tool executions (with ✓/✗/⋯ status icons), status updates (🤔/🔧/⌨️/✓/✗), and errors
- Extended ACP message handler to dual-emit: `acp:message` (raw JSON) + `acp:output` (formatted text)
- Added `tangentAPI.acp.onOutput(callback)` to preload API for renderer consumption
- `acp:output` payload: `{ sessionId: string, text: string }` ready for xterm.js write()

**Integration patterns:**
- File deployment via SSH exec of PowerShell Set-Content (escapes quotes and newlines)
- Dev Box is Windows, so no chmod needed (PowerShell scripts run by default)
- ACP response formatter supports partial responses (only formats fields present in response)
- Tool status icons: ✓ success, ✗ error, ⋯ running (Unicode for cross-platform rendering)
- Status emojis: 🤔 processing, 🔧 tool_executing, ⌨️ needs_input, ✓ completed, ✗ error

**Next steps for renderer:**
- Terminal component should subscribe to `tangentAPI.acp.onOutput()` for its sessionId
- Write formatted text directly to xterm.js instance (already human-readable, no parsing needed)
- UI can still consume raw `acp:message` for structured rendering (e.g., tool execution panels)

