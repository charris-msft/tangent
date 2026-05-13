# Squad Decisions

## Active Decisions

### 2026-04-19: Explode Refinement #1 — Exclusion-Rect Tiling (Keep Main in Place)
**By:** Danny (Lead/Architect)  
**Status:** ✅ Implemented  
**Tags:** #ui #windows #explode #refinement

**Problem:** After main window was included in Explode grid, popouts would overlap it during repositioning.

**Root Cause:** Tiling algorithm computed tile positions as if entire display was available. No mechanism to "reserve" main window's current location.

**Decision:** Replace sentinel-tile approach with exclusion-rect approach:
- `computeTileLayout()` now accepts optional `excludeRect?: Rect` parameter
- Algorithm checks each tile position against exclusion bounds
- Grid grows to accommodate N cells while avoiding excluded area
- Main window position becomes hard constraint in layout

**Implementation:**
- Modified `src/shared/tiling.ts` — exclusion-rect parameter in computeTileLayout
- Updated `src/renderer/hooks/useExplode.ts` — fetch main bounds, pass as exclusion
- Added 8 test cases for exclusion scenarios in `tiling.test.ts` (32/32 passing)

**Key Design Decision:** Main window is NOT moved during Explode. It remains visible and functional as the "hub" cell. Popouts tile around its current location.

**Trade-off (Architect Named):** When main covers >50% of display, grid returns fewer cells than requested. Graceful degradation over silent overlap.

**Files Changed:** `src/shared/tiling.ts`, `src/renderer/hooks/useExplode.ts`, `src/shared/__tests__/tiling.test.ts`

**Related Commits:** `2b26208`

### 2026-04-19: Explode Refinement #2 — Font Size Preservation in Popouts
**By:** Danny (Lead/Architect)  
**Status:** ✅ Implemented  
**Tags:** #ui #terminal #popout #refinement

**Problem:** Popout windows would reset to hardcoded `fontSize={14}`, losing user's configured font size.

**Root Cause:** `PopoutWindowShell.tsx` had hardcoded font size. No subscription to config changes.

**Decision:** All terminal instances (main + popout) read font size from single config source.

**Implementation:**
- Read `config.fontSize` on popout mount
- Subscribe to config change events in popout
- Gracefully update terminal when config changes
- Main window already subscribed (no changes needed)

**Key Design Decision:** Font size is user-configured and must not be rescaled by popout logic. Config is the authority; all instances follow it.

**Files Changed:** `src/renderer/components/PopoutWindowShell.tsx`, `src/renderer/hooks/useExplode.ts`

**Related Commits:** `444e945`

### 2026-04-19: Explode Refinement #3 — Terminal Mirroring in Dual Windows
**By:** Livingston (Integration Dev)  
**Status:** ✅ Implemented  
**Tags:** #ui #terminal #pty #refinement

**Problem:** When a session was popped out, terminal content appeared ONLY in popout window. Main window lost visibility into session activity.

**Root Cause:** IPC infrastructure was already broadcasting to both windows, but UI blockers (placeholder overlays) prevented dual rendering. Resize ownership was undefined — both windows tried to size the PTY.

**Decision:** Mirror terminal content (both windows render same stream) + coordinate resize ownership.

**Implementation:**
- Both main window tab AND popout render same PTY stream (mirrored)
- Removed placeholder overlays blocking dual rendering
- **Popout owns PTY sizing when open** — sends resize events; main scrolls
- Main reclaims ownership if popout closes unexpectedly
- Extended `SessionManager` to track both renderers per session

**Key Design Decision:** 
1. **Mirror not move:** Session is mirrored (both render) vs. moved (one renders)
2. **Popout owns sizing:** When popout open, it dictates PTY dimensions. Main observes, doesn't force resize. Prevents thrash.
3. **Graceful fallback:** If popout closes unexpectedly, main gracefully takes sizing ownership again.

**Rationale for Sizing Ownership:** Multiple windows rendering same content must coordinate sizing to avoid:
- Simultaneous resize requests (PTY thrash)
- Conflicting terminal dimensions
- Scrollback corruption

**Files Changed:** `src/main/terminal/TerminalManager.ts`, `src/main/session/SessionManager.ts`, `src/renderer/components/Terminal.tsx`, `src/renderer/components/PopoutWindow.tsx`, `src/main/window/WindowManager.ts`, `tests/terminal-mirror.spec.ts`

**Related Commits:** `500fc15`

### 2026-05-05: Squad V2 Governance Upgrade — Model Policy & Reviewer Diversity
**By:** Danny (Lead/Architect)  
**Status:** ✅ Implemented  
**Tags:** #squad #governance #models #review

**What:** Comprehensive Squad governance upgrade establishing:
1. **Model Policy** by agent type (code agents: sonnet-4.5, reviewer: gpt-5.5, logging: haiku-4.5)
2. **Reviewer Turk** — GPT-5.5 specialist for escalated architectural rejections
3. **Tangent-specific routing** — Domain map (PTY/status/ipc/SDK/React/E2E/packaging) + response modes
4. **Process ceremonies** — Pre-Flight, Per-Task Gate, Packaging Smoke Gate, Retrospective
5. **Packaging guardrails** — npm build + electron-builder flow, npmRebuild=false mandatory, test regression evolution

**Files changed:** `.squad/team.md`, `.squad/routing.md`, `.squad/ceremonies.md`, `.squad/casting/registry.json`, `.squad/agents/turk/*`

**Rationale:** FC2 audit revealed delegation collapse pattern. Tangent adopts proven fixes: cost-aware model hierarchy, model-diverse review, ceremony-based process enforcement, Tangent-specific constraint capture.

**Cost hierarchy:** haiku < sonnet < gpt-5.5 < opus. Sonnet handles 95% of work at reasonable cost. GPT-5.5 provides non-Anthropic perspective only on escalation (prevents cost explosion).

**Impact:** Cost predictability, review quality, velocity gates, routing clarity.

### 2026-05-05: Squad V2 Validation Guardrails — Union Merge & Structural Checks
**By:** Basher (Test Engineer)  
**Status:** ✅ Implemented  
**Tags:** #squad #validation #compliance

**What:** Structural compliance guardrails for Squad V2:
1. **Union merge rules** in `.gitattributes` — append-only Squad files (decisions.md, history.md, logs)
2. **Validation script** (`.squad/scripts/validate-squad-process.ps1`) — 6 checks without expensive builds
3. **Documentation** (`.squad/scripts/README.md`) — usage examples, parameters

**Checks:** team.md structure, routing.md concepts, ceremonies.md gates, .gitattributes union rules, regression hook status, package status.

**Design:** Read-only, runs on dirty worktrees, exit 0 on pass, exit 1 on fail. Package check warning-only by default (use `-RequirePackage` to enforce).

**Rationale:** Squad V2 requires structural conventions to prevent merge conflicts and ensure process compliance. Fast validation without triggering expensive builds or tests.

**Impact:** Pre-commit validation enabled. Structural regression detection. Tangent-specific (safe on dirty worktree, Electron-aware).

### 2026-05-05: Prompt/Task Timeline — Backend + Frontend Planning
**By:** Rusty (Backend) + Livingston (Frontend)  
**Status:** ✅ Planning complete, ready for parallel implementation  
**Tags:** #feature #timeline #planning

**Backend Plan (Rusty):**
- Data model for prompt history and task tracking
- Session state persistence (local + cloud sync strategy)
- IPC message specifications for timeline updates
- Agent result aggregation and storage
- Storage sizing for 1000+ entries per session

**Frontend Plan (Livingston):**
- Timeline component layout (vertical scrollable history)
- Task state visualization (pending, in_progress, done, blocked)
- Wireframes for TimelinePanel integration with SessionsPanel
- Component hierarchy (TimelinePanel, TimelineEntry, TaskCard, PromptBlock)
- Accessibility (keyboard nav, ARIA), performance (lazy-loading, virtualization)

**Rationale:** Parallel work enabled by finalizing backend/frontend contracts before implementation. Planning phase complete; execution can proceed with non-blocking dependencies.

**Architecture:** TimelinePanel persists prompts and task results, integrated into SessionsPanel. Results searchable by agent type, timestamp, outcome. Agent attribution and timing annotations preserved.

**Impact:** Feature ready for parallel backend + frontend implementation. Contracts finalized.

### 2026-05-05: Waiting Status for Copilot Pickers
**By:** Rusty (Backend)
**Status:** ✅ Implemented
**Tags:** #status #systemb #copilot

**What:** The status engine now treats only a bare `❯`/`›` prompt line as idle. A `❯` marker followed by selectable content is an interactive picker, not the agent-ready prompt.

**Why:** Copilot's resume-session picker uses `❯` for the selected row and prints `Select a session to resume:` / `Enter to select`. The previous prompt heuristic suppressed `needs_input` whenever any line started with `❯`, so launch-time resume pickers did not color the session as waiting.

**Impact:** SystemB now maps Copilot resume/session pickers to `needs_input`, preserving the Sessions panel waiting/attention color while keeping stale completed ask-user text suppressed when a bare idle prompt is visible.

**Files Changed:** `src/main/status/system-b.ts` (detection rules), unit test coverage added

### 2026-05-05: Session Waiting Rows Use Renderer-Derived Attention Color
**By:** Livingston (Frontend)
**Status:** ✅ Implemented
**Tags:** #ui #sessions #status #rendering

**What:** In the Sessions panel, non-shell rows that render `Waiting...` because `lastActivity` is empty or only a process path (`cmd.exe`, `pwsh.exe`, `powershell.exe`) now use a renderer-derived `needs_input` visual state.

**Why:** Copilot startup/resume pickers can be waiting on the user while the backend status still reports `shell_ready`, `agent_launching`, or `agent_ready`. The row's visible status text is the user's source of truth, so the selected active row must keep the red attention strip/dot/background instead of falling back to uncolored shell styling.

**Impact:**
- Backend status remains unchanged.
- Renderer status text and status color are derived together in `SessionsPanel/sessionRowState.ts`.
- Regression coverage asserts selected waiting Copilot rows keep the waiting color.

**Files Changed:** `src/renderer/components/SessionsPanel/sessionRowState.ts` (new), `src/renderer/components/SessionsPanel/index.tsx`, unit tests added

### 2026-05-05: Session Waiting Color Regression Coverage
**By:** Basher (Test Engineer)
**Status:** ✅ Implemented
**Tags:** #testing #e2e #sessions #status-ui

**What:** Added a deterministic regression path for Sessions panel status styling by exposing stable row test attributes and a `tangentAPI.test.setSessionState` helper (NODE_ENV=test only).

**Why:** The session waiting color bug was visual and state-specific: a selected Copilot session waiting at startup or in `needs_input` could lose its waiting color. Reproducing that via real Copilot startup/resume is slow and flaky, so the targeted regression should inject the public session state and assert the visible contract.

**Impact:** Future visual regressions in selected-session status styling can be covered without depending on agent runtime, terminal timing, or internal CSS class names. Test instrumentation provides stable assertions.

**Files Changed:** `src/renderer/components/SessionsPanel/` (test attributes), `src/preload/test.ts` (new test API), `tests/regression/specific.spec.ts` (rewritten)

### 2026-05-06: Forge Chat Foundry Agent Integration — Research & Requirements

**By:** Linus (Integration Dev) via Copilot  
**Date:** 2026-05-10  
**Status:** 🟡 Spike complete; research spike handed to Danny for PoC planning  
**Tags:** #foundry #agents #integration #insights-agent #auth  
**Reference:** `.squad/decisions/inbox/linus-legacy-fc-foundry-agents.md` (401 lines)

**What:** Spike research of `coreai-microsoft/forge` legacy Forge Chat (`products/foundry-ui` Python Starlette server) to understand:
- How legacy FC discovers and invokes Azure AI Foundry agents
- How the **Insights Agent** (App Insights / KQL MCP wrapper) works as a Foundry agent
- Auth patterns (Easy Auth + OBO cloud; `AzureCliCredential` local)
- Configuration matrix and Azure resource requirements

**Key Findings:**

1. **Hot path is single SSE endpoint:** Legacy FC proxies all agent traffic through `POST /api/agui/run` — one server route for all agent streaming.

2. **Foundry agent invocation shape:** Uses Azure AI Projects SDK with OpenAI-compatible Responses API:
   ```python
   openai_client = AIProjectClient(credential, endpoint).get_openai_client()
   openai_client.responses.create(
     input=messages,
     stream=True,
     extra_body={
       "agent_reference": {"type": "agent_reference", "name": agent_name},
       "structured_inputs": {...optional...}
     }
   )
   ```

3. **AG-UI event translation is the contract:** Foundry emits raw events (`response.output_text.delta`, `response.function_call_arguments.*`, etc.); FC translates to **AG-UI SSE protocol** (`TEXT_MESSAGE_*`, `TOOL_CALL_*`, `RUN_STARTED`, `RUN_FINISHED`, `RUN_ERROR`, `CONSENT_REQUIRED`). Translation table is battle-tested and must be ported verbatim.

4. **The Insights Agent is just `insights-agent`** — a Foundry prompt agent (`agents/insights-agent/agent.yaml`) with:
   - Model: gpt-5.4
   - MCP server: `insights-mcp[-int].purplesky-21d895f1.francecentral.azurecontainerapps.io/mcp`
   - 12 tools (query_metric, list_metrics, query_anomaly, get_query_kql, …)
   - Invoked identically to any other Foundry agent (no special code path)
   - **Not related to `appInsightsConnectionString`** (that's frontend telemetry JS SDK)

5. **Auth complexity varies by deployment:**
   - **Cloud (Container Apps):** Easy Auth sidecar provides `X-MS-TOKEN-AAD-ACCESS-TOKEN` (aud=ai.azure.com). FC's two-path resolver: (a) Foundry audience → direct passthrough; (b) others → MSAL OBO with MI `client_assertion` via FIC (`api://AzureADTokenExchange`)
   - **Local dev (PoC):** `az login --tenant 72f988bf-86f1-41af-91ab-2d7cd011db47` + `AzureCliCredential` end-to-end. No Easy Auth. Simpler path for initial PoC.

6. **Required cloud resources for production:** App registration (auth client_id), User-assigned Managed Identity (UAMI), Federated Identity Credential (FIC), Easy Auth on Container App, UAMI with `Azure AI User` role on Foundry project.

7. **TS SDK risk:** Must verify `@azure/ai-projects` (or `openai` JS client via `client.inference.azureOpenAI`) supports `extra_body` / `agent_reference` pass-through. If not, fallback to raw `fetch` to `/openai/v1/responses` endpoint with bearer token.

**PoC-Grade Path (Linus proposes):**
- Build Node/TS **Foundry agent connector** in `src/main/` (not Python Starlette) that:
  1. Resolves config (AZURE_TENANT_ID, FOUNDRY_PROJECT_ENDPOINT)
  2. Acquires token via `AzureCliCredential` (local only)
  3. Lists agents with `AIProjectClient.agents.list()`
  4. Streams one turn to `insights-agent` via Responses API
  5. Translates Foundry events to AG-UI events
- No UI yet; CLI script or thin debug harness is enough to validate
- Integration owner: Linus; SDK parity owner: Rusty

**Citations:**
- Server entry: [`products/foundry-ui/host/server/app.py`](https://github.com/coreai-microsoft/forge/blob/main/products/foundry-ui/host/server/app.py)
- AG-UI route: [`products/foundry-ui/host/server/routes/agui.py`](https://github.com/coreai-microsoft/forge/blob/main/products/foundry-ui/host/server/routes/agui.py)
- Auth: [`products/foundry-ui/host/server/auth/`](https://github.com/coreai-microsoft/forge/tree/main/products/foundry-ui/host/server/auth)
- Insights Agent: [`agents/insights-agent/agent.yaml`](https://github.com/coreai-microsoft/forge/blob/main/agents/insights-agent/agent.yaml)
- Env-var matrix: [`products/foundry-ui/host/server/config/_settings.py`](https://github.com/coreai-microsoft/forge/blob/main/products/foundry-ui/host/server/config/_settings.py)

**Why:** User strategy is Forge Chat (as Electron app, not legacy SPA) that connects to Foundry agents. This research unblocks PoC architecture and validates the shape.

---

### 2026-05-06: Forge Chat Foundry Agent PoC — Next Step (Adopted)

**By:** Danny (Lead/Architect) via Copilot  
**Date:** 2026-05-06  
**Status:** 🟢 Adopted as next PoC milestone; team routing finalized  
**Tags:** #forge-chat #foundry #agents #insights-agent #auth #poc #decision  
**Reference:** `.squad/decisions/inbox/danny-forge-chat-foundry-poc-next-step.md` (170 lines)

**What:** Decision to adopt Linus's spike proposal as the next Forge Chat PoC milestone. Build a **minimal Node/TypeScript Foundry agent connector** that can list Foundry agents and stream one turn to `insights-agent` using local `az login` credentials.

**Scope — Intentionally Boring:**
- No new UI, no Easy Auth, no Cosmos, no GitHub OAuth, no multi-project registry
- CLI/script or thin debug surface that proves `listAgents()` and `streamRun("insights-agent")` works
- Local-only auth (AzureCliCredential) — defer hosted auth to Phase 2
- Target project: Anvil INT (`https://ai-account-ccqhoqjgdz3mw.services.ai.azure.com/api/projects/forge-anvil-int-eus2`)

**Architecture Flow:**
```
Forge Chat renderer/debug harness
  → IPC request/push events
  → main-process FoundryAgentConnector
      1. resolve config: AZURE_TENANT_ID + FOUNDRY_PROJECT_ENDPOINT
      2. acquire token via AzureCliCredential for local PoC
      3. list agents with AIProjectClient.agents.list()
      4. invoke Responses API stream with agent_reference + structured_inputs
      5. translate Foundry stream events into AG-UI events
  → Azure AI Foundry project
      → Insights Agent
          → Insights MCP Container App
              → App Insights / KQL / metric tools
```

**Architectural Boundary:** Renderer never owns tokens. Foundry credentials, token caching, stream cancellation belong in main. Shared AG-UI event types (protocol shape, not secrets) live in `src/shared/`.

**App Insights / Insights Agent MVP Scope:**
- The Insights Agent is NOT a special integration. It's a standard Foundry prompt agent that legacy FC discovers and invokes like any other.
- MVP: (1) Confirm `agents.list()` returns `insights-agent`; (2) Stream a prompt to it; (3) Emit AG-UI events for assistant text and tool calls; (4) Validate at least one Insights MCP tool call in stream; (5) Render/debug tool-call events as structured output later.
- Do NOT wire `APPLICATIONINSIGHTS_CONNECTION_STRING` for this milestone (that's frontend telemetry, not agent connection).

**Auth Path — Local Development First:**

Prereq: `az login --tenant 72f988bf-86f1-41af-91ab-2d7cd011db47`

Required config:
- `AZURE_TENANT_ID=72f988bf-86f1-41af-91ab-2d7cd011db47`
- `FOUNDRY_PROJECT_ENDPOINT=https://ai-account-ccqhoqjgdz3mw.services.ai.azure.com/api/projects/forge-anvil-int-eus2`

Implementation rule: Create resolver shaped like `resolveToken(audience) → { token, audience, flow, expiresAt, cached }`, but implement only `flow=cli` initially. This keeps callers stable when hosted auth arrives in Phase 2.

**Hosted Auth — Deferred but Design Seam Now:**
- Legacy FC uses Azure Container Apps Easy Auth + Managed Identity for cloud.
- Open architecture decision before production: **desktop-native auth (MSAL Node public-client) vs. server-mediated auth (Easy Auth/OBO)**. If Forge Chat remains pure Electron desktop, the hosted pattern may be wrong center of gravity.

**Implementation Slices (Team Routing):**

1. **Minimal first milestone — connector smoke test** (Owner: Linus)
   - Main-process Foundry connector using `AzureCliCredential`, lists agents, finds `insights-agent`, streams one prompt, prints normalized AG-UI events, cancels cleanly.

2. **Protocol model and translation parity** (Owner: Linus, Reviewer: Danny)
   - Add shared AG-UI event types and port Foundry-event translation table verbatim.

3. **SDK parity decision** (Owner: Rusty)
   - Verify TS SDK (`@azure/ai-projects` + `openai` JS package) supports Responses API streaming with `extra_body.agent_reference`. If not, raw HTTPS fallback.

4. **Main-process IPC seam** (Owner: Livingston)
   - Expose `foundry.listAgents()` and cancellable stream-run event channel through preload using Tangent's existing IPC conventions.

5. **Insights debug UI / agent sidebar entry** (Owner: Livingston)
   - Add thinnest UI to invoke `insights-agent` and display text/tool-call events.

6. **Validation and automation** (Owner: Basher)
   - Tests around event translation, cancellation, missing config, missing agent, friendly 401/403 modes. Full e2e against Foundry is opt-in.

7. **Hosted auth design spike** (Owner: Danny + Rusty, after local PoC works)
   - Decide whether production is hosted/server-mediated or desktop-native. Port Easy Auth/OBO/MI behavior only after decision.

**Trade-offs: Copy, Adapt, Avoid**

| Legacy FC Item | Decision | Trade-off |
|---|---|---|
| `agent_reference` extra body | Copy | Lowest risk; this is the Foundry contract. |
| Foundry → AG-UI event translation | Copy | Preserves compatibility; avoids bikeshedding. |
| `TokenResolver` shape | Adapt | Stable seam for future CLI/MI/OBO flows. |
| AzureCliCredential local path | Copy | Fastest PoC path; single-user dev only. |
| Easy Auth headers + OBO | Defer/adapt later | Correct for hosted ACA; wrong for desktop Electron. |
| Python Starlette server | Avoid | Would duplicate runtime; fight Electron. |
| Cosmos chat persistence | Avoid for PoC | Not on critical path; in-memory fine initially. |
| GitHub OAuth structured input | Defer | Only needed for agents declaring `auth_token`. |
| Multi-project registry | Defer | Single Foundry project enough for PoC. |

**Known Unknowns:**
1. Does TS SDK expose same Responses streaming path as Python?
2. Does `extra_body.agent_reference` pass through cleanly in JS client?
3. Does developer identity have `Azure AI User` on Anvil INT project?
4. Is `insights-agent` deployed in target project today?
5. What API version for raw Responses API if SDK parity insufficient?
6. How should cancellation propagate from Electron IPC to HTTP stream?
7. Before production: desktop-native MSAL or server-mediated auth?

**Validation Checklist:**
- [ ] `az login --tenant 72f988bf-86f1-41af-91ab-2d7cd011db47` completed.
- [ ] Missing `FOUNDRY_PROJECT_ENDPOINT` fails with clear local setup message.
- [ ] `listAgents()` returns ≥ 1 agent including `insights-agent` (or helpful error).
- [ ] `streamRun({ agent: "insights-agent" })` emits `RUN_STARTED`.
- [ ] Stream emits assistant text and/or tool-call AG-UI events.
- [ ] Stream ends with `RUN_FINISHED` or structured `RUN_ERROR`.
- [ ] At least one Insights MCP tool call observed in stream.
- [ ] Token resolver shows `flow=cli` locally.
- [ ] Second token request uses cache when valid.
- [ ] 401/403 errors identify likely tenant/RBAC fixes without dumping secrets.
- [ ] Cancellation closes stream without orphaning connections.
- [ ] No secrets or bearer tokens committed or logged.

**Why:** PoC keeps focus on architectural uncertainty that matters: can Forge Chat connect to Foundry agent surface and stream the Insights Agent? Everything else is secondary. This milestone is intentionally small and boring to avoid prematurely copying hosted auth and persistence decisions that may not survive the Electron deployment model.

### 2026-05-12: Terminal Containment Pattern — Overflow Clipping & Flex Boundary
**By:** Livingston (Frontend Dev)  
**Status:** ✅ Implemented  
**Tags:** #ui #terminal #xterm #layout

**Problem:** Terminal content (xterm) could render outside its column boundary and paint stray wrapped text under the right AgentsSidebar rail.

**Root Cause:** xterm cached pixel width from previous fit. When flex siblings or the right rail changed available width, visible overflow allowed stale terminal layers to paint outside the terminal column.

**Decision:** Terminal rendering must be clipped at the renderer flex-cell boundary. All containers (App shell row, terminal column, `TerminalViewport`, xterm host) use `overflow: hidden`.

**Implementation:**
- Keep terminal column `min-w-0` and `overflow: hidden`
- Keep `TerminalViewport` and xterm host `overflow-hidden`
- Call `fitAddon.fit()` only when host container has positive `clientWidth` and `clientHeight`
- Use CSS to prevent horizontal xterm viewport overflow

**Key Design Decision:** Clipping is the single source of containment truth. No reliance on parent width synchronization; instead, all ancestors maintain the boundary contract.

**Files Changed:** `src/renderer/App.tsx`, `src/renderer/components/Terminal/TerminalViewport.tsx`, `src/renderer/styles/globals.css`

**Validation:** `npm run build` passed, Playwright regression passed, packaged exe refreshed.

---

### 2026-05-12: Terminal Wrap Regression Guards — Bounding-Box Contract
**By:** Basher (Test Engineer)  
**Status:** ✅ Implemented  
**Tags:** #testing #e2e #terminal #layout #agents-sidebar

**Problem:** Targeted regressions for terminal/sidebar layout needed to assert against terminal text clipping under the agent rail.

**Root Cause:** Screenshots are fragile and hard to compare reliably. The actual geometric contract is simpler: terminal content boxes must stay within `data-testid="terminal-column"` and must not reach the right AgentsSidebar rail.

**Decision:** Targeted regression tests should assert DOM bounding boxes instead of snapshots.

**Implementation:**
- Visible xterm surfaces (`.xterm`, `.xterm-screen`, `.xterm-rows`, `.xterm-viewport`) must stay within terminal column bounds
- `tests/regression/specific.spec.ts` writes long terminal line and verifies terminal surface boxes clear the rail anchored by the accessible "Add project" button
- Bounding-box checks are deterministic, fast, directly test the user-observable contract

**Key Design Decision:** Use bounding-box geometry assertions; do not depend on pixel snapshots or CSS class introspection.

**Files Changed:** `tests/regression/specific.spec.ts`

**Validation:** `npm run test:regression` 6/6 passed, specific bounding-box assertions pass.

---

### 2026-05-12: Squad Governance Alignment — Import fc2 Durability Patterns
**By:** Danny (Lead/Architect)  
**Status:** ✅ Implemented  
**Tags:** #squad #governance #process

**Problem:** Squad V2 processes needed durability patterns proven in parallel projects (fc2).

**Decision:** Import three low-risk governance improvements from fc2:
1. **Heartbeat.md** — lightweight status tracking file with updated_at, phase, agent, current_task, status, last_action
2. **Formalized config.json model policy** — moved from team.md prose to machine-readable structure with explicit agent-model overrides (danny, turk, scribe, ralph)
3. **Enhanced routing.md** — added explicit "Hard Rejection Path" and "Testing & Integration Gates" sections for escalation clarity

**Rationale:** These patterns provide quick visibility into project state without cross-referencing multiple files. Lightweight overhead vs. significant clarity gain for team onboarding and async context.

**Implementation:**
- Added `.squad/heartbeat.md` with lifecycle tracking
- Updated `.squad/config.json` with `defaultModel` and `agentModelOverrides`
- Enhanced `.squad/routing.md` with escalation/test gates documentation

**Trade-offs:** Minimal duplication (team.md rationale still needed) vs. machine-readable policy enabling tooling.

**Breaking Changes:** None — all additive.

**Risk Assessment:**
| Factor | Assessment |
|--------|------------|
| **Breaking changes** | None — all additive |
| **Team buy-in** | High — patterns are lightweight and reusable |
| **Maintenance burden** | Minimal — heartbeat is single-file, config.json mirrors team.md |
| **Applicability** | Durable across future projects with different domains |

**Validation:** `.squad/` files validated per existing structural compliance checks.

---

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
