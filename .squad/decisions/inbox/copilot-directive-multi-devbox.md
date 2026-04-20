### 2026-04-14T00:01: User directive — Multi-Dev Box agent distribution
**By:** charris-msft (Brady) (via Copilot)
**What:** Users will want multiple Tangent agents connecting to the same Dev Box, AND agents connecting to different Dev Boxes. Brady plans to create 4-5 Dev Boxes to spread agent workload. The architecture must support: (1) concurrent ACP sessions on a single Dev Box, (2) per-devbox tunnel configuration, (3) agent-to-devbox routing/assignment.
**Why:** User requirement — defines the scale target for remote offloading. The devbox-config.json already has a `devBoxes` map supporting multiple boxes, and ACP supports concurrent sessions. Docs should cover multi-devbox setup.
