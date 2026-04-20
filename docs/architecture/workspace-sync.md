# Workspace Sync Architecture

This document describes how Tangent synchronizes workspace files between local and remote Dev Box machines, ensuring data consistency and conflict resolution during remote agent execution.

---

## Overview

**Problem:**
When agents run on remote Dev Boxes, workspace files must be kept in sync. Without synchronization, agents can't see local changes, and local can't see agent results. Too-frequent sync creates conflicts; too-infrequent sync creates stale data.

**Solution:**
Tangent uses **local-as-primary** architecture: local machine is always the source of truth for workspace files. Dev Boxes are ephemeral compute. Sync happens at explicit boundaries (on connect and after agent stops), not continuously.

**Benefits:**
- **Resilience** — If Dev Box crashes, no workspace data is lost (local is always current)
- **Failover** — Spin up new Dev Box and resume from last synced state
- **Conflict-free** — Sync points align with agent boundaries (before/after turns), minimizing conflict surface
- **Low overhead** — rsync only transfers changed files; excluded patterns reduce noise

---

## Local-as-Primary Model

### Ownership Rules

| Scenario | Owner | Action |
|----------|-------|--------|
| User modifies file locally | Local | Changes persist; synced to Dev Box next connection |
| Agent modifies file on Dev Box | Remote | Changes synced back after agent stops |
| Both modified between syncs | Conflict | UI presents resolution options (keep-local / use-remote / merge) |
| File is in exclusion list | Local | Changes not synced; excluded from remote permanently |

### State Invariant

After every successful sync:
```
Local Workspace State ⊆ Local Machine Disk
                ↓ (outbound sync)
            Dev Box Disk
                ↓ (inbound sync after agent stop)
            Local Machine Disk (merged state)
```

If sync fails, local state is always preserved (never wiped by failed remote).

---

## Sync Triggers

Workspace sync happens at three explicit points in the session lifecycle:

### 1. Outbound Sync: On Dev Box Connect

**When:** User selects remote Dev Box and clicks "Launch"

**Direction:** Local → Dev Box

**Purpose:**
- Transfer current workspace to Dev Box so agent has latest files
- Set up initial environment (working directory, environment variables)

**Flow:**
```
[SessionManager] User launches agent with remote: {devBoxName: 'charrisdb5'}
    ↓
[RemoteSessionManager] Starts Dev Box (via DevBoxManager)
    ↓
[SshTunnelManager] Opens SSH tunnel to Dev Box
    ↓
[AcpProvisioner] Ensures CopilotACP scheduled task is running
    ↓
[RsyncManager] Runs outbound sync
    $ rsync -avz --exclude=<patterns> \
        /local/workspace/ \
        ssh-user@dev-box:/remote/workspace/
    ↓
[AcpClient] Creates ACP session with synced workspace context
    ↓
Agent ready to run
```

**Config passed to agent:**
```typescript
{
  cwd: '/remote/workspace',  // Dev Box working directory
  env: {
    PATH: '/usr/bin:/bin:...',  // Dev Box PATH
    // ... other env vars
  },
  mcpServers: {
    // MCP servers configured for Dev Box (file browser, git, etc.)
  }
}
```

---

### 2. Inbound Sync: After Agent Completes (agentStop Hook)

**When:** Agent finishes and emits `agentStop` event (after tool calls complete)

**Direction:** Dev Box → Local

**Purpose:**
- Capture any files modified by agent (e.g., generated code, test results)
- Return updated workspace to local for user inspection
- Preserve agent artifacts

**Flow:**
```
Agent execution completes
    ↓
[CopilotACP on Dev Box] Emits agentStop event
    ↓
[RemoteSessionManager] Receives agentStop signal via ACP
    ↓
[RsyncManager] Runs inbound sync
    $ rsync -avz --exclude=<patterns> \
        ssh-user@dev-box:/remote/workspace/ \
        /local/workspace/
    ↓
[ConflictDetector] Scans for local uncommitted changes vs. remote changes
    ↓
If conflicts found:
  → Emit 'sync:conflict' event
  → UI shows conflict dialog (keep-local / use-remote / merge)
  → User resolves
Else:
  → Merge complete
    ↓
Agent turn done, ready for next input
```

---

### 3. Full Sync: On Session End or Disconnect

**When:**
- User closes remote session
- SSH tunnel drops unexpectedly
- Dev Box powers off during execution

**Direction:** Dev Box → Local (one final pull)

**Purpose:**
- Ensure no workspace changes are left on Dev Box
- Clean up for next connection
- Support failover flow (switch Dev Box and resume)

**Flow:**
```
[SessionManager] Session ends
    ↓
[RsyncManager] Runs full inbound sync (forced, no conflict detection)
    $ rsync -avz --force --exclude=<patterns> \
        ssh-user@dev-box:/remote/workspace/ \
        /local/workspace/
    ↓
[SshTunnelManager] Closes SSH tunnel
    ↓
[AcpClient] Closes ACP session
    ↓
Session cleaned up
```

**Note:** Full sync uses `--force` flag to avoid conflicts; local changes are NOT checked. This assumes user doesn't modify local files while agent is running.

---

## Conflict Resolution

Conflicts occur when both local and remote workspaces have changes to the same file(s) since last sync.

### Conflict Detection

Before applying inbound sync, RsyncManager scans for uncommitted local changes:

```typescript
// Pseudo-code
function detectConflicts(localPath: string, remoteFiles: string[]): ConflictingFile[] {
  const conflicts = []
  
  for (const remoteFile of remoteFiles) {
    const localFile = path.join(localPath, remoteFile)
    
    // Check if local file exists and differs from last synced version
    if (fs.existsSync(localFile)) {
      const localHash = hashFile(localFile)
      const syncedHash = loadLastSyncedHash(remoteFile)
      
      if (localHash !== syncedHash) {
        // Local was modified since last sync
        conflicts.push({
          path: remoteFile,
          hasUncommittedChanges: true
        })
      }
    }
  }
  
  return conflicts
}
```

Hashes are stored in `~/.tangent-2/sync-cache.json` after each successful sync.

### Resolution Options

When conflicts detected, Tangent UI shows:

```
Sync Conflict — 3 files have uncommitted changes

Files:
  • src/app.ts (modified locally)
  • src/config.json (modified locally)
  • docs/README.md (modified locally)

Remote also modified these files. How to resolve?

[Keep Local]  — Discard remote changes, keep your local edits
[Use Remote]  — Apply all remote changes, lose local edits
[Merge]       — Open diff tool to resolve per-file
```

**Keep Local** — Rolls back Dev Box changes:
```typescript
// Apply remote sync, then revert local files to pre-sync state
await rsync(remote → local)
for (const file of conflicts) {
  // Restore from sync cache
  fs.copyFileSync(syncCache[file], path.join(localPath, file))
}
```

**Use Remote** — Overwrites local:
```typescript
// Standard rsync (--delete), local files get overwritten
await rsync(remote → local)
```

**Merge** — Opens diff tool (VS Code):
```powershell
code --diff <remote-file-cache> <local-file>
```
After user manually edits local file, sync completes normally.

---

## Exclusion Patterns

Not all files should sync. Tangent excludes files matching patterns in `~/.tangent-2/sync-config.json`:

### Default Exclusions

```json
{
  "excludePatterns": [
    "node_modules",
    ".git",
    ".env",
    "*.log",
    ".DS_Store",
    "Thumbs.db",
    "dist",
    "build",
    "out",
    ".vscode",
    ".idea"
  ]
}
```

### rsync Command

```bash
rsync -avz \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='.env' \
  --exclude='*.log' \
  --exclude='.DS_Store' \
  --exclude='Thumbs.db' \
  --exclude='dist' \
  --exclude='build' \
  --exclude='out' \
  --exclude='.vscode' \
  --exclude='.idea' \
  local/ remote/
```

### Customizing Exclusions

Edit `~/.tangent-2/sync-config.json` to add project-specific patterns:

```json
{
  "excludePatterns": [
    "node_modules",
    ".git",
    ".env",
    "*.log",
    "dist",
    "build",
    "*.whl",           // <-- Added: exclude Python wheels
    "venv",            // <-- Added: exclude virtual env
    ".pytest_cache",   // <-- Added: pytest temp files
    "*.egg-info",      // <-- Added: setuptools build artifacts
    "coverage.xml"     // <-- Added: coverage reports
  ]
}
```

**Tips:**
- Use `*` for wildcard matching: `*.whl` matches all `.whl` files
- Use `/` for directory-specific patterns: `venv/` matches only `venv` directory
- Restart Tangent after editing to apply changes

---

## Event Flow

RsyncManager emits events during sync operations:

### Events

| Event | Payload | Meaning |
|-------|---------|---------|
| `sync:started` | `{ direction, localPath, remotePath }` | Sync operation starting |
| `sync:progress` | `{ bytesTransferred, filesSynced, currentFile }` | Update on transfer progress |
| `sync:complete` | `{ direction, result: RsyncResult }` | Sync finished successfully |
| `sync:error` | `{ direction, error }` | Sync failed (network, permissions, rsync not found) |
| `sync:conflict` | `{ files: ConflictingFile[], localPath, remotePath }` | Conflicts detected during inbound |

### Listener Example

```typescript
rsyncManager.on('sync:progress', (progress) => {
  console.log(`Synced ${progress.filesSynced} files, ${progress.bytesTransferred} bytes`)
  console.log(`Current: ${progress.currentFile}`)
  // Update UI progress bar
})

rsyncManager.on('sync:conflict', (event) => {
  console.log(`Conflicts in: ${event.files.map(f => f.path).join(', ')}`)
  // Show UI dialog for user to choose resolution
})
```

---

## Troubleshooting

### rsync Not Found

**Problem:** Sync fails with "rsync: command not found"

**Symptoms:**
- Error during outbound sync
- Dev Box has CopilotACP but rsync not installed

**Solution:**

On Dev Box (PowerShell as Administrator):
```powershell
# Option 1: Install from WinGet
winget install rsync

# Option 2: Install from Chocolatey
choco install rsync

# Option 3: Download pre-built binary
# From https://github.com/cwilson/rsync-builds
# Extract to C:\Program Files\rsync\bin
# Add to PATH

# Verify installation
rsync --version
```

Tangent checks during provisioning and prompts user to install if missing.

---

### SSH Key Permissions Issues

**Problem:** Sync fails with "Permission denied (publickey)"

**Symptoms:**
- SSH works from command line but sync fails
- Dev Box SSH key has wrong permissions

**Solution:**

On Dev Box, fix `authorized_keys` permissions:
```powershell
icacls "$env:USERPROFILE\.ssh\authorized_keys" /reset /T
icacls "$env:USERPROFILE\.ssh\authorized_keys" /grant "$env:USERNAME`:F" /inheritance:r
```

On local machine, verify private key permissions:
```powershell
# Should be readable only by you
ls -la ~/.ssh/tangent_key

# If wrong, fix it:
icacls "$env:USERPROFILE\.ssh\tangent_key" /reset /T
icacls "$env:USERPROFILE\.ssh\tangent_key" /grant "$env:USERNAME`:F" /inheritance:r
```

See `docs/devbox-setup.md#ssh-authentication-failures` for full troubleshooting.

---

### File Permission Errors on Dev Box

**Problem:** Sync fails with "Permission denied" on Dev Box files

**Symptoms:**
- Outbound sync works but some files can't be written
- User running rsync doesn't own Dev Box workspace directory

**Solution:**

On Dev Box, ensure workspace directory is owned by SSH user:
```powershell
# Get current user
whoami

# Fix ownership (replace 'charris' with actual user)
icacls "C:\workspace" /grant "charris:(F)" /T /C

# Verify
icacls "C:\workspace"
```

---

### Sync Conflicts Keep Happening

**Problem:** Every agent run triggers conflicts

**Symptoms:**
- Sync conflict dialog appears for same files repeatedly
- Local modifications aren't being detected properly
- Conflict cache is stale

**Solution:**

1. **Avoid editing local files during agent execution** — this is the root cause
2. **Clear sync cache** to force fresh hash calculation:
   ```powershell
   rm -Force ~/.tangent-2/sync-cache.json
   ```
3. **Increase conflict detection threshold** in settings (if available):
   - Only detect conflicts for files > 1KB (ignores minute changes)
4. **Add frequently-changing files to exclusions**:
   ```json
   {
     "excludePatterns": [
       "temp.txt",
       "cache.json",
       "build/**"
     ]
   }
   ```

---

### Partial Sync Failures

**Problem:** Sync starts but fails midway, leaving partial state

**Symptoms:**
- Some files synced, others not
- Error message shows rsync crashed
- Network timeout during large transfer

**Solution:**

1. **Check network stability:**
   ```powershell
   ping -c 10 dev-box-ip
   # Look for packet loss
   ```

2. **Increase rsync timeout:**
   Edit `src/main/devbox/RsyncManager.ts`:
   ```typescript
   const RSYNC_TIMEOUT = 300 // seconds (increase from default 60)
   ```

3. **Retry sync manually:**
   ```powershell
   # From Tangent UI, click "Retry Sync" button
   # Or use rsync directly for debugging:
   rsync -avz --stats --progress \
     /local/path/ \
     ssh-user@dev-box:/remote/path/
   ```

4. **Check Dev Box disk space:**
   ```powershell
   ssh user@dev-box "dir C:\ | tail"
   # If low on space, increase Dev Box size in Azure portal
   ```

---

## Performance Considerations

### Initial Sync

First sync (on connect) transfers all workspace files:
- **Large projects** (>1GB) may take 1–5 minutes
- **Network latency** matters: SSH over WAN is slower than LAN
- **Excluded patterns** reduce initial sync size by 60–80% (node_modules, dist, etc.)

### Incremental Sync

After agent runs, only changed files transfer:
- **Typical agent turn** syncs 5–50 files, ~1–10 MB, <10 seconds
- **Large artifact generation** (e.g., compiled binaries) may transfer 100+ MB
- **rsync checksums** skip unchanged files even if timestamps differ

### Optimization Tips

1. **Exclude build artifacts:**
   ```json
   {
     "excludePatterns": [
       "dist",
       "build",
       "out",
       "*.whl",
       "*.egg-info"
     ]
   }
   ```

2. **Use .gitignore as template:**
   - Most projects already list files to exclude
   - Copy patterns to sync-config.json

3. **Split large workspaces:**
   - If project >5GB, configure agent to sync only subdirectory:
   ```json
   {
     "remote": {
       "repoPath": "packages/api"  // Sync only API package
     }
   }
   ```

4. **Monitor sync logs:**
   - Click sync icon in status bar to see transferred bytes
   - Identify unexpectedly large transfers and add to exclusions

---

## Architecture Diagram

```
User launches remote agent
    ↓
[RsyncManager.syncOutbound()]
    - Read local workspace
    - Apply exclusion patterns
    - Connect via SSH
    - Transfer changed files to Dev Box
    - Emit sync:complete
    ↓
[AcpClient.newSession()]
    - Create ACP session with synced workspace context
    - Agent starts executing
    ↓
Agent runs, modifies files on Dev Box
    ↓
Agent emits agentStop event
    ↓
[RsyncManager.syncInbound()]
    - Connect via SSH
    - Detect local uncommitted changes
    - If conflicts:
      → Emit sync:conflict
      → UI waits for user resolution
    - If no conflicts:
      → Transfer changed files from Dev Box
      → Update sync cache
      → Emit sync:complete
    ↓
[SessionManager] Agent turn complete
    ↓
Ready for next user input
```

---

## See Also

- **Dev Box Setup**: `docs/devbox-setup.md` — SSH keys, MCP config, provisioning flow
- **ACP Integration**: `docs/architecture/acp-integration.md` — ACP protocol, session lifecycle, permission handling
- **Source Code**:
  - `src/main/devbox/RsyncManager.ts` — Sync implementation
  - `src/main/devbox/RemoteSessionManager.ts` — Session orchestration
  - `src/shared/devbox-types.ts` — Type definitions
