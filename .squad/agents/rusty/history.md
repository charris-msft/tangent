# Rusty — History

## Core Context

- **Project:** Electron terminal app with hybrid PTY+SDK architecture for AI agent orchestration
- **Role:** Backend Dev
- **Joined:** 2026-04-13T01:57:51.226Z

## Learnings

### 2026-04-13: SshTunnelManager Implementation (P1.8 + P1.9)

Created `src/main/devbox/SshTunnelManager.ts` for managing SSH tunnel lifecycle to Dev Box connections:

**Core Features:**
- `createTunnel()` — establishes SSH port-forward using ssh2's `forwardOut()` (equivalent to `ssh -L`)
- `closeTunnel()` — graceful shutdown with proper cleanup
- `getTunnelStatus()` — returns current state (status, error, reconnect attempts, last health check)
- EventEmitter pattern for state changes: `tunnel:connected`, `tunnel:disconnected`, `tunnel:reconnecting`, `tunnel:error`

**Health Monitoring:**
- TCP probe every 30s via `net.createConnection()` to verify tunnel responsiveness
- Auto-reconnect with exponential backoff: 1s base delay, doubles each attempt (1s → 2s → 4s → 8s → 16s), capped at 30s max
- Max 5 reconnect attempts before marking tunnel as failed
- Health check timeout: 5s

**Design Patterns:**
- Follows PtyManager coding style — EventEmitter base, Map-based tracking, async/await
- Silent cleanup failures (PTY pattern) — no exceptions thrown during cleanup
- Console warnings with `[Tangent 2]` prefix for errors
- Proper timer cleanup (reconnectTimer, healthCheckTimer) on dispose/close

**Technical Notes:**
- ssh2 library doesn't have TypeScript definitions — used standard Node types
- `forwardOut()` creates local → remote tunnel (ssh -L equivalent)
- Uses `fs.readFileSync()` for SSH key (synchronous is acceptable in main process)
- Socket health probe with 5s timeout prevents hanging checks

**Integration Points:**
- Consumes `DevBoxConnectionInfo` from `@shared/devbox-types`
- Returns tunnel IDs for lifecycle tracking
- Ready for P2 integration with DevBoxConnectionManager

### 2026-04-13: AcpClient Wrapper Implementation (P2.3)

Created `src/main/devbox/AcpClient.ts` — wraps `@agentclientprotocol/sdk` with Tangent-specific patterns:

**Core Features:**
- `connectWithStream(stream)` — establishes ACP connection using pre-configured Stream
- `createSession(config)` — creates new ACP session, maps Tangent session ID ↔ ACP session ID
- `resumeSession(tangentSessionId)` — reconnects to existing session (tries unstable_resumeSession, falls back to loadSession)
- `sendPrompt(tangentSessionId, text)` — sends user input to ACP session
- `disconnect()` — graceful shutdown, closes all sessions
- `respondToPermission(response)` — UI callback for permission approval/denial

**ACP SDK Discovery:**
- SDK provides `ClientSideConnection` for clients connecting to agents
- Uses `Stream` created with `ndJsonStream(writable, readable)` for JSON-RPC over stdio
- Client implements `Client` interface: `requestPermission()`, `sessionUpdate()`
- Connection provides methods: `initialize()`, `newSession()`, `prompt()`, `loadSession()`, `unstable_resumeSession()`
- Sessions are per-conversation contexts with independent history/state

**Session Management:**
- Bidirectional mapping: Tangent session ID ↔ ACP session ID
- Session state tracking: `connected`, `connecting`, `disconnected`, `reconnecting`, `failed`
- Metrics bridge: maps ACP usage (inputTokens, outputTokens, cache tokens) to Tangent SessionMetrics
- Last activity timestamp for context-switching suggestions

**Permission Request Bridge:**
- Agent → Client permission requests converted to Tangent `AcpPermissionRequest` events
- UI responds via `respondToPermission()` with `AcpPermissionResponse`
- Maps Tangent approval/remember to ACP `allow`/`allow_always`/`deny`/`deny_always`
- 60s timeout with deny fallback for unresponded requests

**Session Update Handling:**
- `sessionUpdate()` notifications converted to `AcpAgentResponse` format
- Extracts message text chunks from assistant messages
- Converts tool calls to Tangent `AcpToolExecution[]` format
- Maps stop reasons (`end_turn`, `cancelled`, `error`) to Tangent status

**EventEmitter Events:**
- `acp:connected` — connection established
- `acp:disconnected` — connection closed
- `acp:session-created` — new session created (payload: AcpSession)
- `acp:message` — agent response received (payload: AcpAgentResponse)
- `acp:permission-request` — permission needed (payload: AcpPermissionRequest)
- `acp:error` — error occurred (payload: Error)

**Design Patterns:**
- Extends EventEmitter for state changes
- console.warn with `[Tangent 2]` prefix for errors
- async/await throughout
- No default exports — named export only
- Stream creation deferred to DevBoxManager (SSH tunnel + stdio integration)

**Integration Points:**
- Consumes types from `@shared/acp-types`
- Integrates with `@agentclientprotocol/sdk` v0.18.2
- Ready for DevBoxManager to provide SSH-tunneled stdio stream

**Notable Decisions:**
- Stream creation placeholder throws — DevBoxManager will provide pre-configured stream via `connectWithStream()`
- Permission timeout is 60s (generous for user decision time)
- Session metrics cost field set to 0 (ACP doesn't provide cost directly)
- Tool execution status simplified: completed → success, otherwise → running

### 2026-04-13: P1.3 — DevBoxManager Implementation

**What:** Created `src/main/devbox/DevBoxManager.ts` for Dev Box lifecycle orchestration.

**Key implementation decisions:**
- EventEmitter pattern matches existing managers (SessionStore, PtyManager)
- Methods: `listDevBoxes()`, `startDevBox()`, `stopDevBox()`, `getConnectionInfo()`, `checkHealth()`, `autoStart()`
- Events: `devbox:state-changed`, `devbox:health-updated`, `devbox:error`
- Error handling uses `console.warn('[Tangent 2] ...')` pattern, returns false/null on errors (no thrown exceptions)
- `autoStart()` method (P1.6 preview) with 5-minute timeout and 10s polling

**Implementation status:**
- ✅ Full TypeScript interface and structure complete
- ⚠️ Method implementations are stubs with TODO comments
- **Reason:** `@microsoft/devbox-mcp` bundles internal `devcenter-internal-stable` SDK (not publicly available)
- The public `@azure/arm-devcenter` is management plane only (resource CRUD, not user operations like list/start/stop)
- **Next step (P2):** Either spawn MCP server as child process with JSON-RPC communication, or wait for public data plane SDK release

**Technical notes:**
- Import path uses `../../shared/devbox-types` (relative, not alias) since this is main process code
- Shared types defined in `@shared/devbox-types`: `DevBoxResource`, `DevBoxProvisioningState`, `DevBoxConnectionInfo`, `DevBoxHealthStatus`
- Dev Box operations require both projectName and devBoxName (not just name alone)
- Health checks should test both SSH (port 22) and ACP (port 7777) reachability when implemented

**Follows conventions:**
- Named exports (no default exports)
- TypeScript strict typing
- `[Tangent 2]` log prefix for consistency
- async/await throughout
- `dispose()` cleanup method

### 2026-04-13: P1.10 — OpenSSH Provisioning Implementation

**What:** Created `src/main/devbox/OpenSshProvisioner.ts` for first-time Dev Box provisioning.

**Core Features:**
- `checkOpenSsh(sshClient)` — Verifies OpenSSH server is installed and running via PowerShell commands over SSH
- `installOpenSsh(sshClient)` — Installs OpenSSH.Server Windows capability using Add-WindowsCapability
- `enableOpenSsh(sshClient)` — Starts sshd service and sets StartupType to Automatic
- `verifyOpenSsh(sshClient)` — Confirms service is Running (Status=4) with Automatic startup (StartType=2)
- `ensureOpenSsh(sshClient)` — Orchestrates full flow: check → install if needed → enable → verify

**Technical Implementation:**
- Executes PowerShell commands over SSH using ssh2's `exec()` method
- Captures stdout/stderr via stream events with proper async/await wrapping
- Uses JSON serialization for service state verification (ConvertTo-Json)
- Service status codes: 4 = Running, StartType codes: 2 = Automatic
- All methods return boolean success/failure — no exceptions thrown

**Error Handling:**
- console.warn with `[Tangent 2]` prefix for all errors
- Silent failures — returns false instead of throwing
- Handles SSH exec errors, non-zero exit codes, stream errors, and JSON parse errors gracefully

**Testing:**
- 20 comprehensive unit tests with mocked SSH client
- Tests cover success paths, failure paths, and error conditions
- Mocks SSH exec callback with stream event simulation
- All tests passing ✅

**Integration Points:**
- Ready for DevBoxManager to call during first-time provisioning flow
- Accepts ssh2 Client instance from SshTunnelManager
- Part of P1 first-time setup workflow

**Design Patterns:**
- Follows existing main process patterns (no EventEmitter needed — stateless operations)
- Named exports only
- async/await throughout
- TypeScript strict typing
- Private helper method `execCommand()` for SSH command execution

### 2026-04-13: P1.6 — autoStart Orchestration Implementation

**What:** Implemented `DevBoxManager.autoStart()` for automated Dev Box start with polling and progress reporting.

**Core Features:**
- Accepts `projectName`, `devBoxName`, optional `progressCallback(state, elapsed)` 
- **Pre-flight check:** Calls private `getDevBox()` to check current state — skips start if already Running
- **Start operation:** Calls `startDevBox()`, throws if start fails
- **Polling loop:** Polls `getDevBox()` every 5 seconds until state changes
- **Progress reporting:** Invokes callback with current state and elapsed time on each poll
- **Success:** Returns full `DevBoxResource` when state reaches 'Running'
- **Timeout:** Throws after 5 minutes (300,000ms) if Dev Box hasn't reached Running state
- **Failure:** Throws immediately if Dev Box enters 'Failed' state during polling

**Technical Implementation:**
- `while` loop with `setTimeout` for 5-second intervals
- Tracks `startTime` via `Date.now()` for elapsed time calculation and timeout enforcement
- Progress states communicated: 'Starting' → 'Provisioning' (or other intermediate states) → 'Running'
- Returns `DevBoxResource` (includes state + connectionInfo) rather than just boolean
- Error handling: catches all errors, logs with `[Tangent 2]` prefix, emits `devbox:error` event, re-throws

**Helper Methods:**
- Added private `getDevBox(projectName, devBoxName): Promise<DevBoxResource | null>` — returns full Dev Box resource for polling
- Placeholder implementation logs and returns null (awaiting MCP integration in P2)

**Test Coverage:**
- 5 autoStart test scenarios added (currently failing due to stub MCP methods):
  1. Starts and polls until Running — validates polling loop and success path
  2. Timeout after 5 minutes — validates timeout enforcement  
  3. Returns immediately if already running — validates pre-flight optimization
  4. Throws on Failed state — validates failure detection
  5. Calls progress callback — validates progress reporting
- All other tests (17) marked `.skip()` pending full MCP integration

**IPC Integration:**
- Already wired in P1.5 (Linus): `devbox:autoStart` handler accepts `projectName`, `devBoxName`, `reportProgress` flag
- Handler creates progress callback that sends `devbox:autoStartProgress` IPC events to renderer
- Returns DevBoxResource on success (includes connection info for immediate use)

**Status:** 
- ✅ Method signature complete
- ✅ Orchestration logic complete (pre-flight, start, poll, timeout, error handling)
- ✅ Progress callback integration complete
- ✅ IPC handler wired (P1.5)
- ⚠️ Tests fail due to stub MCP methods (`startDevBox`, `getDevBox` placeholders return false/null)
- **Next:** P2 will implement actual MCP client calls, enabling full end-to-end functionality

**Design Notes:**
- Follows existing manager patterns (EventEmitter, async/await, `[Tangent 2]` logging)
- Silent cleanup failures pattern (no exceptions in normal flow, only on critical errors)
- Poll interval (5s) and timeout (5min) are hardcoded constants — intentionally not configurable to match requirements
- Method is public API, but `getDevBox()` helper is private to enforce encapsulation

### 2026-04-13: P2.9 — ACP Session Management Implementation

**What:** Extended `AcpClient` with full session lifecycle management for Dev Box remote execution.

**Core Features:**
- `newSession(config)` — Creates new ACP session with workspace context (cwd, mcpServers, env)
- `resumeSession(sessionId)` — Reconnects to existing session using Copilot CLI cloud sync
- `closeSession(sessionId)` — Gracefully closes a specific session
- Bidirectional session ID mapping: Tangent session ID ↔ ACP session ID (stored in Map)
- Session state tracking: `connected`, `connecting`, `disconnected`, `reconnecting`, `failed`

**Session Resume Strategy:**
- Tries `unstable_resumeSession` first (no history replay — best for Dev Box reconnection)
- Falls back to `loadSession` (replays history) if unstable method not available
- Leverages Copilot CLI cloud sync for session state persistence across Dev Boxes

**Session Lifecycle:**
1. `newSession()` — creates new session, returns ACP session ID, stores bidirectional mapping
2. `resumeSession()` — reconnects to cloud-synced session (tries unstable_resumeSession, falls back to loadSession)
3. `closeSession()` — gracefully closes via `unstable_closeSession` if available, removes from local cache
4. `disconnect()` — closes ALL sessions before disconnecting ACP connection

**Session ID Mapping:**
- `tangentToAcpSessionMap: Map<string, string>` — Tangent session ID → ACP session ID
- `acpToTangentSessionMap: Map<string, string>` — ACP session ID → Tangent session ID
- `sessions: Map<string, AcpSession>` — ACP session ID → session object
- `getSession(tangentSessionId)` — retrieves session by Tangent ID
- `getSessions()` — returns all active sessions

**Technical Implementation:**
- Uses `ClientSideConnection.newSession()` from @agentclientprotocol/sdk
- Session config includes `cwd`, `mcpServers`, `env`, optional `sessionId`
- `resumeSession()` creates bidirectional mapping for cloud-synced sessions
- `closeSession()` cleans up both mapping directions
- All methods throw if not connected, return promises

**Test Coverage:**
- 32 passing unit tests covering:
  - Session creation with config
  - Session resumption (unstable_resumeSession)
  - Session close
  - Session ID mapping (bidirectional)
  - Connection lifecycle
  - Error handling (not connected, invalid config, close failures)
  - State management transitions
  - Event emissions

**Design Patterns:**
- Follows existing AcpClient patterns (EventEmitter, async/await, console.warn for errors)
- Named exports only
- TypeScript strict typing
- No exceptions thrown on close failures (logs and continues)

**Integration Points:**
- Ready for DevBoxManager to create sessions with workspace context
- Session IDs can be used with `sendPrompt()` to send user input
- Permission bridge and session updates work with resumed sessions
- Cloud sync enables seamless Dev Box failover (resume session on new box)

<!-- Append learnings below -->
