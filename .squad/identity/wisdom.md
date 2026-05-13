---
last_updated: 2026-05-06T00:00:00.000Z
---

# Team Wisdom

Reusable patterns and heuristics learned through work. NOT transcripts — each entry is a distilled, actionable insight.

## Patterns

<!-- Append entries below. Format: **Pattern:** description. **Context:** when it applies. -->

**Pattern:** Copy external protocol contracts, not legacy host architecture. **Context:** For Forge Chat replacing legacy Foundry UI, preserve `agent_reference` and AG-UI event semantics while reimplementing the connector in the Electron/TypeScript main process.

**Pattern:** Separate local proof auth from production auth early. **Context:** For Azure/Foundry integrations, use CLI credentials to prove API shape first, but keep a token-resolver seam so hosted Easy Auth/OBO or desktop MSAL can replace it later.
