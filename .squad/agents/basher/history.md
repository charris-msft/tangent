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
