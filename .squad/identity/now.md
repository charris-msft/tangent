---
updated_at: 2026-05-06T00:00:00.000Z
focus_area: Forge Chat Foundry Agent PoC
active_issues:
  - Validate TS Foundry Responses API streaming with agent_reference.
  - Prove local AzureCliCredential flow against Anvil INT insights-agent.
---

# What We're Focused On

Forge Chat is replacing the legacy Foundry UI path. Current team focus is the Foundry Agent PoC: list agents from a Foundry project, invoke `insights-agent`, and stream normalized AG-UI events from the Electron main process.

## Recent Learnings

- Legacy FC's App Insights path is just `insights-agent` behind Foundry; Forge Chat should build a general Foundry agent connector, not a bespoke App Insights integration.
- Local PoC should use `az login` + `AzureCliCredential`; hosted Easy Auth/OBO is a later architecture decision tied to deployment model.
