# Dev Box Setup and Configuration

This guide walks through setting up a Dev Box for remote agent execution with Tangent, including SSH access, MCP server configuration, and first-time provisioning.

---

## Prerequisites

Before you begin, ensure you have:

1. **Azure Dev Box Subscription** — Access to Azure Dev Center with at least one Dev Box project and pool
2. **Dev Box Running** — Your target Dev Box is in the Azure portal and powered on
3. **Tangent Installed** — Tangent v2.0+ running on your local machine
4. **SSH Client** — OpenSSH or compatible SSH tools (built into Windows 10+, macOS, Linux)

---

## Step 1: Generate SSH Key Pair

Tangent uses SSH public-key authentication to connect to Dev Boxes securely. Generate a new SSH key pair on your local machine.

### Windows PowerShell

```powershell
# Generate RSA key pair (recommended for compatibility)
ssh-keygen -t rsa -b 4096 -f "$env:USERPROFILE\.ssh\tangent_key" -N ""
```

This creates two files:
- `~/.ssh/tangent_key` — Private key (keep secure, never share)
- `~/.ssh/tangent_key.pub` — Public key (add to Dev Box)

### macOS / Linux

```bash
ssh-keygen -t rsa -b 4096 -f ~/.ssh/tangent_key -N ""
```

**Output:**
```
Generating public/private rsa key pair.
Your identification has been saved in ~/.ssh/tangent_key.
Your public key has been saved in ~/.ssh/tangent_key.pub.
...
```

---

## Step 2: Add Public Key to Dev Box

Your public key must be added to the Dev Box's authorized SSH keys before Tangent can connect.

### Option A: Azure Portal (Recommended for First-Time Setup)

1. Navigate to your Dev Box in the **Azure portal**
2. In the left sidebar, select **Connect**
3. Choose **Download RDP** or **Connect via SSH**
4. If prompted for SSH setup:
   - Follow the portal's guided setup to add your public key
   - Azure handles the OpenSSH service configuration automatically

### Option B: Manual Setup via RDP

If your Dev Box doesn't auto-detect SSH:

1. **Connect via RDP** to your Dev Box (download .rdp file from Azure portal)
2. **Open PowerShell as Administrator** on the Dev Box
3. **Add your public key:**
   ```powershell
   # Create .ssh directory
   mkdir -Force "$env:USERPROFILE\.ssh"
   
   # Paste your public key into authorized_keys
   # From your LOCAL machine, copy the output of:
   #   cat ~/.ssh/tangent_key.pub
   # Then paste it into:
   #   "$env:USERPROFILE\.ssh\authorized_keys"
   
   # Example (replace with YOUR public key):
   Add-Content -Path "$env:USERPROFILE\.ssh\authorized_keys" `
     -Value "ssh-rsa AAAA..." -Encoding UTF8NoBOM
   ```

4. **Verify OpenSSH Server is running:**
   ```powershell
   # Check if OpenSSH Server is installed
   Get-WindowsCapability -Online | Where-Object Name -like 'OpenSSH.Server*'
   
   # If not installed, install it:
   Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
   
   # Start the service
   Start-Service sshd
   
   # Enable auto-start on boot
   Set-Service -Name sshd -StartupType Automatic
   ```

### Option C: Tangent Auto-Provisioning (First-Time Only)

When you connect to a new Dev Box from Tangent for the first time:

1. Tangent detects missing SSH setup
2. Shows a **Provisioning Consent Dialog** listing changes:
   - Install/enable OpenSSH Server
   - Configure SSH authorized keys
   - Install CopilotACP scheduled task
3. Click **Approve** to auto-provision
4. Tangent connects via your existing SSH key

---

## Step 3: Verify SSH Connection

Before launching agents, test your SSH connection from your local machine:

### Windows PowerShell

```powershell
# Get your Dev Box IP from Azure portal, then:
ssh -i "$env:USERPROFILE\.ssh\tangent_key" -v user@dev-box-ip

# Example:
ssh -i "$env:USERPROFILE\.ssh\tangent_key" -v charris@203.0.113.45
```

### macOS / Linux

```bash
ssh -i ~/.ssh/tangent_key -v user@dev-box-ip

# Example:
ssh -i ~/.ssh/tangent_key -v charris@203.0.113.45
```

**Expected output (last line):**
```
Authenticated with the server.
Pty allocation request accepted.
$
```

If you see an authentication error:
- Verify the public key is in `~/.ssh/authorized_keys` on the Dev Box
- Check file permissions: `authorized_keys` should be `600` (`rw-------)`)
- See **Troubleshooting** section below

---

## Step 4: Configure MCP Server (Optional but Recommended)

Tangent exposes an MCP server that lets agents manage your configuration and launch workflows. Set it up once after installation.

### Copilot CLI

From your Tangent project directory:

```powershell
.\scripts\install-mcp.ps1
```

This automatically adds Tangent to `~/.github/copilot/copilot-mcp.json`.

**Manual setup:**
Edit `~/.github/copilot/copilot-mcp.json`:
```json
{
  "mcpServers": {
    "tangent": {
      "command": "node",
      "args": ["D:\\git\\tangent\\release-2\\scripts\\tangent-mcp-server.js"]
    }
  }
}
```

Replace the path with your Tangent installation directory.

### Claude Code

Edit `~/.claude/claude_desktop_config.json` (or project-level `.mcp.json`):
```json
{
  "mcpServers": {
    "tangent": {
      "command": "node",
      "args": ["D:\\git\\tangent\\release-2\\scripts\\tangent-mcp-server.js"]
    }
  }
}
```

After editing, restart Copilot CLI or Claude Code to reload the config.

---

## Step 5: First-Time Connection Flow in Tangent

Once SSH is configured, connect to your Dev Box from Tangent's UI:

### Launch a Remote Agent

1. **Open Tangent** and create a new session
2. **Select Agent** from the agents sidebar
3. **Choose Remote Execution** option (if configured in agent profile)
4. **Select Dev Box** from dropdown
5. Click **Launch Remote**

### First-Time Provisioning

If this is your first connection to this Dev Box:

1. **Tangent shows Provisioning Consent Dialog:**
   ```
   Tangent will make the following changes:
   ☐ Install OpenSSH Server (if not already installed)
   ☐ Configure SSH authorized keys
   ☐ Create CopilotACP scheduled task
   ☐ Configure Copilot CLI session sync (account level)
   ☐ Register agentStop hook for workspace sync
   
   [Cancel] [Approve]
   ```

2. Click **Approve** to proceed
3. Tangent:
   - Connects via SSH
   - Installs/enables OpenSSH
   - Installs CopilotACP scheduled task
   - Starts the ACP server
   - Tests connectivity
4. Once verified, displays **Connected** status

### Session Status Flow

Watch the session status indicator in Tangent UI:
```
"starting-devbox"  → Dev Box spinning up
    ↓
"syncing-out"      → Sending workspace files to Dev Box
    ↓
"tunneling"        → SSH tunnel established
    ↓
"verifying-acp"    → Testing ACP server connection
    ↓
"running"          → Agent executing (awaiting input)
    ↓
"syncing-back"     → Pulling updated workspace back to local
    ↓
"exited"           → Agent done
```

---

## Configuration Files

After setup, Tangent creates/updates these files on your local machine:

| Path | Purpose |
|------|---------|
| `~/.ssh/tangent_key` | Private SSH key (Tangent uses this to connect) |
| `~/.ssh/tangent_key.pub` | Public key (added to Dev Box authorized_keys) |
| `~/.tangent-2/devbox-config.json` | Dev Box connection settings and auth tokens |
| `~/.tangent-2/sync-config.json` | Workspace sync exclusion patterns |
| `~/.github/copilot/copilot-mcp.json` | Copilot CLI MCP server config |

### Workspace Sync Config

After first sync, check `~/.tangent-2/sync-config.json`:

```json
{
  "excludePatterns": [
    "node_modules",
    ".git",
    ".env",
    "*.log",
    ".DS_Store",
    "dist",
    "build"
  ]
}
```

Edit to exclude additional files/folders from remote sync (e.g., large binaries, secrets).

---

## Troubleshooting

### SSH Authentication Failures

**Problem:** `Permission denied (publickey)`

**Checklist:**
1. Verify SSH key exists locally:
   ```powershell
   ls $env:USERPROFILE\.ssh\tangent_key
   ```
2. Verify public key is on Dev Box:
   ```powershell
   ssh -i "$env:USERPROFILE\.ssh\tangent_key" user@host cat ~/.ssh/authorized_keys
   ```
3. Check file permissions on Dev Box:
   ```powershell
   # Should output: -rw------- (600)
   ls -la $env:USERPROFILE\.ssh\authorized_keys
   
   # If wrong, fix it:
   icacls "$env:USERPROFILE\.ssh\authorized_keys" /reset /T
   icacls "$env:USERPROFILE\.ssh\authorized_keys" /grant "$env:USERNAME`:F" /inheritance:r
   ```
4. Verify SSH service is running on Dev Box:
   ```powershell
   Get-Service sshd | Select-Object Status
   ```

**Solution:** Follow **Step 2** again to add the correct public key.

---

### SSH Tunnel Timeout

**Problem:** `Connection refused` or `Timeout while waiting for tunnel`

**Symptoms:**
- SSH connection works from command line but Tangent says timeout
- Dev Box is running and reachable
- OpenSSH is installed and running

**Checklist:**
1. Verify Dev Box is in "Running" state in Azure portal
2. Verify your local network allows outbound SSH (port 22):
   ```powershell
   Test-NetConnection -ComputerName <dev-box-ip> -Port 22
   ```
3. Check if firewall is blocking:
   - Windows Defender Firewall should auto-allow SSH after first connection
   - If blocked, manually add inbound rule for port 22
4. Increase tunnel timeout in Tangent (if available):
   - Open Tangent settings → Dev Box → Tunnel Timeout
   - Set to 60 seconds (default 30)

**Solution:** Restart the Dev Box from Azure portal and try again.

---

### MCP Permissions Errors

**Problem:** "Permission denied" when agents try to use Tangent MCP tools

**Symptoms:**
- Agents can launch remotely but fail when calling `tangent_config_*` or `tangent_agents_*` tools
- Log shows `EPERM` or `Access Denied`

**Checklist:**
1. Verify Tangent is running on local machine:
   ```powershell
   Get-Process tangent
   ```
2. Verify MCP config has correct path:
   ```json
   {
     "command": "node",
     "args": ["D:\\git\\tangent\\release-2\\scripts\\tangent-mcp-server.js"]
   }
   ```
   - Should be absolute path to your Tangent install
   - Use forward slashes or escaped backslashes
3. Test MCP server directly:
   ```powershell
   node "$env:USERPROFILE\git\tangent\release-2\scripts\tangent-mcp-server.js"
   ```
   - Should output: `[tangent-mcp] Listening on pipe: tangent-local-server`

**Solution:** Restart Copilot CLI after verifying paths, then retry the agent.

---

### OpenSSH Installation Fails

**Problem:** Cannot install OpenSSH Server on Dev Box

**Symptoms:**
- `Add-WindowsCapability` returns error
- Dev Box is Windows Server 2016 or older

**Checklist:**
1. Verify Windows version supports OpenSSH:
   - Windows 10 (v1803+), Windows 11, Windows Server 2019+
   - Run `winver` to check version
2. Check if capability source is available:
   ```powershell
   Get-WindowsCapability -Online | Where-Object Name -like 'OpenSSH*'
   ```
3. If capability not found, try manual download:
   - Download OpenSSH from https://github.com/PowerShell/Win32-OpenSSH/releases
   - Extract to `C:\Program Files\OpenSSH\`
   - Run `.\install-sshd.ps1` from extracted folder

**Solution:** If manual install fails, contact your Azure Dev Center administrator to ensure the Dev Box image includes OpenSSH support.

---

### Sync Conflicts After Agent Execution

**Problem:** Tangent shows "Sync conflict" dialog after remote agent completes

**Symptoms:**
- Dialog lists files with uncommitted local changes
- Options: Keep Local / Use Remote / Merge
- Merge option opens diff tool

**What happened:**
- Local workspace was modified during agent execution (rare but possible)
- Dev Box also modified same files
- `agentStop` hook triggered inbound sync, detected conflict

**Resolution:**
- **Keep Local** — Discard remote changes, keep your local edits
- **Use Remote** — Apply all remote changes, lose local edits
- **Merge** — Open diff tool to manually resolve per-file

**To prevent conflicts:**
- Avoid editing local files while agent is running remotely
- Or configure exclusion patterns for frequently-edited files in `~/.tangent-2/sync-config.json`

---

## Next Steps

Once setup is complete:

1. **Configure Agent Profiles** — Edit your agent's config to enable remote execution:
   ```json
   {
     "name": "Copilot CLI",
     "remote": {
       "enabled": true,
       "devBoxProject": "my-dev-center",
       "devBoxName": "charrisdb5"
     }
   }
   ```

2. **Test Remote Execution** — Launch a simple agent on your Dev Box to verify the full flow

3. **Monitor Dev Box Health** — Check Tangent status bar for tunnel stability and sync health

4. **Review Sync Logs** — Click the sync icon in status bar to see detailed sync history and conflicts

---

## Reference

- **Azure Dev Box Docs**: https://learn.microsoft.com/en-us/azure/dev-box/
- **SSH Key Setup**: https://learn.microsoft.com/en-us/azure/virtual-machines/linux/mac-create-ssh-keys
- **Copilot CLI Docs**: https://docs.github.com/en/copilot/cli/quickstart
- **ACP Integration**: See `docs/architecture/acp-integration.md` for protocol details
