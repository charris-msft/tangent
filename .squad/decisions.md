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

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
