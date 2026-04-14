# Dev Box Setup — Dev Tunnel Architecture

Connect your local Tangent 2 to a remote Azure Dev Box using **dev tunnels** for direct ACP port forwarding. No SSH keys, no `authorized_keys`, no `sshd_config` headaches — auth is handled by your Microsoft identity.

## How It Works

```
Local Machine                          Dev Box
┌─────────────┐                     ┌─────────────────┐
│  Tangent 2   │                     │  CopilotACP     │
│             │   devtunnel relay    │  (port 3000)    │
│  :3000 ◄────┼─────────────────────┼──► :3000        │
│  :22   ◄────┼─────────────────────┼──► :22 (sshd)   │
│             │   (authenticated)    │                 │
└─────────────┘                     └─────────────────┘
```

The `devtunnel` CLI creates an authenticated relay between machines. Both sides log in with the same Microsoft (GitHub) identity — the relay handles the rest. Tangent connects to `localhost:3000` which is forwarded to the Dev Box's ACP port.

---

## Prerequisites

| Requirement | Details |
|---|---|
| Azure Dev Box access | Dev Center subscription with at least one project/pool |
| Dev Box powered on | Accessible via RDP from the Azure portal |
| `devtunnel` CLI | Installed on **both** the Dev Box and your local machine |
| Microsoft/GitHub identity | Both machines authenticated to devtunnel with the same account |
| Tangent 2 | Installed on your local machine |

---

## Part 1: Dev Box Setup (One-Time, via RDP)

### 1. RDP into the Dev Box

Download the `.rdp` file from the Azure portal and connect.

### 2. Copy the setup script

Copy `assets/devbox-setup.ps1` from this repo to the Dev Box (e.g., via OneDrive, clipboard paste, or download from your repo).

### 3. Run the setup script as Administrator

Open **PowerShell as Administrator** on the Dev Box and run:

```powershell
.\devbox-setup.ps1
```

Optionally pass a custom tunnel name:

```powershell
.\devbox-setup.ps1 -TunnelName "my-devbox-ssh"
```

> **Tunnel naming rules:** lowercase alphanumeric + hyphens, 3–60 characters, no leading/trailing hyphens. If omitted, the script auto-generates one from the computer name (e.g., `cpc-charr-d55kk-ssh`).

### What the script does

| Step | Action |
|------|--------|
| 1 | Installs OpenSSH Server and configures `sshd` for auto-start |
| 2 | Configures SSH authentication (password auth enabled, authorized_keys ready) |
| 3 | Installs the `devtunnel` CLI via `winget` (or direct download fallback) |
| 4 | Authenticates with GitHub (`devtunnel user login -g`) — a browser window opens |
| 5 | Creates a named tunnel with ports **22** (SSH) and **3000** (ACP) |
| 6 | Grants **tenant access** so same-org users can connect (`--tenant`) |
| 7 | Creates a **scheduled task** (`DevTunnel-<name>`) to auto-host the tunnel at logon |

### 4. Note the output

At the end, the script prints:

```
╔════════════════════════════════════════════════╗
║  ✓ Dev Box Setup Complete!                    ║
╚════════════════════════════════════════════════╝

  Tunnel Name : cpc-charr-d55kk-ssh
  Tunnel Host : cpc-charr-d55kk-ssh.devtunnels.ms
  SSH User    : charris
  SSH Port    : 22
```

Save the **Tunnel Name** — you'll need it on your local machine.

---

## Part 2: Local Machine Setup

### 1. Install the devtunnel CLI

```powershell
winget install Microsoft.devtunnel
```

Restart your terminal after install so `devtunnel` is in your PATH.

### 2. Log in with your Microsoft/GitHub identity

```powershell
devtunnel user login -g
```

> **Important:** Use the same account you used on the Dev Box. Both sides must share an identity for the tunnel relay to authorize the connection.

### 3. Test connectivity

```powershell
devtunnel connect <tunnel-name>
```

For example:

```powershell
devtunnel connect cpc-charr-d55kk-ssh
```

You should see output showing both ports forwarded:

```
Connected to tunnel: cpc-charr-d55kk-ssh
  Port 22  → localhost:<local-port>
  Port 3000 → localhost:<local-port>
```

Press `Ctrl+C` to disconnect after verifying.

### 4. Configure Tangent

Edit (or create) `~/.tangent/devbox-config.json`:

```json
{
  "devCenterEndpoint": "https://<your-devcenter>.devcenter.azure.com",
  "projectName": "<your-project>",
  "devBoxes": {
    "<your-devbox-name>": {
      "tunnelHost": "<tunnel-host-url-from-setup>",
      "sshUser": "<your-windows-username>"
    }
  }
}
```

**Example with real values:**

```json
{
  "devCenterEndpoint": "https://myteam-devcenter.devcenter.azure.com",
  "projectName": "copilot-dev",
  "devBoxes": {
    "charrisdb5": {
      "tunnelHost": "cpc-charr-d55kk-ssh.devtunnels.ms",
      "sshUser": "charris"
    }
  }
}
```

---

## Multiple Dev Boxes

Tangent supports spreading agent workload across several Dev Boxes. Each Dev Box runs `devbox-setup.ps1` independently and gets its own tunnel. The `devBoxes` map in your config holds all of them.

### Setup

1. **Provision each Dev Box** — RDP in and run `devbox-setup.ps1` on each one. Each gets a unique tunnel name (auto-derived from the machine name).
2. **Note each tunnel name/host** from the setup output.
3. **Add all entries** to your local `~/.tangent/devbox-config.json`.

### Example: 4 Dev Boxes

```json
{
  "devCenterEndpoint": "https://myteam-devcenter.devcenter.azure.com",
  "projectName": "copilot-dev",
  "devBoxes": {
    "charrisdb5": {
      "tunnelHost": "cpc-charr-d55kk-ssh.devtunnels.ms",
      "sshUser": "charris"
    },
    "charrisdb6": {
      "tunnelHost": "cpc-charr-a82mm-ssh.devtunnels.ms",
      "sshUser": "charris"
    },
    "charrisdb7": {
      "tunnelHost": "cpc-charr-f19nn-ssh.devtunnels.ms",
      "sshUser": "charris"
    },
    "charrisdb8": {
      "tunnelHost": "cpc-charr-k47pp-ssh.devtunnels.ms",
      "sshUser": "charris"
    }
  }
}
```

All Dev Boxes share the same `devCenterEndpoint` and `projectName`. Only the `devBoxes` entries differ.

### Per-entry config fields

| Field | Required | Description |
|-------|----------|-------------|
| `tunnelHost` | Yes | The `*.devtunnels.ms` hostname from `devbox-setup.ps1` output |
| `sshUser` | Yes | Windows username on the Dev Box |
| `tunnelId` | No | Explicit tunnel ID (overrides hostname-based lookup) |
| `sshPort` | No | Custom SSH port if not 22 |
| `sshKeyPath` | No | Path to SSH private key (if using key auth instead of tunnel) |

### Concurrent agents on one Dev Box

Multiple agents can connect to the same Dev Box simultaneously — the ACP server on port 3000 supports concurrent sessions. This means you can:

- Run 2–3 Copilot CLI agents on one Dev Box at the same time
- Use one Dev Box for heavy tasks while another handles lighter ones
- Scale up to more boxes only when you need the compute headroom

Tangent's DevBoxPicker UI lists all configured Dev Boxes and shows their current state (running, stopped, provisioning). Pick any available box when launching a remote agent.

### Verifying connectivity to all boxes

Test each tunnel independently:

```powershell
# Check each Dev Box tunnel
devtunnel connect cpc-charr-d55kk-ssh
devtunnel connect cpc-charr-a82mm-ssh
devtunnel connect cpc-charr-f19nn-ssh
devtunnel connect cpc-charr-k47pp-ssh
```

Each should show ports 22 and 3000 forwarded. Press `Ctrl+C` between each test.

### Teardown a single Dev Box

To remove one Dev Box from your fleet without affecting the others:

1. **On that Dev Box:** run `.\devbox-teardown.ps1`
2. **In your config:** remove its entry from the `devBoxes` map

The remaining Dev Boxes continue working unchanged.

---

## Teardown (Starting Fresh)

If you need to wipe the tunnel config and start over:

**On the Dev Box** (PowerShell as Administrator):

```powershell
.\devbox-teardown.ps1
```

This removes the scheduled task and deletes the tunnel. Then re-run setup:

```powershell
.\devbox-setup.ps1
```

To tear down a specific named tunnel:

```powershell
.\devbox-teardown.ps1 -TunnelName "my-devbox-ssh"
```

---

## Troubleshooting

### "Connection to client tunnel relay closed"

**Cause:** The tunnel host process is not running on the Dev Box.

**Fix:**
1. RDP into the Dev Box
2. Check the scheduled task:
   ```powershell
   Get-ScheduledTask -TaskName "DevTunnel-*" | Select-Object TaskName, State
   ```
3. If stopped, start it:
   ```powershell
   Start-ScheduledTask -TaskName "DevTunnel-<tunnel-name>"
   ```
4. Or manually host the tunnel:
   ```powershell
   devtunnel host <tunnel-name>
   ```

---

### "devtunnel: command not found" / "not recognized"

**Cause:** CLI not installed or not in PATH.

**Fix:**
```powershell
winget install Microsoft.devtunnel
```

Restart your terminal. If still not found, check:
```powershell
Get-Command devtunnel -ErrorAction SilentlyContinue
```

---

### "Unauthorized" / "Access denied" when connecting

**Cause:** The local machine and Dev Box are using different identities.

**Fix:**
1. Check who you're logged in as on both machines:
   ```powershell
   devtunnel user show
   ```
2. Both must show the same GitHub account. Re-login if needed:
   ```powershell
   devtunnel user logout
   devtunnel user login -g
   ```

---

### Port 3000 not showing in `devtunnel connect` output

**Cause:** The ACP port wasn't added to the tunnel.

**Fix** (on the Dev Box):
```powershell
devtunnel port create <tunnel-name> -p 3000
```

Verify:
```powershell
devtunnel show <tunnel-name>
```

---

### Tunnel name rejected by devtunnel

**Rules:**
- Lowercase only (`a-z`, `0-9`, hyphens)
- 3–60 characters
- No leading or trailing hyphens

The setup script auto-corrects invalid names, but if creating manually:
```powershell
# Good
devtunnel create my-devbox-ssh

# Bad — uppercase, underscores
devtunnel create My_DevBox    # will fail
```

---

### OpenSSH installation fails on Dev Box

```powershell
# Check Windows version (must be 1803+ / Server 2019+)
winver

# Check capability status
Get-WindowsCapability -Online | Where-Object Name -like 'OpenSSH.Server*'

# Manual install if capability source unavailable
Add-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0'
```

If capability install fails, download OpenSSH from [Win32-OpenSSH releases](https://github.com/PowerShell/Win32-OpenSSH/releases) and install manually.

---

## Reference

| Resource | Link |
|----------|------|
| Azure Dev Box docs | https://learn.microsoft.com/en-us/azure/dev-box/ |
| Dev Tunnels docs | https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/ |
| devtunnel CLI reference | https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/cli-commands |
| Copilot CLI docs | https://docs.github.com/en/copilot/cli/quickstart |
| ACP protocol details | `docs/architecture/acp-integration.md` |
