# Decision: Direct ACP Tunnel (SSH Elimination)

**By:** Rusty (Backend Dev)  
**Date:** 2026-04-13  
**Status:** ✅ Implemented  
**Tags:** #devbox #connectivity #acp #devtunnel

## Context

We're building remote agent offloading to Azure Dev Boxes. The initial connectivity chain was:

```
local machine → devtunnel connect (remote:22 → localhost:port) → SSH (ssh2 library) 
              → SSH port forward → remote:3000 (ACP)
```

SSH authentication was failing because Windows OpenSSH on domain-joined Dev Boxes (e.g., `REDMOND\charris`) rejects the domain user as "Invalid user". Rather than fighting Windows OpenSSH domain user authentication, we eliminated SSH entirely for ACP connectivity.

## Decision

**Use dev tunnel direct port forwarding for ACP connectivity. Eliminate SSH as middleman.**

### New Architecture

```
local machine → devtunnel connect (remote:3000 → localhost:port) → ACP directly
```

The dev tunnel already provides:
- ✅ Authenticated access (Microsoft tenant via `devtunnel user login -g`)
- ✅ Encrypted port forwarding
- ✅ Cross-machine connectivity (same-org users)

SSH was just being used as a redundant port forwarding mechanism.

### Implementation Changes

**1. `assets/devbox-setup.ps1`**
- Added port 3000 (ACP) to tunnel creation
- Kept port 22 (SSH) for potential future rsync/workspace sync

**2. `src/main/devbox/DevTunnelManager.ts`**
- Changed `connect()` return type: `Promise<number>` → `Promise<DevTunnelPorts>`
- New interface: `DevTunnelPorts` with `sshPort`, `acpPort`, `allPorts` Map
- Parse ALL port mappings from `devtunnel connect` output (22 and 3000)
- Added `getLocalAcpPort()` method

**3. `src/main/devbox/DevBoxConnector.ts`**
- Skip SSH client creation, OpenSSH provisioner, SshTunnelManager in primary flow
- Use `DevTunnelPorts.acpPort` directly
- Verify ACP port reachable via direct TCP probe (`_waitForAcpReady()`)
- Store `acpLocalPort` in ConnectionHandle for AcpClient to use
- SSH-related code remains as optional/fallback (constructor still accepts SshTunnelManager)

**4. `src/shared/constants.ts`**
- Updated `REMOTE_PORTS` comments to reflect direct tunnel architecture

## Benefits

1. **Simpler connectivity** — one fewer hop in the chain
2. **Avoids domain user SSH auth issues** — no SSH required for agent execution
3. **Already authenticated** — dev tunnel handles auth via Microsoft tenant
4. **Faster connection** — skip SSH handshake, OpenSSH provisioning checks
5. **Clear separation** — SSH kept optional for workspace sync (rsync), not required for agents

## Trade-offs

- SSH still available as fallback (code not removed, just not used in primary flow)
- Constructor signature unchanged (DevBoxConnector still accepts SshTunnelManager)
- DevTunnelManager API change breaks 20 existing tests (Basher will fix mocks)

## Dependencies

- Dev tunnel CLI (`devtunnel`) installed and logged in with GitHub
- Dev Box setup script run to create tunnel with ports 22 and 3000
- `devbox-config.json` contains tunnel ID for target Dev Box

## Testing Impact

- 20 tests failing due to `DevTunnelManager.connect()` API change
- Tests expect `Promise<number>`, now returns `Promise<DevTunnelPorts>`
- Basher assigned to update test mocks

## Related Work

- P1.7: DevTunnelManager implementation
- P1.8: SshTunnelManager implementation (now optional/fallback)
- P1.9: OpenSshProvisioner implementation (now optional/fallback)

## Future Considerations

- SSH remains available for rsync-based workspace sync (local → Dev Box)
- If workspace sync proves unnecessary (Copilot CLI cloud session sync sufficient), SSH could be removed entirely
- Dev tunnel handles auth/encryption, so no additional security needed
