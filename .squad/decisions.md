# Squad Decisions

## Active Decisions

### 2026-04-12 19:05: PRD intake — Remote Agent Offloading
**By:** charris-msft (Brady) via Copilot
**What:** PRD at D:\git\PMStudio\tangent\tangent_remote_prd.md defines remote agent offloading to Dev Boxes. Scope: Plan A only (Copilot CLI/Tangent + ACP over SSH). Plan B (VS Code) deferred.
**Why:** User provided PRD for new feature work.

### 2026-04-12 19:05: App identity — tangent-2
**By:** charris-msft (Brady) via Copilot
**What:** This copy runs as "tangent-2" to coexist side-by-side with the original Tangent in ../release. Branch: "remote". Package name, productName, appId all need updating.
**Why:** User directive — side-by-side development requirement.

### 2026-04-12 19:05: Dev Box target — charrisdb5
**By:** charris-msft (Brady) via Copilot
**What:** The target Dev Box for remote execution is "charrisdb5". Use this as the default/primary Dev Box for development and testing.
**Why:** User provided their Dev Box name for the remote offloading feature.

### 2026-04-13: PRD Decomposition — Plan A Architecture (58 items)
**By:** Danny (Architecture) via Copilot
**What:** Danny's 58-item work decomposition (D:\git\tangent\release-2\.squad\decisions\inbox\danny-prd-decomposition.md) breaks Plan A across 4 phases. Key architectural decisions from the decomposition:

**Upfront Architectural Decisions:**
1. **Local-as-Primary Model** — Local machine is source of truth for workspace files. Dev Boxes are ephemeral compute.
2. **Copilot CLI Cloud Sync for Sessions** — Use built-in `sessionSync.level = "account"` for session state. No custom rsync of `~/.copilot/session-state/`.
3. **Workspace Sync via Hooks** — `agentStop` hook triggers rsync from Dev Box → local after each agent turn. Outbound sync on connect.
4. **Remote as Opt-In** — Agent profiles get optional `remote.*` fields. Not a default for any agent.
5. **CopilotACP as Auto-Start Service** — Windows Scheduled Task ensures zero manual steps after first-time setup.
6. **First-Time Provisioning with Consent** — Tangent shows what it will change on Dev Box before doing it.
7. **Permission dialogs in local UI** — ACP permission requests bridged to Tangent's local UI, not remote terminal. Maintains security model and user control.
8. **Local-as-Primary for Failover** — If Dev Box crashes mid-turn, worst case is losing one agent turn's workspace changes. Session state already synced to cloud. Spin up new Dev Box and resume.

**Full decomposition includes:** 4 dependency phases (P0–P4), effort estimates (S/M/L), team role assignments, new npm dependencies (@agentclientprotocol/sdk, @microsoft/devbox-mcp, ssh2, node-rsync), and risk mitigation strategies. See full document for 58 items and timeline estimates.

**Why:** Provides concrete work scope, dependency sequencing, and architectural commitments for 9–11 week Plan A implementation.

### 2026-04-13: ACP SDK API Surface
**By:** Rusty  
**Status:** ✅ Accepted  
**Tags:** #acp #sdk #api

**What:** Exploration of `@agentclientprotocol/sdk` v0.18.2 reveals API surface for ClientSideConnection, AgentSideConnection, Stream, and Client interface patterns.

**Key Decisions:**
- Use `ClientSideConnection` for Tangent's Dev Box ACP client
- Implement minimal required `Client` interface (requestPermission, sessionUpdate)
- Defer stream creation to DevBoxManager (SSH tunnel + stdio bridge)
- Use `unstable_resumeSession` with fallback to `loadSession`
- Use `unstable_closeSession` if available during disconnect

**Rationale:** Tangent is a CLIENT connecting to remote ACP agents (not an agent itself). Minimal Client interface reduces complexity. Stream creation separated from AcpClient allows flexible transport.

**Impact:** 
- AcpClient wraps ClientSideConnection, maps Tangent sessions ↔ ACP sessions
- DevBoxManager responsible for creating Stream (SSH tunnel + stdio bridge)
- Future incremental expansion of Client capabilities as needed

**See:** Full discovery details in implementation PR, SDK Docs at https://agentclientprotocol.github.io/typescript-sdk

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
