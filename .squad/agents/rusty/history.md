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

<!-- Append learnings below -->
