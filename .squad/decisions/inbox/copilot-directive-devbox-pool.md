### 2026-04-14T00:04: User directive — Dev Box pooling with automatic assignment
**By:** charris-msft (Brady) (via Copilot)
**What:** Treat all Dev Boxes as a pool. Tangent auto-assigns agents to Dev Boxes without user specifying which one. Fill first Dev Box to capacity (start with limit of 10 agents), then overflow to the next. No manual devbox selection — Tangent manages the pool.
**Why:** User requirement — enables scaling agent workload across multiple Dev Boxes transparently. User plans 4-5 Dev Boxes. Config shape: pool with capacity, not manual per-agent assignment.

**Proposed config shape:**
```json
{
  "devCenterEndpoint": "https://...",
  "projectName": "basic",
  "pool": {
    "capacity": 10,
    "devBoxes": ["charrisdb5", "charrisdb6", "charrisdb7", "charrisdb8"]
  },
  "devBoxes": {
    "charrisdb5": { "tunnelHost": "...", "sshUser": "charris" },
    "charrisdb6": { "tunnelHost": "...", "sshUser": "charris" },
    "charrisdb7": { "tunnelHost": "...", "sshUser": "charris" },
    "charrisdb8": { "tunnelHost": "...", "sshUser": "charris" }
  }
}
```

**Assignment algorithm:** Fill-first (pack agents into first available Dev Box until capacity, then next). Track active agent count per Dev Box in memory.
