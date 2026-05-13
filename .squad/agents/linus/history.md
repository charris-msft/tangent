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

### 2026-04-19: Terminal Mirroring Backend Note (Context for Integration)

From Livingston's refinement #3 (dual-window terminal rendering):

**Architecture pattern to know:**
- Both main and popout windows receive the same PTY stream simultaneously (mirrored)
- `TerminalManager` broadcasts writes to both BrowserWindow instances
- `SessionManager` tracks dual renderers per session
- **Popout owns PTY sizing when open** (prevents resize thrash)
- Main reclaims sizing if popout closes

**For remote agent integration:**
This mirroring pattern applies to remote sessions too. When a remote ACP session is in a popout:
1. ACP output (from remote Dev Box) streams through `TerminalManager` (same path as local PTY writes)
2. Both windows automatically receive identical output (no duplication needed in agent logic)
3. Popout's terminal resize → PTY size update (already coordinated at IPC level)

**No backend changes needed** — existing IPC patterns for session terminal updates work identically for both local and remote agents. Mirroring is transparent at the manager level.



### 2026-05-10: Legacy Forge Chat / Foundry agent integration research

Researched `coreai-microsoft/forge` `products/foundry-ui` (legacy FC) end-to-end. Full handoff doc: `.squad/decisions/inbox/linus-legacy-fc-foundry-agents.md`.

**Learnings:**

- **Legacy FC is a Starlette Python server**, not just a SPA. The hot path is **one** SSE endpoint: `POST /api/agui/run`. Everything else (`/api/agents`, `/api/token`, `/api/me`, `/api/chats`) is supporting cast.
- **Foundry agent invocation = OpenAI Responses API + `extra_body`.** The trick: `AIProjectClient.get_openai_client()` returns an OpenAI-compatible client; pass `extra_body={"agent_reference":{"type":"agent_reference","name":<agent>}, "structured_inputs":{...}}` to `responses.create(stream=True)`. No custom REST surface, no thread/run primitives — Foundry hides those behind the OpenAI shape.
- **AG-UI event translation is the contract**, not Foundry's raw events. Mapping: `response.output_text.{delta,done}` → `TEXT_MESSAGE_*`; `response.function_call_arguments.*` → `TOOL_CALL_*`; `output_item.done(function_call_output)` → `TOOL_CALL_RESULT`; `output_item.added(oauth_consent_request)` → `CONSENT_REQUIRED`. Port this verbatim — every event type string is a contract with the legacy SPA and will save us debugging.
- **The "App Insights agent" is just `insights-agent`** — a Foundry prompt agent (`agents/insights-agent/agent.yaml`, `displayName: Insights Agent`, model gpt-5.4) wrapping a remote MCP server (`insights-mcp[-int].purplesky-21d895f1.francecentral.azurecontainerapps.io/mcp`) with 12 KQL/metric tools, all auto-approved (`require_approval.never`). FC discovers it via `client.agents.list()` and invokes it identically to any other agent — **no per-agent code path**. The `appInsightsConnectionString` in `/api/config` is unrelated frontend telemetry; do not conflate.
- **Two-path auth in cloud:** Easy Auth ACA sidecar provides `X-MS-TOKEN-AAD-ACCESS-TOKEN` (aud=ai.azure.com) + `X-MS-TOKEN-AAD-ID-TOKEN` (aud=app client id). For the Foundry audience, return the access token directly. For other audiences (Graph, etc.), MSAL OBO with the ID token, where `client_credential` is a JWT from MI's `api://AzureADTokenExchange/.default` (FIC). Fallback = MI/CLI app identity.
- **Local dev path is much simpler:** `CONFIG_NAME=local` + `az login --tenant 72f988bf-86f1-41af-91ab-2d7cd011db47` + `AzureCliCredential` everywhere. No Easy Auth, no OBO. This is what our PoC should target first.
- **Cross-tenant projects** use `ClientAssertionCredential(tenant_id, client_id=federatedClientId, func=lambda: MI.get_token('api://AzureADTokenExchange'))` — only relevant if we add AME projects later. Anvil INT is in MSFT tenant; not needed for PoC.
- **Discovery is project-scoped.** `FOUNDRY_PROJECT_ENDPOINT=https://<acct>.services.ai.azure.com/api/projects/<name>`. Failures (`AADSTS50020`, "Workspace not found") must be caught per-project and skipped, never propagated.
- **Agent display metadata is hard-coded** in legacy FC's `_DEFAULT_AGENT_DISPLAY`. Anti-pattern — drive it from the agent definition instead.
- **Per-user side-channel** for things like GitHub tokens uses `structured_inputs` on the agent definition (e.g. `auth_token`). FC injects `{"auth_token": f"Bearer {gh_token}"}` only if the agent declares it. Insights Agent does NOT declare it — its MCP is app-identity-only.
- **TS SDK parity is the real risk** for the PoC: must verify `@azure/ai-projects` (or the JS `openai` package via `client.inference.azureOpenAI`) accepts `extra_body` / `agent_reference`. If not, raw `fetch` to `/openai/v1/responses` with a `credential.getToken('https://ai.azure.com/.default')` bearer is the fallback.

