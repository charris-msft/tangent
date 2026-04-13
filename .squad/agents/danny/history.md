# Danny — History

## Core Context

- **Project:** Electron terminal app with hybrid PTY+SDK architecture for AI agent orchestration
- **Role:** Lead
- **Joined:** 2026-04-13T01:57:51.192Z

## Learnings

### 2026-04-13 — ACP Architecture Documentation (P2.12)

**Created: `docs/architecture/acp-integration.md`**
- Comprehensive ACP integration architecture guide covering all aspects of remote agent execution
- Sections: Overview, Connection Flow (SSH tunnel → ACP connect → session create), Session Lifecycle (create/resume/close), Permission Handling (ACP requests → UI approval → response), Error Recovery (tunnel drops, ACP crashes, sync conflicts)
- Mermaid diagrams: Connection sequence diagram and Permission request flow
- Key Files table: AcpClient, AcpProvisioner, DevBoxManager, SshTunnelManager, DevBoxConnector, acp-types, devbox-types, IPC handlers, RsyncManager
- SDK API Surface: Details of ClientSideConnection, minimal Client interface (requestPermission, sessionUpdate), Session operations (newSession, unstable_resumeSession, unstable_closeSession, prompt), Events (SessionNotification), Permission protocol
- Event Flow Summary: Main → AcpClient → Renderer events and Renderer → Main → AcpClient handlers
- Implementation Notes: Session ID mapping (bidirectional), Permission timeout (60s default deny), Stream creation (SSH tunnel)
- Testing Strategy: Unit tests for managers, integration tests for orchestration, E2E tests for UI flows, mock strategies
- Security: SSH tunnel encryption, private key storage, permission approval, timeout fallback, session/workspace isolation

**Design Principles Applied**
- Tangent is ACP CLIENT (not agent) — implements minimal Client interface for simplicity
- Session ID mapping essential for bridging Tangent local IDs ↔ ACP remote IDs
- Permission callbacks bridge remote (ACP) requests to local (UI) for user control
- Error recovery handles tunnel instability via exponential backoff + sync conflict UI
- Cloud sync (Copilot CLI) decouples session state from Dev Box ephemeral compute

<!-- Append learnings below -->

### 2025-06-01 — Remote Execution Architecture (Plan A)

**Decision: Local-as-Primary Model**
- Local machine is always source of truth for workspace files
- Dev Boxes are ephemeral compute — replaceable, no persistent state assumptions
- Trade-off: Requires bidirectional sync overhead, but gains resilience and failover without data loss
- Impact: Worst-case failure loses at most one agent turn's workspace changes

**Decision: Copilot CLI Cloud Sync for Session State**
- Use built-in `sessionSync.level = "account"` instead of custom rsync for `~/.copilot/session-state/`
- Trade-off: Dependency on GitHub's infrastructure vs. self-managed sync
- Benefit: Cross-device session resumption, failover to any Dev Box without custom session state migration
- Tangent auto-configures this during first-time Dev Box provisioning

**Decision: Workspace Sync via Copilot CLI Hooks**
- `agentStop` hook triggers rsync Dev Box → local after each agent turn
- Alternative considered: Filesystem watching (rejected — too noisy, mid-turn partial states)
- Alternative considered: Continuous background sync (rejected — inefficient, conflicts)
- Trade-off: Sync lag after each turn vs. real-time consistency
- Benefit: Clean sync points aligned with agent conversation boundaries, minimal conflict surface

**Decision: Remote Execution as Opt-In per Agent Profile**
- Extended `AgentProfile` interface with optional `remote` object
- Not a global setting or default behavior
- Trade-off: Per-agent config complexity vs. user control and gradual adoption
- Benefit: Users can experiment with one agent profile, keeps local workflow intact

**Decision: ACP over SSH Tunnel (No tmux)**
- CopilotACP runs as Windows Scheduled Task auto-started on Dev Box login
- ACP protocol over SSH tunnel provides structured JSON-RPC events
- tmux rejected because: Windows-only Dev Boxes (would require WSL2), ACP already provides superior structured events, process persistence handled by Scheduled Task
- Trade-off: SSH tunnel instability vs. WSL2 dependency and filesystem bridging latency
- Mitigation: Health monitoring, auto-reconnect, exponential backoff

**Decision: First-Time Provisioning with Explicit Consent**
- Tangent shows consent dialog listing all changes before provisioning Dev Box
- Changes: OpenSSH service, CopilotACP scheduled task, Copilot CLI session sync config, sync hook scripts
- Trade-off: Extra user interaction vs. transparency and trust
- Benefit: Users understand what Tangent does to their Dev Box, no hidden magic

**Session Architecture Patterns**
- Created `RemoteSession` type extending base `Session` with remote-specific fields
- RemoteSessionManager orchestrates: Dev Box lifecycle → workspace sync → ACP session creation
- Status engine explicitly skips remote sessions (no terminal output parsing)
- Remote session states: `starting-devbox` → `syncing-out` → `tunneling` → `verifying-acp` → `running` → `syncing-back`

**Sync Conflict Handling**
- Detect local uncommitted changes before applying inbound sync
- UI presents choices: Keep Local / Use Remote / Merge (opens diff tool)
- Sync exclusions configurable via glob patterns (stored in `~/.tangent-2/sync-config.json`)

**Failover Strategy**
- Workspace files: local has latest (synced after last agent turn)
- Session state: in cloud via Copilot CLI sync
- Reconnection flow: detect tunnel failure → re-establish tunnel → verify ACP → resume session
- Dev Box switch flow: disconnect → connect new box → sync workspace out → resume
- "Continue Locally" escape hatch: sync workspace one final time → create local PTY session with `--resume`

**Dependency Choices**
- `@microsoft/devbox-mcp` for Dev Box discovery and lifecycle (Microsoft-maintained)
- `@agentclientprotocol/sdk` for ACP client (Copilot CLI official SDK)
- `ssh2` for SSH tunnel management (mature, well-tested)
- `node-rsync` for workspace sync (Node.js wrapper, fallback to robocopy on Windows if needed)

**Testing Strategy**
- Unit tests for managers (DevBoxManager, SshTunnelManager, RsyncManager, AcpClient)
- Integration tests for orchestration flows (connection, provisioning, sync, session lifecycle)
- E2e tests for UI flows (Dev Box assignment, connection, reconnection, failover)
- Mock DevBox MCP and ACP responses to avoid live cloud dependencies in CI

**Work Breakdown Insights**
- 58 total work items across 4 phases
- Critical path: P0.1 → Phase 1 (Dev Box lifecycle) → Phase 2 (ACP) → Phase 3 (sync) → Phase 4 (Tangent integration)
- Parallel tracks enable: Rusty on backend managers, Linus on SDK/IPC, Livingston on UI, Basher on tests
- Estimated 9-11 weeks for full implementation with 5-person team

**Risks & Mitigations**
- SSH tunnel instability → health monitoring + auto-reconnect + connection status UI
- Workspace sync conflicts → conflict detection UI + merge options + exclusion config
- Dev Box provisioning failures → consent dialog + retry logic + manual fallback docs
- rsync not available → check during provisioning + auto-install or document manual install
- ACP service crashes → Windows Scheduled Task auto-restart + health verification

**Key Files Modified**
- `src/shared/types.ts` — extended `AgentProfile` with `remote` fields, added `RemoteSession` type
- `src/main/agents/AgentStore.ts` — schema v3 with remote fields, backward-compatible migration
- `src/main/agents/AgentLauncher.ts` — route remote-enabled agents to RemoteSessionManager
- `src/main/session/SessionStore.ts` — track `remoteState` for remote sessions
- New main process managers: DevBoxManager, SshTunnelManager, RsyncManager, AcpClient, RemoteSessionManager, DevBoxProvisioner
- New UI components: DevBoxPicker, DevBoxStatus, ProvisioningConsentDialog, ConnectionLostDialog, SyncLogModal

### 2025-06-01 — TypeScript Type Definitions for Remote Execution (P1.2 + P2.2)

**Created: `src/shared/devbox-types.ts`**
- `DevBoxResource` — Dev Box entity with state, connection info, health status
- `DevBoxProject` — project container grouping Dev Boxes
- `DevBoxConnectionInfo` — SSH and ACP connection details (IP, host, ports)
- `DevBoxProvisioningState` — enum matching Azure Dev Center API states
- `DevBoxHealthStatus` — connection validation results
- `DevBoxConfig` — user config stored in agent profile
- `DevBoxProvisioningConsent` — tracks first-time setup consent
- `DevBoxSyncConfig` — workspace sync exclusion patterns

**Created: `src/shared/acp-types.ts`**
- `AcpSession` — active ACP session with state and metrics
- `AcpSessionConfig` — workspace context for remote sessions (cwd, env, MCP servers)
- `AcpPermissionRequest/Response` — permission callback protocol
- `AcpAgentResponse` — structured agent output (text, tools, status)
- `AcpToolExecution` — remote tool execution records
- `AcpConnectionState` — enum for tunnel/protocol lifecycle
- `AcpMessage` — base protocol message type
- `AcpEvent` — union of all server-to-client events
- `AcpConnectionOptions` — SSH tunnel configuration

**Design Patterns Applied**
- Followed existing conventions from `types.ts`: interface over type aliases, JSDoc comments, explicit exports
- Enum-as-union pattern for state types (matches `SessionStatus`, `AgentType`)
- Separated concerns: DevBox infrastructure vs. ACP protocol
- Optional fields for progressive enhancement (e.g., `healthStatus`, `acpPort`)
- Trade-off: Comprehensive types for IDE autocomplete vs. future flexibility (chose comprehensive — easier to extend than restrict)

### 2025-06-01 — Phase 4 Type Extensions (P4.1 + P4.4)

**Extended: `src/shared/types.ts`**
- **P4.1: AgentProfile.remote** — Added optional `remote` object with `enabled`, `devBoxProject`, `devBoxName`, `repoPath`, `sshUser`. All fields optional to maintain backward compatibility. Enables per-agent opt-in to remote execution.
- **P4.4: RemoteSessionState** — Added 6-state lifecycle type: `'starting-devbox' | 'syncing-out' | 'tunneling' | 'verifying-acp' | 'running' | 'syncing-back'`. Tracks remote session progression from Dev Box startup through ACP connection.
- **P4.4: Session remote fields** — Extended `Session` interface with 7 optional fields: `remoteState`, `devBoxName`, `devBoxProject`, `remoteConnectionId`, `remoteSyncState`, `lastSyncTime`, `acpSessionId`. All optional for non-remote sessions.
- **P4.4: SessionKind extension** — Added `'remote-agent'` to `SessionKind` union type. Discriminates remote sessions from local PTY/SDK sessions.
- **P4.4: AgentStoreData version** — Bumped schema version from 2 to 3 for remote field migration support.

**Design Principles Applied**
- Backward compatibility: All new fields are optional, existing code unaffected
- No breaking changes: Types remain extensible with union and interface patterns
- Consistent with existing architecture: Remote fields follow same naming/structure as `sdkSessionId`, `metrics`, etc.
- References external types: `RemoteSessionState` documented with JSDoc but kept self-contained (doesn't import from devbox-types/acp-types to avoid circular deps)
- Progressive enhancement: Remote sessions inherit all base Session fields, add remote-specific tracking on top

**Why Optional vs. Required**
- Rationale: 90% of Tangent users won't use remote execution in v1. Making fields required would force null-checking noise in session rendering, PTY management, status engine, etc.
- Trade-off: Type safety vs. developer ergonomics. Chose ergonomics — consumers can narrow with type guards (`session.kind === 'remote-agent'`) when needed.
- Alternative considered: Separate `RemoteSession extends Session` interface. Rejected — would require discriminated union handling in every IPC boundary and React component.

**Work Completed**
- ✅ P4.1: AgentProfile remote fields
- ✅ P4.4: RemoteSessionState type
- ✅ P4.4: Session remote fields
- ✅ P4.4: SessionKind extension
- ✅ P4.4: AgentStoreData version bump
