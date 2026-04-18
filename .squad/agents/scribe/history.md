# Scribe — History

## Core Context

- **Project:** Electron terminal app with hybrid PTY+SDK architecture for AI agent orchestration
- **Role:** Session Logger
- **Joined:** 2026-04-13T01:57:51.253Z

## Learnings

### 2026-04-18: Explode Tile Overlap Root Cause Discovery
**Decision:** Merged Danny's ADR into active decisions. Root cause was NOT tiling algorithm (Livingston's earlier fix was correct), but `WindowManager.popOut()` ignoring bounds for existing windows.

**Key insight:** Complex bugs often have multiple layers. Livingston's bounds-clamping fix was necessary but insufficient. When investigating unresolved user complaints, always check the CALL SITE (how results are applied) not just the algorithm. In this case: algorithm was producing correct tile positions, but existing windows weren't being repositioned via `setBounds()`.

**Process learning:** Maintain cross-agent history.md entries with UPDATE notes when new discoveries refine earlier work. Example: Livingston's history now has UPDATE note linking to Danny's fix and explaining why both were needed.

**Documentation pattern:** New decision merged into decisions.md (not kept in inbox). Orchestration log captures context. Session log provides brief summary. Cross-agent history shows the connection.


