# Basher — History

## Core Context

- **Project:** Electron terminal app with hybrid PTY+SDK architecture for AI agent orchestration
- **Role:** Tester
- **Joined:** 2026-04-13T01:57:51.252Z

## Learnings

<!-- Append learnings below -->

### 2026-04-13 — Anticipatory Test Scaffolding for Remote Execution Managers

**Context:** Three manager classes are being built in parallel by Rusty (backend engineer) for the remote agent offloading feature:
1. `DevBoxManager` — Azure Dev Box lifecycle and health checks
2. `SshTunnelManager` — SSH tunnel management with auto-reconnect
3. `AcpClient` — Agent Client Protocol integration

**What I did:**
Created comprehensive test scaffolds for all three managers based on type definitions from `src/shared/devbox-types.ts` and `src/shared/acp-types.ts`. Tests cover happy path, error cases, edge cases, and complex flows like exponential backoff and reconnection logic.

**Test file structure:**
- `src/main/devbox/__tests__/DevBoxManager.test.ts` (370 LOC)
  - listDevBoxes: arrays, empty, errors
  - startDevBox/stopDevBox: lifecycle, idempotency, timeouts
  - getConnectionInfo: connection details, missing boxes
  - checkHealth: SSH reachability, health status
  - autoStart: polling, timeout, already-running optimization
  
- `src/main/devbox/__tests__/SshTunnelManager.test.ts` (390 LOC)
  - createTunnel/closeTunnel: success, auth failures, already-closed
  - getTunnelStatus: connected/disconnected/reconnecting states
  - Health monitoring: error detection, event emission
  - Auto-reconnect: exponential backoff (1s, 2s, 4s, 8s, max 30s), max retry exhaustion
  
- `src/main/devbox/__tests__/AcpClient.test.ts` (450 LOC)
  - connect/disconnect: success, ECONNREFUSED, auth failures
  - createSession/sendPrompt: session lifecycle, invalid config
  - Permission bridge: request/response flow, approval/denial
  - Session ID mapping: tangent ↔ ACP bidirectional lookup
  - Reconnection: tunnel recovery, session restoration, state events

**Testing patterns followed:**
- Vitest (`describe`/`it`/`expect`/`vi.mock()`)
- Mock external dependencies (@microsoft/devbox-mcp, ssh2, @agentclientprotocol/sdk, net)
- EventEmitter pattern for manager events
- Fake timers for async delays (polling, backoff)
- Table-driven tests where appropriate (not used here, but considered)

### 2026-04-13 — ACP Integration Tests (P2.11)

**Context:** Needed comprehensive integration tests for `AcpClient` that cover the full protocol lifecycle, not just unit behaviors. Tests should validate end-to-end flows: connection → session creation → permission handling → error recovery → disconnect.

**What I did:**
Created `src/main/devbox/__tests__/acp-integration.test.ts` with 37 tests organized into 6 suites:

**Test suite structure:**
1. **Connection Lifecycle** (6 tests)
   - Connects and initializes ACP protocol with version negotiation
   - Handles connection failures gracefully (network timeout, init errors)
   - Disconnects cleanly with session cleanup
   - Prevents multiple simultaneous connections
   - Handles connection closed (graceful + error paths)

2. **Session Management** (9 tests)
   - Creates sessions with full workspace config (cwd, env, mcpServers)
   - Resumes sessions via `unstable_resumeSession` (preferred path)
   - Falls back to `loadSession` when `unstable_resumeSession` unavailable
   - Throws error when agent lacks session resumption support
   - Closes sessions and removes bidirectional ID mappings
   - Tracks multiple concurrent sessions independently
   - Maps Tangent session IDs ↔ ACP session IDs bidirectionally
   - Sends prompts to correct ACP session via ID mapping
   - Updates `lastActiveAt` timestamp on prompt send

3. **Permission Bridge** (7 tests)
   - Forwards permission requests from ACP server to client (via `requestPermission` handler)
   - Sends approval back to ACP (`allow` outcome)
   - Sends approval with remember choice (`allow_always`)
   - Sends denial back to ACP (`deny` outcome)
   - Sends denial with remember choice (`deny_always`)
   - Handles permission timeout (60s default → auto-deny)
   - Denies permission for unknown sessions

4. **Error Recovery** (7 tests)
   - Reconnects after tunnel drop (create new client, resume sessions)
   - Retries failed operations (temporary failure → success on retry)
   - Reports unrecoverable errors (protocol version mismatch)
   - Handles session creation errors gracefully (invalid workspace path)
   - Handles prompt send errors gracefully (session terminated)
   - Handles session close errors gracefully (close failed)
   - Continues disconnect even if individual session closes fail

5. **Session Updates & Messages** (6 tests)
   - Processes session updates with text messages (extracts assistant content)
   - Processes session updates with tool executions (maps toolCalls → AcpToolExecution)
   - Maps stop reason to status (`end_turn` → `completed`, `error` → `error`)
   - Updates session metrics from usage data (inputTokens, outputTokens, cacheTokens)
   - Updates `lastActiveAt` on session update
   - Handles session updates for unknown sessions gracefully (logs warning, no crash)

6. **End-to-End Workflow** (2 tests)
   - Completes full session lifecycle (connect → create → prompt → close → disconnect)
   - Manages multiple concurrent sessions (create 3, prompt all 3, close 1, verify mappings)

**Mock challenges solved:**
- **Closed promise handling:** Required nullable resolve/reject refs to avoid stale closures across test cases
- **Dynamic mock methods:** Mock `unstable_resumeSession`/`loadSession` availability by creating fresh `ClientSideConnection` instances per test
- **Client handler capture:** Captured `requestPermission` and `sessionUpdate` handlers from `ClientSideConnection` constructor to simulate ACP server → client calls
- **Fake timers:** Used `vi.useFakeTimers()` for permission timeout test (60s fast-forward)

**Key insight:**
Integration tests require mocking at the SDK boundary (ClientSideConnection, ndJsonStream) but exercising the full AcpClient logic. Unit tests (`AcpClient.test.ts`) already cover individual methods; integration tests validate the *orchestration* across connection → sessions → permissions → updates → errors.


**Important notes:**
1. **These are anticipatory tests** — written based on type signatures and PRD requirements, NOT final implementations
2. Some method signatures may not match actual implementations (e.g., `manager.dispose()`, `client.reconnect()`, `manager.checkHealth()`)
3. Exponential backoff test logic may need adjustment after seeing real reconnect implementation
4. Event names (`tunnel-error`, `connection-state-changed`, etc.) are inferred from similar patterns in SessionStore/StatusEngine — may need updates
5. Mock structure assumes common patterns but actual SDK APIs may differ

**Next steps:**
- Once Rusty completes manager implementations, review test failures and adjust
- Add integration tests for orchestration flows (P2.4, P3.4)
- Coordinate with Linus on IPC handler tests once preload bridge exists

**Why this matters:**
Proactive test scaffolding enables:
- Rusty to run tests as implementations progress (TDD-style feedback)
- Earlier detection of API mismatches between types and implementations
- Faster convergence on correct interfaces through test-driven iteration
- Clear documentation of expected behavior for all three managers

### 2026-04-13 — DevBox Lifecycle Integration Tests (P1.13)

**Context:** Created comprehensive integration tests for the complete DevBox connection flow orchestrated by `DevBoxConnector`. Unlike unit tests that mock dependencies, integration tests validate end-to-end workflows with multiple components working together.

**What I did:**
Created `src/main/devbox/__tests__/integration.test.ts` with 33 tests (all passing) organized into 9 suites:

**Test suite structure:**
1. **Full Connection Flow** (2 tests)
   - Orchestrates complete flow: autoStart → ensureOpenSsh → createTunnel → verify → ready
   - Validates custom SSH config (localPort, remotePort) is passed through correctly

2. **Auto-Start Polling** (4 tests)
   - Polls Dev Box state until Running with progress callbacks
   - Handles Dev Box already running (no-op optimization)
   - Fails if Dev Box enters Failed state
   - Fails on timeout (5 minutes) waiting for Dev Box to start

3. **SSH Tunnel Creation** (3 tests)
   - Creates SSH tunnel with correct ports from connection info
   - Passes SSH config to tunnel manager
   - Fails if tunnel creation throws error

4. **Health Monitoring** (3 tests)
   - Waits for tunnel to be ready (polls until status=connected)
   - Detects tunnel health check failures (reflects in connection status)
   - Times out if tunnel never becomes ready (5s timeout)

5. **Reconnection with Backoff** (3 tests)
   - Triggers reconnect when tunnel enters error state
   - Reflects exponential backoff attempts (1s, 2s, 4s, 8s, max 30s)
   - Handles max reconnect attempts reached (updates state to failed)

6. **OpenSSH Provisioning** (4 tests)
   - Provisions OpenSSH on first-time setup (install → enable → verify)
   - Skips provisioning if OpenSSH already running
   - Fails if OpenSSH installation fails
   - Fails if OpenSSH verification fails

7. **Connection Failure Scenarios** (5 tests)
   - Fails at step 1: Dev Box won't start
   - Fails at step 2: SSH provisioning fails
   - Fails at step 3: tunnel creation fails
   - Fails at step 4: health check fails
   - Fails if Dev Box has no connection info

8. **State Transitions** (4 tests)
   - Emits events through complete connection lifecycle (starting → provisioning → tunneling → ready)
   - Emits failed event on any error
   - Emits disconnected event on manual disconnect
   - Tracks state through internal connection handle (ConnectionHandle)

9. **Disconnect Flow** (3 tests)
   - Cleans up tunnel and removes connection from registry
   - Handles disconnect of non-existent connection gracefully
   - Handles disconnect when tunnel close fails (marks as failed but continues)

10. **Multiple Connections** (2 tests)
    - Manages multiple connections independently (different tunnels, states)
    - Disconnects one connection without affecting others

**Mock architecture:**
- Mocked `DevBoxManager`, `SshTunnelManager`, `OpenSshProvisioner`, `RsyncManager` (EventEmitter-based mocks)
- Mocked `ssh2.Client` module to avoid real SSH connections
- Mocked `fs.readFileSync` to avoid file system access
- Injected SSH client factory into `DevBoxConnector` for testability
- Followed exact pattern from existing `DevBoxConnector.test.ts` unit tests

**Key testing patterns:**
- Event tracking: Capture all emitted events to verify orchestration order
- State verification: Check `ConnectionHandle` state at each step
- Async coordination: Use `mockImplementation` + `setTimeout` for async readiness
- Error injection: Mock failures at each orchestration step to validate error handling
- Timeout simulation: Mock `getTunnelStatus` to return 'connecting' indefinitely for timeout tests

**Mock challenges solved:**
- **SSH client factory injection:** DevBoxConnector accepts optional factory; tests inject factory that creates MockSshClient instances
- **File system access:** Avoided keyPath tests that require real file reading (delegated to unit tests)
- **EventEmitter coordination:** Used `vi.fn().mockImplementation()` to capture events and simulate async state changes
- **Test isolation:** Clear `mockSshClients` array in `beforeEach` to prevent cross-test pollution

**Important insights:**
1. Integration tests validate *orchestration* (step sequencing, event flow), not individual method behavior
2. Mocks should be at component boundaries (managers) not internal implementation (fs, net, ssh2)
3. Real SSH connections would make tests slow and flaky — always mock external I/O
4. `sshClientFactory` injection enables test isolation without breaking production code
5. Test timeouts (e.g., 10s for tunnel timeout test) must account for polling intervals

**Next steps:**
- Monitor test stability as DevBoxConnector evolves
- Add integration tests for rsync sync operations when implemented
- Coordinate with Rusty if DevBoxManager API changes break tests

