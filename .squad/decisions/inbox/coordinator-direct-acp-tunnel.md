### 2026-04-13: Architecture — Eliminate SSH for ACP, use direct dev tunnel port forwarding
**By:** charris-msft (Brady) + Squad Coordinator
**Status:** ✅ Accepted
**What:** Instead of routing ACP traffic through SSH (devtunnel → SSH:22 → SSH port forward → ACP:3000), add ACP port 3000 directly to the dev tunnel. The dev tunnel already provides Microsoft-authenticated, encrypted port forwarding — SSH was a redundant middleman causing domain user auth failures on Windows OpenSSH.
**Why:** Windows OpenSSH on domain-joined Dev Boxes (Entra ID) rejects domain users as "Invalid user" — a known issue with complex workarounds. The dev tunnel already authenticates via Microsoft tenant access, making SSH unnecessary for port forwarding. This simplifies the architecture from 3 hops to 1 hop and eliminates an entire authentication surface.
**Impact:** DevTunnelManager learns multi-port parsing, DevBoxConnector skips SSH steps, setup script adds port 3000 to tunnel. SSH infrastructure (SshTunnelManager, ssh2) retained but not used in primary flow.
