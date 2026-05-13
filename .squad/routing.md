# Work Routing

How to decide who handles what.

## Response Mode Selection

**When user asks a question, choose ONE response mode:**

| Mode | When | How |
|------|------|-----|
| **Direct answer** | Factual question answerable from context/memory | Coordinator answers inline, no agent spawn |
| **Single specialist** | Focused task with clear owner | Spawn one agent, `mode: "foreground"` |
| **Parallel batch** | Multiple independent tasks | Spawn all agents, `mode: "background"` |
| **Sequential handoff** | Task requires 2+ stages with dependencies | Spawn first agent foreground, they spawn next |

**Examples:**
- "What port does dev server use?" → Direct answer (read package.json)
- "Fix this bug in StatusEngine" → Single specialist (Rusty, foreground)
- "Team, review PRD and estimate effort" → Parallel batch (all agents, background)
- "Build feature X" → Sequential (Danny designs → Rusty/Linus implement → Basher tests)

## Squad-First Reflex

**Before answering ANY user request, check:**

1. **Is there a relevant Squad member?** If yes, route to them instead of doing it yourself
2. **Could multiple agents work in parallel?** If yes, spawn all simultaneously as background
3. **Is this a simple fact lookup?** If yes, answer directly without spawning

**Anti-patterns to avoid:**
- ❌ Coordinator writing code (spawn coder)
- ❌ Coordinator running tests (spawn Basher)
- ❌ Spawning agents for "what's the server port?" (answer directly)
- ❌ Sequential spawns when parallel is possible (blocks velocity)

## Tangent-Specific Routing

### Domain Routing Table

| Work Type | Route To | Examples |
|-----------|----------|----------|
| **Architecture & system design** | Danny | ADRs, component boundaries, status authority policy, technology choices, trade-off analysis |
| **Electron main process** | Rusty | SessionStore, SessionManager, PtyManager, WindowManager, IPC event handlers |
| **Status engine** | Rusty | StatusEngine, SystemA/SystemB, OscParser, CwdTracker, status transitions, detection rules |
| **SDK integration** | Linus | CopilotClient, AcpClient wiring, SDK version upgrades, protocol implementation |
| **IPC & preload** | Linus | IPC handler registration, contextBridge API, tangentAPI namespace, request-reply patterns |
| **PTY wiring** | Linus | node-pty integration, terminal data flow, resize handling, process lifecycle |
| **ACP & Dev Box** | Linus | ACP protocol, SSH tunnels, rsync, Dev Box provisioning, remote execution flows |
| **React UI** | Livingston | Components, hooks (useSessions, useAgents), event subscriptions, state management |
| **xterm.js terminal** | Livingston | Terminal rendering, addons, fit, themes, ANSI escape handling |
| **Tailwind/shadcn** | Livingston | Styling, GitHub Dark theme, component variants, responsive layout |
| **Unit testing** | Basher | Vitest tests, table-driven tests, pure function coverage, edge cases |
| **E2E testing** | Basher | Playwright tests, regression suite (general.spec.ts, specific.spec.ts), hook scripts |
| **E2E hook workflow** | Basher | `run-e2e-on-stop.ps1`, hook registration, test-results/hook-report.json, regression test strategy |
| **Packaging & builds** | Rusty | electron-builder config, npmRebuild=false flag, dist/win-unpacked/Tangent.exe canonical path |
| **Dev tunnel & remote** | Linus | devtunnel CLI, port forwarding, remote Dev Box connectivity |
| **Code review (first pass)** | Danny | PR review, architectural consistency, quality gates |
| **Deep second opinion** | Turk | Hard rejections, model-diverse review, architectural dissent (GPT-5.5 only) |
| **Scope & priorities** | Danny | PRD triage, feature roadmap, trade-offs, backlog grooming |
| **Session logging** | Scribe | Automatic — never needs routing |

### Technology Layer Map

| Layer | Primary Owner | Secondary |
|-------|---------------|-----------|
| Electron main process | Rusty | — |
| Electron preload | Linus | — |
| React renderer | Livingston | — |
| xterm.js | Livingston | — |
| node-pty | Linus | Rusty |
| Copilot SDK | Linus | Danny (architecture) |
| Status detection | Rusty | Danny (arbitration) |
| Testing (all types) | Basher | — |

## Escalation & Review Gates

### Hard Rejection Path

When Danny rejects a PR with required changes:
1. If the issue is architectural or requires a hard second opinion, escalate to Turk (GPT-5.5) for model-diverse perspective.
2. Turk's rejection may require a different agent to revise (not the original author).
3. Turk is only invoked after Danny rejection + re-rejection OR explicit coordinator escalation.

**Trade-off:** Higher per-invocation cost vs. architectural insurance and monoculture prevention.

### Testing & Integration Gates

E2E regression suite changes (adds/removals from `tests/regression/general.spec.ts` or `tests/regression/specific.spec.ts`) require:
1. Basher implements test
2. Target fix passes test (GREEN)
3. Test fails on baseline without fix (RED proof logged)
4. Basher validates hook registration and test-results/hook-report.json output

## Issue Routing

| Label | Action | Who |
|-------|--------|-----|
| `squad` | Triage: analyze issue, assign `squad:{member}` label | Danny |
| `squad:{name}` | Pick up issue and complete the work | Named member |
| `squad:untriaged` | Issue blocked pending user input or research | — |
| `go:needs-research` | Pre-implementation investigation required | Assigned agent or Danny |

### How Issue Assignment Works

1. When a GitHub issue gets the `squad` label, the **Lead** triages it — analyzing content, assigning the right `squad:{member}` label, and commenting with triage notes.
2. When a `squad:{member}` label is applied, that member picks up the issue in their next session.
3. Members can reassign by removing their label and adding another member's label.
4. The `squad` label is the "inbox" — untriaged issues waiting for Lead review.

## Routing Rules

1. **Squad-First Reflex** — route to specialist agents, don't do their work yourself
2. **Eager by default** — spawn all agents who could usefully start work, including anticipatory downstream work
3. **Scribe always runs** after substantial work, always as `mode: "background"`. Never blocks
4. **Quick facts → coordinator answers directly.** Don't spawn an agent for "what port does the server run on?"
5. **When two agents could handle it**, pick the one whose domain is the primary concern
6. **"Team, ..." → fan-out.** Spawn all relevant agents in parallel as `mode: "background"`
7. **Anticipate downstream work.** If a feature is being built, spawn the tester to write test cases from requirements simultaneously
8. **Issue-labeled work** — when a `squad:{member}` label is applied to an issue, route to that member. The Lead handles all `squad` (base label) triage
9. **Review failures → Turk for deep second opinion** — on Danny rejection, coordinator may escalate to Turk (GPT-5.5) for model-diverse perspective

## Review Escalation

| Scenario | First Reviewer | On Rejection | Deep Second Opinion |
|----------|----------------|--------------|---------------------|
| Routine PR | Danny | Author revises, Danny re-reviews | — |
| Contentious change | Danny | If Danny still rejects after revision → Turk | Turk (GPT-5.5) with full context |
| Architectural dispute | Danny rejects | Turk review with both perspectives | Turk decides or requires new specialist |

**Turk invocation rules:**
- Only on explicit rejection + re-rejection OR coordinator determination that model diversity needed
- Turk uses GPT-5.5 for non-Anthropic perspective
- Turk may require different agent revise (not original author)
- Turk approval/rejection is binding unless Danny overrides as Lead

