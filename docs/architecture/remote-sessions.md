# Remote Session Architecture

This document describes how Tangent manages remote agent execution on Dev Boxes, orchestrating the full lifecycle from connection through workspace sync to ACP session management.

---

## Overview

**Problem:**
Users want to offload CPU-intensive agent tasks to cloud compute while maintaining local control and workspace consistency. Running agents on local machines can be slow for large codebases; cloud Dev Boxes offer faster execution but introduce complexity: connection management, workspace synchronization, and recovery from network failures.

**Solution:**
Tangent implements a **local-as-primary** remote session architecture. Local is always the source of truth for workspace files. Remote Dev Boxes are ephemeral compute targets. Sessions use explicit state transitions and sync boundaries to keep local and remote in sync, with automatic failover support.

**Benefits:**
- **Resilience** — If Dev Box crashes, workspace is safe on local (always current)
- **Failover** — Switch Dev Boxes and resume from last synced state
- **Conflict-free** — Sync only happens at explicit boundaries, preventing race conditions
- **User Control** — Local UI bridges permissions and decisions back to the user
- **Transparency** — Remote state machine is visible; users know what's happening at each step

---

## Agent Profile Config

Remote session execution is configured per agent in the agent profile's `remote` section.

### Configuration Structure

```typescript
interface AgentProfile {
  id: string
  name: string
  command: string
  args: string[]
  // ... other fields ...
  
  // Remote execution configuration (opt-in per agent)
  remote?: {
    enabled: boolean                // Global opt-in for this agent
    devBoxProject?: string          // Azure Dev Center project name
    devBoxName?: string             // Specific Dev Box within project
    repoPath?: string               // Remote workspace path (default: /home/workspace)
    sshUser?: string                // SSH user (default: current Windows user)
  }
}
```

### Configuration Fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `remote.enabled` | Yes | `boolean` | Opt-in flag; if false, agent runs locally (no remote fallback) |
| `devBoxProject` | Yes (if remote.enabled) | `string` | Azure Dev Center project containing the Dev Box |
| `devBoxName` | Yes (if remote.enabled) | `string` | Specific Dev Box name to connect to |
| `repoPath` | No | `string` | Remote workspace root (default: `/home/workspace` on Linux Dev Boxes) |
| `sshUser` | No | `string` | SSH username (default: current Windows user account name) |

### Example: Copilot CLI via Remote

```json
{
  "id": "copilot-remote",
  "name": "Copilot (Remote)",
  "command": "copilot",
  "args": [],
  "cwdMode": "activeSession",
  "launchTarget": "newTab",
  "remote": {
    "enabled": true,
    "devBoxProject": "engineering",
    "devBoxName": "charrisdb5",
    "repoPath": "/home/charris/projects/tangent",
    "sshUser": "charris"
  }
}
```

When user launches this agent, Tangent will:
1. Start Dev Box `charrisdb5` in project `engineering`
2. Connect via SSH (user: `charris`)
3. Sync local workspace to `/home/charris/projects/tangent` on Dev Box
4. Create ACP session with that workspace context
5. Run Copilot CLI on remote with full visibility to local UI

---

## Connection Flow

Complete sequence from SSH tunnel establishment to active ACP session.

### High-Level Flow

```
User selects remote agent and clicks "Launch"
    ↓
[RemoteSessionManager.createRemoteSession()]
    - Record remote config (Dev Box name, project, path)
    - Add session to SessionStore with kind='remote-agent'
    ↓
[DevBoxConnector.connect()]
    Step 1: Auto-start Dev Box
      → Call Azure Dev Center API to power on Dev Box
      → Wait for provisioning state → Running
      → Get IP address and connection info
    
    Step 2: Ensure SSH is provisioned
      → Connect to Dev Box (via SSH client library)
      → Run OpenSshProvisioner.ensureOpenSsh()
      → Verify OpenSSH service is running
    
    Step 3: Establish SSH tunnel
      → Call SshTunnelManager.createTunnel()
      → Map local port ← SSH ← Dev Box port 22 (for rsync, ACP)
      → Verify tunnel is responsive
    
    Step 4: Return connection ready
      → Update connection state to 'ready'
      → Emit 'connection:ready' event
    ↓
[RemoteSessionManager] receives 'connection:ready'
    ↓
[DevBoxProvisioner.isProvisioned()]
    - Check if CopilotACP scheduled task exists on Dev Box
    - If missing, provision it (register and start)
    - Verify task is responsive
    ↓
[RemoteSessionManager.devBoxConnector.syncWorkspaceOut()]
    - Call RsyncManager.syncOutbound()
    - Transfer local workspace → Dev Box via SSH tunnel
    - Update session state to 'syncing-out'
    ↓
[RemoteSessionManager] establishes ACP connection
    - State: 'tunneling'
    - SSH tunnel already established, reuse for ACP
    ↓
[AcpClient.connectWithStream()]
    - Create stream over SSH tunnel
    - Establish ClientSideConnection with Tangent's Client handler
    - Handshake completes, emits 'acp:connected'
    ↓
State: 'verifying-acp'
    - Test ACP responsiveness (verify protocol version, etc.)
    ↓
[AcpClient.newSession()]
    - Create ACP session with workspace context
    - Config includes: cwd, env, MCP servers
    - Store ACP session ID in Tangent session
    ↓
Session state: 'running'
    - SessionStore marked 'agent_ready'
    - UI shows session as ready for input
    - User can now send prompts
    ↓
User sends prompt
    ↓
[RemoteSessionManager.sendPrompt(sessionId, text)]
    - Route to AcpClient
    - AcpClient sends via JSON-RPC over SSH tunnel
    - Agent runs on Dev Box, modifies files
    ↓
Agent emits 'agentStop' event (after tool calls complete)
    ↓
[SyncListener] hooks this event
    - Trigger RsyncManager.syncInbound()
    - Pull changed files back to local
    - Detect conflicts (local changed during agent run)
    ↓
Session ready for next prompt
```

### Connection State Machine

```
idle
  ↓ (connect called)
starting-devbox
  ↓ (Dev Box powered on)
ensuring-ssh
  ↓ (OpenSSH verified)
tunneling
  ↓ (SSH tunnel established)
verifying
  ↓ (Tunnel tested)
ready ← Connection is operational
  ↓ (disconnect called or error)
disconnected / failed
```

---

## Session Lifecycle

Complete state progression for a remote agent session from creation through completion.

### Session States

Remote sessions progress through these states:

| State | Phase | Meaning |
|-------|-------|---------|
| `starting-devbox` | Setup | Dev Box is starting up; waiting for 'Running' state |
| `syncing-out` | Setup | Workspace being uploaded to Dev Box |
| `tunneling` | Setup | SSH tunnel being established for ACP |
| `verifying-acp` | Setup | Testing ACP connection readiness |
| `running` | Execution | Session ready; agent can receive prompts |
| `syncing-back` | Teardown | Workspace being downloaded from Dev Box after agent stops |

### State Transitions (All Valid Paths)

```
starting-devbox → syncing-out
syncing-out → tunneling
tunneling → verifying-acp
verifying-acp → running
running → syncing-back (after agentStop)
syncing-back → idle (session closed)

Error recovery:
Any state → starting-devbox (on reconnection)
Any state → syncing-back (on session end)
```

### Detailed Lifecycle

#### Phase 1: Connection & Setup

```
[Create]
  → SessionStore.add() with kind='remote-agent'
  → remoteState = 'starting-devbox'
  → UI shows "Connecting to Dev Box..."

[Power On Dev Box]
  → DevBoxConnector calls Azure API
  → Watches provisioning state: Creating → Starting → Running
  → Extracts IP address from Azure

[Verify SSH]
  → SshTunnelManager creates temp connection
  → Runs OpenSshProvisioner.ensureOpenSsh()
  → OpenSSH service started and auto-enabled

[Establish Tunnel]
  → SSH tunnel: local:7777 ← remotehost:22
  → Test tunnel responsiveness (Test-NetConnection)
  → Emit 'connection:ready'

[Provision ACP]
  → DevBoxProvisioner checks if CopilotACP task registered
  → If missing:
    - Register scheduled task: copilot --acp --port 3000
    - Start task
    - Wait for startup
  → Verify ACP responds (JSON-RPC ping)

[Sync Outbound]
  → remoteState = 'syncing-out'
  → RsyncManager connects via SSH tunnel
  → Transfers: /local/workspace → /remote/workspace
  → Apply exclusion patterns (node_modules, .git, etc.)
  → Update sync cache with hashes
  → Emit 'sync:complete' event
  → UI shows "Ready"

[Create ACP Session]
  → remoteState = 'verifying-acp'
  → AcpClient.newSession(config)
  → Config: cwd=/remote/workspace, env={...}, mcpServers={...}
  → Store ACP session ID in Tangent session
  → Emit 'acp:session-created'

[Ready to Run]
  → remoteState = 'running'
  → session.status = 'agent_ready'
  → UI enables input, shows status 'running'
  → User can send prompts
```

#### Phase 2: Agent Execution

```
[User sends prompt]
  → session.status = 'processing'
  → RemoteSessionManager.sendPrompt(sessionId, text)
  → AcpClient forwards to Dev Box via JSON-RPC over SSH

[Agent runs on Dev Box]
  → Copilot CLI running on Dev Box
  → Has access to synced workspace
  → Modifies files, calls tools
  → All within /remote/workspace
  → MCP servers configured for remote environment

[Permissions if needed]
  → ACP sends permission callback to local UI
  → RemoteSessionManager relays via IPC
  → UI shows permission dialog
  → User approves/denies
  → Result sent back to agent

[Tool execution]
  → session.status = 'tool_executing'
  → Tools run on Dev Box
  → File changes accumulate

[Agent completes turn]
  → Copilot CLI emits 'agentStop' event
  → SyncListener in RemoteSessionManager receives hook
  → → Continue to Phase 3
```

#### Phase 3: Sync & Cleanup

```
[On agentStop]
  → remoteState = 'syncing-back'
  → session.status = 'processing'
  → UI shows "Syncing results..."

[Detect conflicts]
  → RsyncManager reads changed files from Dev Box
  → Compare to sync cache from outbound sync
  → If file modified locally AND remotely:
    → Add to conflicts list
    → Emit 'sync:conflict' event

[Conflict resolution]
  If conflicts:
    → UI shows dialog:
      "Sync Conflict — N files were modified both locally and remotely"
      [Keep Local] [Use Remote] [Merge...]
    → User selects resolution
    → Apply user's choice
  Else:
    → Proceed to sync

[Sync inbound]
  → RsyncManager pulls /remote/workspace → /local/workspace
  → Apply exclusion patterns
  → Update sync cache with new hashes
  → Emit 'sync:complete' event
  → UI shows "Synced"

[Session ready for next prompt]
  → remoteState = 'running'
  → session.status = 'agent_ready'
  → User can send next prompt
  → OR close session → Phase 4

[On session close]
  → remoteState = 'syncing-back' (if not already)
  → Final full inbound sync (forced, no conflict detection)
  → Close ACP session
  → Disconnect from Dev Box
  → Optionally stop Dev Box (if autoStop enabled)
  → SessionStore.remove(sessionId)
  → UI removes session from panel
```

### Session Metrics During Lifecycle

RemoteSessionMetrics tracked:

```typescript
interface RemoteSessionMetrics {
  syncOutCount: number          // Number of outbound syncs
  syncInCount: number           // Number of inbound syncs
  totalBytesSynced: number      // Total bytes transferred (both directions)
  tunnelUptime: number          // Total time tunnel was connected (ms)
  reconnectionCount: number     // Number of reconnections after failure
  avgSyncDurationMs: number     // Average sync time per operation
}
```

---

## Workspace Sync

Synchronization ensures workspace consistency between local and remote, with conflict detection and resolution.

### Sync Strategy: Local-as-Primary

**Rule:** Local workspace is always the source of truth. Dev Box is ephemeral compute.

| Scenario | Owner | Action |
|----------|-------|--------|
| User modifies file locally | Local | Changes persist; synced to Dev Box on next connection |
| Agent modifies file on Dev Box | Remote | Changes synced back after agent stops |
| Both modified between syncs | Conflict | UI presents resolution: keep-local / use-remote / merge |
| File is in exclusion list | N/A | Never synced; excluded permanently |

### Outbound Sync (Local → Dev Box)

**Trigger:** Before agent starts

**Flow:**
```
RemoteSessionManager receives 'connection:ready'
    ↓
RsyncManager.syncOutbound(
  localPath: '/local/workspace',
  remotePath: '/remote/workspace',
  sshConnection: tunnel
)
    ↓
[Snapshot local]
  - Scan local workspace
  - Hash all files (excluding patterns)
  - Store in ~/.tangent-2/sync-cache.json

[rsync command]
  $ rsync -avz --exclude='node_modules' --exclude='.git' ... \
      /local/workspace/ \
      ssh-user@localhost:7777:/remote/workspace/
  
[Events]
  emit('sync:started', { direction: 'out', ... })
  emit('sync:progress', { filesSynced: 42, bytesTransferred: 1024000, ... })
  emit('sync:complete', { direction: 'out', result: {...} })
```

**Exclusion Patterns (Default):**
```
node_modules
.git
.env
*.log
.DS_Store
Thumbs.db
dist
build
out
.vscode
.idea
```

### Inbound Sync (Dev Box → Local)

**Trigger:** After agent completes (agentStop hook)

**Flow:**
```
SyncListener receives 'agentStop' event
    ↓
RemoteSessionManager._updateState(handle, 'syncing-back')
    ↓
RsyncManager.syncInbound(
  remotePath: '/remote/workspace',
  localPath: '/local/workspace',
  sshHost: 'localhost',
  sshUser: 'charris'
)
    ↓
[Detect conflicts]
  for each file changed on Dev Box:
    if (fileHash ≠ syncCacheHash) AND (localFileHash ≠ syncCacheHash):
      → CONFLICT: both local and remote were modified
      → Add to conflicts[]
  
  if (conflicts.length > 0):
    emit('sync:conflict', { files: conflicts[], ... })
    → UI shows dialog
    → Wait for user resolution
    → If 'Keep Local':
      → Revert remote changes locally
    → If 'Use Remote':
      → Proceed with rsync (overwrite local)
    → If 'Merge':
      → Open diff tool, user manually resolves

[rsync command (no conflicts)]
  $ rsync -avz --exclude=... \
      ssh-user@localhost:7777:/remote/workspace/ \
      /local/workspace/

[Update sync cache]
  - Recompute hashes for all synced files
  - Store new hashes in sync-cache.json

[Emit events]
  emit('sync:complete', { direction: 'in', result: {...} })

[Ready for next prompt]
  remoteState = 'running'
  status = 'agent_ready'
```

### Conflict Detection & Resolution

#### How Conflicts Are Detected

Before inbound sync, RsyncManager compares file hashes:

```typescript
function detectConflicts(remoteChanges: string[]): ConflictingFile[] {
  const conflicts = []
  const syncCache = loadSyncCache() // Hashes from last outbound sync
  const localFs = fs.readdirSync(localPath)
  
  for (const remoteFile of remoteChanges) {
    const localPath = join(workspacePath, remoteFile)
    const remoteHash = hashFromDevBox(remoteFile)
    const syncedHash = syncCache[remoteFile]
    const localHash = fs.existsSync(localPath) ? hashFile(localPath) : null
    
    // Conflict: BOTH local AND remote changed since last sync
    if (localHash !== syncedHash && remoteHash !== syncedHash) {
      conflicts.push({
        path: remoteFile,
        localModified: true,
        remoteModified: true
      })
    }
  }
  
  return conflicts
}
```

#### Resolution Options

When conflicts detected:

```
╔════════════════════════════════════════╗
║   Sync Conflict — 2 files modified     ║
║                                        ║
║  src/app.ts (modified locally)         ║
║  src/utils.ts (modified locally)       ║
║                                        ║
║  Remote also changed these files.      ║
║  How to resolve?                       ║
║                                        ║
║  [Keep Local] [Use Remote] [Merge...]  ║
╚════════════════════════════════════════╝
```

**Keep Local:**
```typescript
// Apply remote sync, then restore local versions
await rsync(remote → local)
for (const file of conflicts) {
  const cached = loadFromSyncCache(file)
  writeFile(join(localPath, file), cached)
}
// Result: local versions win, remote changes discarded
```

**Use Remote:**
```typescript
// Standard rsync with --delete flag
await rsync(remote → local, --delete)
// Result: remote versions overwrite local, conflicts resolved to remote
```

**Merge:**
```typescript
// Open diff tool for manual resolution
for (const file of conflicts) {
  execSync(`code --diff ${remoteCache}/${file} ${localPath}/${file}`)
}
// User edits local file, saves
// Sync continues normally
```

---

## Failover & Recovery

Handling connection failures and enabling session recovery.

### Connection Failure Detection

DevBoxConnector monitors SSH tunnel health:

```typescript
// If tunnel drops or becomes unresponsive:
connection:failed event emitted
    ↓
RemoteSessionManager._handleConnectionFailure(connectionId)
```

### Automatic Reconnection

When connection fails:

```
[Connection lost]
  session.remoteState remains at last known state
  session.status = 'needs_input'
  UI shows "Connection lost — reconnecting..."
  
[Reconnection attempt]
  Start timer (first retry: 3s, then exponential backoff)
  
  for attempt in 1..MAX_RECONNECTION_ATTEMPTS:
    try:
      DevBoxConnector.connect() again
      If success:
        → Reset reconnection counter
        → Sync workspace outbound again
        → Re-establish ACP session
        → Resume from last known ACP session ID
        → Return to remoteState='running'
        → Emit 'remote:reconnected' event
    
    catch error:
      → Increment attempt counter
      → Calculate backoff delay
      → If too many attempts:
        → Mark session as 'failed'
        → Show user: "Reconnection failed: [error]"
        → Offer options:
          [Retry Now] [Switch Dev Box] [Continue Locally] [Close]
```

### Switch Dev Box Flow

If current Dev Box is unreliable, user can switch to a different one:

```
[User clicks "Switch Dev Box"]
  → UI shows list of available Dev Boxes in configured project
  ↓
[User selects new Dev Box]
  → Close ACP session on old Dev Box
  → Sync workspace back from old Dev Box (final inbound)
  → Disconnect from old Dev Box
  → Create new remote session on new Dev Box
  → Sync workspace outbound to new Dev Box
  → Create new ACP session on new Dev Box
  → Update remoteConnectionId, acpSessionId
  → Emit 'remote:switched' event
  ↓
[Resume]
  → New session has same workspace state as old
  → Resume from last checkpoint if agent supports it
```

### Continue Locally

If all remote attempts fail, user can fall back to local execution:

```
[User clicks "Continue Locally"]
  → Close remote session
  → Check if Copilot CLI available locally
  → If yes:
    → Create local PTY session
    → Launch Copilot CLI on local machine
    → Sync workspace from Dev Box to local (final inbound)
    → Session continues with local execution
  → If no:
    → Show error: "Copilot CLI not found on local"
    → Offer to install
```

---

## Session Restore

How remote sessions persist and restore when Tangent restarts.

### Persistence

Sessions are saved to disk at `~/.tangent-2/sessions.json`:

```json
{
  "sessions": [
    {
      "id": "remote-1234567890-xyz",
      "kind": "remote-agent",
      "agentType": "copilot-cli",
      "name": "Copilot (Remote)",
      "folderName": "tangent",
      "folderPath": "D:\\git\\tangent",
      "status": "agent_ready",
      "devBoxName": "charrisdb5",
      "devBoxProject": "engineering",
      "remoteState": "running",
      "acpSessionId": "acp-session-abc-123",
      "agentCommand": "copilot",
      "agentArgs": [],
      "agentEnv": {},
      "startedAt": 1618000000000,
      "updatedAt": 1618000050000
    }
  ]
}
```

**When persisted:**
- On session creation
- On session close (structural changes)
- Debounced every 1s for status/activity updates (no flush on every keystroke)

### Restore Flow

When Tangent starts:

```
[Load sessions.json]
  → Parse JSON
  → Iterate over sessions[]

[For each remote session]
  → Check remote config (devBoxName, devBoxProject)
  
  if missing remote config:
    → Log warning: "Skipping restore: missing Dev Box info"
    → Create shell session instead
  else:
    → Create in-memory session in SessionStore
    → kind: 'remote-agent'
    → remoteState: 'starting-devbox' (will reconnect)
    → status: 'needs_input'
    → Mark lastActivity: "Reconnection required — click to resume"
    → UI displays session in sessions panel with special badge
    
[User resumes restored session]
  → Click "Resume"
  → RemoteSessionManager.createRemoteSession() again
  → Follow full connection flow (same as initial create)
  → Try to reuse existing ACP session if acpSessionId stored
  → If ACP session expired: create new one
  → Resume from last known state

[Session cleanup]
  → If user force-closes during restore:
    → Remove from SessionStore
    → Update sessions.json
```

### Preserved Across Restart

These fields are restored:

| Field | Preserved | Purpose |
|-------|-----------|---------|
| `acpSessionId` | Yes | Resume ACP session if still alive; create new if expired |
| `agentCommand` | Yes | Re-launch with same command |
| `agentArgs` | Yes | Re-launch with same arguments |
| `agentEnv` | Yes | Re-launch with same environment |
| `devBoxName` | Yes | Reconnect to same Dev Box |
| `devBoxProject` | Yes | Find Dev Box in same project |
| `folderPath` | Yes | Sync workspace from same location |
| `remoteConnectionId` | No | Connection ID invalid after restart; will reconnect |
| `remoteState` | Partially | Reset to 'starting-devbox' to trigger reconnect |

---

## Metrics

What's tracked for remote sessions.

### Per-Session Metrics

```typescript
interface RemoteSessionMetrics {
  syncOutCount: number       // How many times workspace was synced to Dev Box
  syncInCount: number        // How many times workspace was synced back to local
  totalBytesSynced: number   // Total bytes transferred (both directions combined)
  tunnelUptime: number       // Total milliseconds SSH tunnel was connected
  reconnectionCount: number  // How many times connection failed and reconnected
  avgSyncDurationMs: number  // Average time per sync operation (ms)
}
```

### When Metrics Are Updated

| Event | Metric Updated |
|-------|----------------|
| Outbound sync completes | `syncOutCount++`, `totalBytesSynced += bytes`, `avgSyncDurationMs = (avg * count + duration) / (count+1)` |
| Inbound sync completes | `syncInCount++`, `totalBytesSynced += bytes`, `avgSyncDurationMs = ...` |
| SSH tunnel ready | `tunnelUptime` counter starts |
| SSH tunnel closes | `tunnelUptime` counter stops, total accumulated |
| Reconnection succeeds | `reconnectionCount++` |

### Metric Access

```typescript
// In renderer UI:
const session = useSessions()[0]
if (session.remoteMetrics) {
  console.log(`Synced ${session.remoteMetrics.syncOutCount} times out`)
  console.log(`${(session.remoteMetrics.totalBytesSynced / 1024 / 1024).toFixed(1)} MB transferred`)
  console.log(`${session.remoteMetrics.reconnectionCount} reconnections`)
}
```

---

## StatusEngine Integration

Why and how remote sessions integrate with the status detection engine.

### Problem: Terminal Parsing Doesn't Work for Remote

Local PTY sessions use SystemB (terminal output pattern matching) to detect status:

```typescript
// SystemB example:
const rules = [
  { pattern: /❯/, status: 'shell_ready' },          // Shell prompt
  { pattern: /processing/i, status: 'processing' },  // Agent output
  { pattern: /tool_use/i, status: 'tool_executing' }
]
```

**Why this fails for remote:**
- Remote agent runs on Dev Box, not in local terminal
- Terminal output doesn't flow through local PTY
- ACP uses structured JSON-RPC, not ANSI-parseable terminal text
- No reliable way to extract status from tool output

### Solution: Skip Parsing, Use Remote State

Remote sessions bypass terminal parsing entirely:

```typescript
// In StatusEngine.monitor(sessionId):
const session = sessionStore.get(sessionId)
const isRemote = session && (session.kind === 'remote-agent' || session.remoteState)

if (isRemote) {
  // Skip SystemA (file watching) — no local PTY
  // Skip SystemB (output parsing) — no terminal output to parse
  // Status comes from remoteState directly
  
  return mapRemoteStateToStatus(session.remoteState)
}
```

### Remote State to Status Mapping

```typescript
function mapRemoteStateToStatus(remoteState: RemoteSessionState): SessionStatus {
  switch (remoteState) {
    case 'starting-devbox':
    case 'syncing-out':
    case 'tunneling':
    case 'verifying-acp':
      return 'agent_launching'  // UI shows "connecting..."
    
    case 'running':
      // Check session.status for current work
      // Usually 'processing', 'tool_executing', or 'agent_ready'
      return session.status // Use IPC status updates
    
    case 'syncing-back':
      return 'processing'      // UI shows "syncing results..."
  }
}
```

### IPC Status Updates During Remote Execution

ACP sends structured events; SessionStore updates status:

```typescript
// RemoteSessionManager receives ACP message:
acpClient.on('acp:message', (response) => {
  if (response.type === 'tool_start') {
    sessionStore.updateStatus(sessionId, 'tool_executing')
  }
  if (response.type === 'tool_complete') {
    sessionStore.updateStatus(sessionId, 'processing')
  }
  if (response.type === 'agentStop') {
    // Trigger sync
    rsyncManager.syncInbound()
      .then(() => sessionStore.updateStatus(sessionId, 'agent_ready'))
  }
})
```

---

## Architecture Diagram

```mermaid
graph TD
    User["👤 User<br/>(Local Machine)"]
    UI["React UI<br/>(Renderer)"]
    LSM["LocalSessionManager"]
    RSM["RemoteSessionManager"]
    DBC["DevBoxConnector"]
    DBM["DevBoxManager<br/>(Azure API)"]
    SSH["SshTunnelManager"]
    Sync["RsyncManager<br/>(Workspace Sync)"]
    ACP["AcpClient<br/>(JSON-RPC)"]
    Store["SessionStore"]
    SE["StatusEngine"]
    IPC["IPC Bridge"]
    
    SSH_T["SSH Tunnel<br/>local:7777"]
    DB["Dev Box<br/>(Azure)"]
    ACP_SVC["CopilotACP<br/>Scheduled Task"]
    AGENT["Copilot CLI<br/>(Agent)"]
    WS["Workspace<br/>/remote/workspace"]
    
    User -->|"Launch Agent"| UI
    UI -->|"session:launch"| IPC
    IPC -->|"createRemoteSession()"| RSM
    
    RSM -->|"connect()"| DBC
    DBC -->|"autoStart()"| DBM
    DBM -->|"Azure API"| DB
    DB -->|"IP Address"| DBC
    
    DBC -->|"provision SSH"| SSH
    SSH -->|"local:7777 ↔ devbox:22"| SSH_T
    SSH_T ↔ DB
    
    RSM -->|"syncWorkspaceOut()"| Sync
    Sync -->|"rsync via SSH"| SSH_T
    SSH_T -->|"transfer files"| WS
    
    RSM -->|"ensureAcpService()"| ACP_SVC
    ACP_SVC -->|"running"| DB
    
    RSM -->|"newSession(config)"| ACP
    ACP -->|"JSON-RPC"| SSH_T
    SSH_T -->|"ACP protocol"| ACP_SVC
    ACP_SVC -->|"launch"| AGENT
    
    AGENT -->|"file changes"| WS
    
    RSM -->|"updates"| Store
    Store -->|"session state"| UI
    
    SE -->|"monitor remote state"| Store
    Store -->|"mapRemoteState"| SE
    SE -->|"UI status"| UI
    
    AGENT -->|"agentStop event"| RSM
    RSM -->|"syncInbound()"| Sync
    Sync -->|"rsync via SSH"| SSH_T
    SSH_T -->|"pull files"| WS
    WS -->|"to local"| Sync
    Sync -->|"conflicts?"| RSM
    RSM -->|"resolve"| UI
    
    User -->|"View Status"| UI
    UI -->|"query sessions"| Store
```

---

## Key Files Reference

Complete mapping of remote session implementation across codebase.

### Session Management

| File | Purpose |
|------|---------|
| `src/main/session/RemoteSessionManager.ts` | Orchestrates full remote lifecycle: connect → provision → sync → ACP → execute |
| `src/main/session/SessionStore.ts` | In-memory session store; tracks all session state including remote fields |
| `src/main/session/ContextStore.ts` | Per-session context (MCP responses, tool use tracking); scoped per session |
| `src/main/session/__tests__/remote-restore.test.ts` | Tests for session persistence and restore across app restart |

### Dev Box Connection

| File | Purpose |
|------|---------|
| `src/main/devbox/DevBoxConnector.ts` | State machine for Dev Box connection: starting → SSH → tunneling → ready |
| `src/main/devbox/DevBoxManager.ts` | Azure Dev Center API integration; auto-start/stop Dev Boxes |
| `src/main/devbox/SshTunnelManager.ts` | SSH tunnel lifecycle; local port forwarding |
| `src/main/devbox/OpenSshProvisioner.ts` | Ensures OpenSSH service on Dev Box is running |

### Provisioning & ACP

| File | Purpose |
|------|---------|
| `src/main/devbox/DevBoxProvisioner.ts` | Checks/registers CopilotACP scheduled task on Dev Box |
| `src/main/devbox/AcpClient.ts` | JSON-RPC client for ACP; session create/send/close |
| `src/main/devbox/AcpProvisioner.ts` | Ensures CopilotACP service is responsive before agent launch |

### Workspace Sync

| File | Purpose |
|------|---------|
| `src/main/devbox/RsyncManager.ts` | Bidirectional workspace sync; conflict detection and resolution |
| `src/main/devbox/SyncListener.ts` | Event hook for agentStop; triggers inbound sync |

### Status Engine (Remote Integration)

| File | Purpose |
|------|---------|
| `src/main/status/StatusEngine.ts` | Skips SystemA/SystemB for remote sessions; uses remoteState instead |
| `src/shared/statusMapping.ts` | Maps remoteState → UI status label |

### Type Definitions

| File | Purpose |
|------|---------|
| `src/shared/types.ts` | `RemoteSessionState`, `RemoteSessionMetrics`, `Session` with remote fields |
| `src/shared/devbox-types.ts` | `DevBoxConfig`, `DevBoxResource`, `DevBoxConnectionInfo` |
| `src/shared/acp-types.ts` | `AcpSessionConfig`, `AcpMessage` (JSON-RPC types) |

### Constants

| File | Purpose |
|------|---------|
| `src/shared/constants.ts` | Timeouts, paths, defaults for remote execution |

### Tests

| File | Purpose |
|------|---------|
| `src/main/session/__tests__/remote-restore.test.ts` | Restore on app restart |
| `src/main/devbox/__tests__/` | Unit tests for connector, provisioner, sync, ACP |

### IPC Handlers (Renderer ↔ Main)

| File | Purpose |
|------|---------|
| `src/main/ipc/` | IPC handlers for remote session commands: launch, send prompt, close, switch dev box |

---

## See Also

- **Workspace Sync Details** — `docs/architecture/workspace-sync.md` — Deep dive into rsync, conflict resolution, exclusion patterns
- **ACP Integration** — `docs/architecture/acp-integration.md` — ACP protocol, permission callbacks, session persistence
- **Dev Box Setup Guide** — `docs/devbox-setup.md` — SSH key generation, provisioning, first-time setup
- **Config Schema** — `docs/config-schema.md` — Agent profile structure and remote.* fields
