# Squad Team

> release-2

## Coordinator

| Name | Role | Notes |
|------|------|-------|
| Squad | Coordinator | Routes work, enforces handoffs and reviewer gates. |

## Members

| Name | Role | Charter | Status |
|------|------|---------|--------|
| Danny | Lead | `.squad/agents/danny/charter.md` | ✅ Active |
| Rusty | Backend Dev | `.squad/agents/rusty/charter.md` | ✅ Active |
| Linus | Integration Dev | `.squad/agents/linus/charter.md` | ✅ Active |
| Livingston | Frontend Dev | `.squad/agents/livingston/charter.md` | ✅ Active |
| Basher | Tester | `.squad/agents/basher/charter.md` | ✅ Active |
| Turk | GPT-5.5 Reviewer | `.squad/agents/turk/charter.md` | 🔍 On-Demand |
| Scribe | Session Logger | `.squad/agents/scribe/charter.md` | 📋 Silent |
| Ralph | Work Monitor | `.squad/agents/ralph/charter.md` | 🔄 Monitor |

## Model Policy

**Default model selection by work type:**

| Agent Type | Model | Rationale |
|------------|-------|-----------|
| Code agents (Danny, Rusty, Linus, Livingston, Basher) | `claude-sonnet-4.5` | Cost-optimized standard for routine coding, refactors, and implementation work |
| Deep second opinion (Turk) | `gpt-5.5` | Model diversity for architectural review and hard rejections only |
| Logging/monitoring (Scribe, Ralph) | `claude-haiku-4.5` | Ultra-low-cost for background/observability work |

**Override rules:**
- Coordinator may escalate individual tasks to higher models when complexity demands
- Turk is only invoked for explicit deep second opinions, never routine review
- Model cost hierarchy: haiku < sonnet < gpt-5.5 < opus

**Trade-off:** Cost efficiency (sonnet baseline) vs. model diversity (gpt-5.5 for hard disagreements). Avoids anthropic-only monoculture while keeping costs bounded.

## Project Context

- **Project:** release-2
- **Created:** 2026-04-13

## PRD

- **Source:** D:\git\PMStudio\tangent\tangent_remote_prd.md
- **Title:** Remote Agent Offloading to Dev Box
- **Scope:** Plan A — Copilot CLI/Tangent + ACP over SSH
- **Target Dev Box:** charrisdb5
- **Branch:** remote
