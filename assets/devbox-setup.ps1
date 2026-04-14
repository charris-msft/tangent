#Requires -RunAsAdministrator
<#
.SYNOPSIS
    One-time setup script for Tangent remote agent offloading on an Azure Dev Box.
    Run this via RDP on your Dev Box to enable SSH access through a dev tunnel.

.DESCRIPTION
    This script:
    1. Installs and enables OpenSSH Server
    2. Installs the devtunnel CLI
    3. Creates a named persistent dev tunnel with SSH port (authenticated access)
    4. Creates a scheduled task to auto-host the tunnel on logon
    5. Outputs the tunnel URL for your Tangent config

    The tunnel uses GitHub-authenticated access — connecting clients must be
    logged into devtunnel with the same GitHub account. Since Tangent is for
    Copilot users, everyone already has a GitHub account.

.NOTES
    After running, add the tunnel host to ~/.tangent/devbox-config.json on your
    local machine:
    {
      "devCenterEndpoint": "https://...",
      "projectName": "...",
      "devBoxes": {
        "charrisdb5": {
          "tunnelHost": "<tunnel-url-from-output>",
          "sshUser": "<your-windows-username>"
        }
      }
    }
#>

param(
    [string]$TunnelName = "$($env:COMPUTERNAME.ToLower() -replace '[^a-z0-9-]', '')-ssh",
    [string]$AuthorizedKey = ""
)

$ErrorActionPreference = 'Stop'
$stepNumber = 0
$totalSteps = 8

# Validate tunnel name meets devtunnel requirements: [a-z0-9][a-z0-9-]{1,58}[a-z0-9]
if ($TunnelName -cnotmatch '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$') {
    Write-Host "⚠ Tunnel name '$TunnelName' doesn't meet devtunnel requirements." -ForegroundColor Yellow
    Write-Host "  Must be lowercase alphanumeric + hyphens, 3-60 chars, no leading/trailing hyphens." -ForegroundColor Yellow
    # Auto-fix: lowercase, strip invalid chars, trim hyphens
    $TunnelName = ($TunnelName.ToLower() -replace '[^a-z0-9-]', '' -replace '^-+', '' -replace '-+$', '')
    if ($TunnelName.Length -lt 3) { $TunnelName = "devbox-ssh" }
    if ($TunnelName.Length -gt 60) { $TunnelName = $TunnelName.Substring(0, 60) -replace '-+$', '' }
    Write-Host "  Auto-corrected to: '$TunnelName'" -ForegroundColor Green
}

function Write-Banner {
    Write-Host ""
    Write-Host "╔════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║  Tangent Dev Box Setup                        ║" -ForegroundColor Cyan
    Write-Host "║  Machine: $($env:COMPUTERNAME.PadRight(37))║" -ForegroundColor Cyan
    Write-Host "║  User:    $($env:USERNAME.PadRight(37))║" -ForegroundColor Cyan
    Write-Host "║  Tunnel:  $($TunnelName.PadRight(37))║" -ForegroundColor Cyan
    Write-Host "╚════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Step {
    param([string]$Message)
    $script:stepNumber++
    Write-Host ""
    Write-Host "[$stepNumber/$totalSteps] $Message" -ForegroundColor Cyan
    Write-Host ("─" * 50) -ForegroundColor DarkGray
}

function Write-Detail {
    param([string]$Message)
    Write-Host "    $Message" -ForegroundColor Gray
}

function Write-Success {
    param([string]$Message)
    Write-Host "    ✓ $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host "    ⚠ $Message" -ForegroundColor Yellow
}

function Write-Fail {
    param([string]$Message)
    Write-Host "    ✗ $Message" -ForegroundColor Red
}

function Write-Elapsed {
    param([System.Diagnostics.Stopwatch]$Timer)
    Write-Host "    ⏱  $([math]::Round($Timer.Elapsed.TotalSeconds, 1))s" -ForegroundColor DarkGray
}

Write-Banner

# ---------------------------------------------------------------------------
# Step 1: OpenSSH Server
# ---------------------------------------------------------------------------
Write-Step "Installing OpenSSH Server"

$sw = [System.Diagnostics.Stopwatch]::StartNew()

Write-Detail "Checking current OpenSSH state..."
$sshCapability = Get-WindowsCapability -Online | Where-Object Name -like 'OpenSSH.Server*'
Write-Detail "Current state: $($sshCapability.State)"

if ($sshCapability.State -ne 'Installed') {
    Write-Detail "Installing OpenSSH Server (this takes 2-5 minutes)..."
    Write-Detail "Windows is downloading and configuring the SSH server component."
    Write-Detail "Please wait — you'll see progress below:"
    Write-Host ""
    # Show the Windows progress bar (don't suppress with Out-Null)
    Add-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0'
    Write-Host ""
    $sw.Stop()
    Write-Success "OpenSSH Server installed"
    Write-Elapsed $sw
} else {
    $sw.Stop()
    Write-Success "OpenSSH Server already installed — skipping"
    Write-Elapsed $sw
}

$sw = [System.Diagnostics.Stopwatch]::StartNew()

Write-Detail "Configuring sshd service..."
$sshService = Get-Service sshd -ErrorAction SilentlyContinue
if ($sshService) {
    if ($sshService.StartType -ne 'Automatic') {
        Write-Detail "Setting sshd startup type to Automatic..."
        Set-Service -Name sshd -StartupType Automatic
        Write-Success "sshd set to auto-start"
    } else {
        Write-Success "sshd already set to auto-start"
    }
    if ($sshService.Status -ne 'Running') {
        Write-Detail "Starting sshd service..."
        Start-Service sshd
        Write-Success "sshd started"
    } else {
        Write-Success "sshd already running"
    }
} else {
    Write-Fail "sshd service not found after install — reboot may be required"
}

Write-Detail "Checking firewall rule for port 22..."
$fwRule = Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue
if (-not $fwRule) {
    Write-Detail "Creating firewall rule to allow SSH on port 22..."
    New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server (sshd)' `
        -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null
    Write-Success "Firewall rule created for port 22"
} else {
    Write-Success "Firewall rule already exists"
}

Write-Detail "Setting default SSH shell to PowerShell..."
$regPath = 'HKLM:\SOFTWARE\OpenSSH'
if (-not (Test-Path $regPath)) {
    New-Item -Path $regPath -Force | Out-Null
}
$currentShell = Get-ItemProperty -Path $regPath -Name DefaultShell -ErrorAction SilentlyContinue
$pwshPath = (Get-Command powershell.exe).Source
if (-not $currentShell -or $currentShell.DefaultShell -ne $pwshPath) {
    New-ItemProperty -Path $regPath -Name DefaultShell -Value $pwshPath -PropertyType String -Force | Out-Null
    Write-Success "Default SSH shell set to PowerShell ($pwshPath)"
} else {
    Write-Success "Default SSH shell already set"
}

$sw.Stop()
Write-Elapsed $sw

# ---------------------------------------------------------------------------
# Step 2: SSH Authentication (password + authorized keys)
# ---------------------------------------------------------------------------
Write-Step "Configuring SSH authentication"

$sw = [System.Diagnostics.Stopwatch]::StartNew()

$sshdConfigPath = "$env:ProgramData\ssh\sshd_config"
if (Test-Path $sshdConfigPath) {
    # Enable password authentication (needed for first-time connections)
    Write-Detail "Enabling password authentication in sshd_config..."
    $config = Get-Content $sshdConfigPath -Raw
    $modified = $false

    if ($config -match '#?\s*PasswordAuthentication\s+no') {
        $config = $config -replace '#?\s*PasswordAuthentication\s+no', 'PasswordAuthentication yes'
        $modified = $true
    } elseif ($config -notmatch 'PasswordAuthentication\s+yes') {
        $config += "`nPasswordAuthentication yes`n"
        $modified = $true
    }

    if ($modified) {
        Set-Content $sshdConfigPath $config -Encoding utf8
        Restart-Service sshd
        Write-Success "Password authentication enabled and sshd restarted"
    } else {
        Write-Success "Password authentication already enabled"
    }
} else {
    Write-Warn "sshd_config not found at $sshdConfigPath — skipping"
}

# Set up authorized_keys for key-based auth
$sshDir = "$env:USERPROFILE\.ssh"
$authKeysPath = "$sshDir\authorized_keys"
$adminAuthKeysPath = "$env:ProgramData\ssh\administrators_authorized_keys"

if (-not (Test-Path $sshDir)) {
    New-Item -Path $sshDir -ItemType Directory -Force | Out-Null
    Write-Detail "Created $sshDir"
}

if ($AuthorizedKey) {
    Write-Detail "Adding provided public key to authorized_keys..."
    
    # For admin users, Windows OpenSSH uses administrators_authorized_keys
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    
    if ($isAdmin) {
        if (-not (Test-Path $adminAuthKeysPath) -or (Get-Content $adminAuthKeysPath -ErrorAction SilentlyContinue) -notcontains $AuthorizedKey) {
            Add-Content $adminAuthKeysPath $AuthorizedKey
            # Fix permissions: only Admins and SYSTEM should have access
            icacls $adminAuthKeysPath /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F" 2>&1 | Out-Null
            Write-Success "Added key to $adminAuthKeysPath"
        } else {
            Write-Success "Key already in $adminAuthKeysPath"
        }
    }
    
    # Also add to user's authorized_keys as fallback
    if (-not (Test-Path $authKeysPath) -or (Get-Content $authKeysPath -ErrorAction SilentlyContinue) -notcontains $AuthorizedKey) {
        Add-Content $authKeysPath $AuthorizedKey
        Write-Success "Added key to $authKeysPath"
    } else {
        Write-Success "Key already in $authKeysPath"
    }
} else {
    Write-Detail "No -AuthorizedKey provided. You can add keys later:"
    Write-Detail "  .\devbox-setup.ps1 -AuthorizedKey 'ssh-rsa AAAA...'"
    Write-Detail "  Or copy your public key to $authKeysPath on this machine"
    if (Test-Path $authKeysPath) {
        $keyCount = (Get-Content $authKeysPath | Where-Object { $_ -match '^ssh-' }).Count
        Write-Success "authorized_keys exists ($keyCount keys)"
    } else {
        Write-Warn "No authorized_keys file — password auth will be used"
    }
}

$sw.Stop()
Write-Elapsed $sw

# ---------------------------------------------------------------------------
# Step 3: devtunnel CLI
# ---------------------------------------------------------------------------
Write-Step "Installing devtunnel CLI"

$sw = [System.Diagnostics.Stopwatch]::StartNew()

Write-Detail "Checking if devtunnel is already installed..."
$devtunnel = Get-Command devtunnel -ErrorAction SilentlyContinue
if (-not $devtunnel) {
    Write-Detail "devtunnel not found — installing via winget..."
    try {
        Write-Detail "Running: winget install Microsoft.devtunnel"
        winget install Microsoft.devtunnel --accept-package-agreements --accept-source-agreements --silent
        Write-Detail "Refreshing PATH environment..."
        $env:PATH = [System.Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('PATH', 'User')
        $devtunnel = Get-Command devtunnel -ErrorAction SilentlyContinue
        if ($devtunnel) {
            Write-Success "devtunnel installed at: $($devtunnel.Source)"
        } else {
            Write-Warn "devtunnel installed but not found in PATH — restart your terminal after setup"
        }
    } catch {
        Write-Detail "winget failed — falling back to direct download..."
        $downloadUrl = 'https://aka.ms/TunnelsCliDownload/win-x64'
        $installPath = Join-Path $env:LOCALAPPDATA 'Microsoft\devtunnel'
        Write-Detail "Downloading from $downloadUrl..."
        New-Item -Path $installPath -ItemType Directory -Force | Out-Null
        $exePath = Join-Path $installPath 'devtunnel.exe'
        Invoke-WebRequest -Uri $downloadUrl -OutFile $exePath -UseBasicParsing
        $env:PATH += ";$installPath"
        [System.Environment]::SetEnvironmentVariable('PATH', $env:PATH + ";$installPath", 'User')
        Write-Success "devtunnel downloaded to $exePath"
    }
} else {
    Write-Success "devtunnel already installed: $($devtunnel.Source)"
}

$sw.Stop()
Write-Elapsed $sw

# ---------------------------------------------------------------------------
# Step 3: devtunnel login (GitHub — required for cross-machine auth)
# ---------------------------------------------------------------------------
Write-Step "Authenticating devtunnel (GitHub)"

$sw = [System.Diagnostics.Stopwatch]::StartNew()

Write-Detail "Checking devtunnel login status..."
$loginCheck = & devtunnel user show 2>&1
$isGitHub = $loginCheck -match 'GitHub'

if ($LASTEXITCODE -ne 0 -or $loginCheck -match 'not logged in' -or -not $isGitHub) {
    if ($loginCheck -match 'logged in' -and -not $isGitHub) {
        Write-Warn "Currently logged in with a non-GitHub identity. Switching to GitHub..."
        Write-Detail "Tangent requires GitHub auth so the tunnel works from your local machine too."
        & devtunnel user logout 2>&1 | Out-Null
    }
    Write-Detail "Logging in with GitHub (required for Copilot users)..."
    Write-Warn "A browser window will open. Sign in with your GitHub account."
    Write-Host ""
    & devtunnel user login -g
    Write-Host ""
    if ($LASTEXITCODE -eq 0) {
        Write-Success "devtunnel GitHub login complete"
    } else {
        Write-Fail "devtunnel login failed — run 'devtunnel user login -g' manually"
    }
} else {
    Write-Detail "Login info:"
    $loginCheck | ForEach-Object { Write-Detail "  $_" }
    Write-Success "devtunnel already authenticated with GitHub"
}

$sw.Stop()
Write-Elapsed $sw

# ---------------------------------------------------------------------------
# Step 4: Create named tunnel
# ---------------------------------------------------------------------------
Write-Step "Creating dev tunnel '$TunnelName'"

$sw = [System.Diagnostics.Stopwatch]::StartNew()

Write-Detail "Checking if tunnel '$TunnelName' already exists..."
$existing = & devtunnel show $TunnelName 2>&1
if ($LASTEXITCODE -eq 0 -and $existing -notmatch 'not found') {
    Write-Success "Tunnel '$TunnelName' already exists"
    Write-Detail "Tunnel details:"
    $existing | ForEach-Object { Write-Detail "  $_" }
} else {
    Write-Detail "Creating new tunnel '$TunnelName'..."
    & devtunnel create $TunnelName
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Failed to create tunnel '$TunnelName'"
        throw "Failed to create tunnel '$TunnelName'"
    }
    Write-Success "Tunnel '$TunnelName' created"
}

Write-Detail "Configuring SSH port (22) on tunnel..."
$portResult = & devtunnel port create $TunnelName -p 22 2>&1
if ($portResult -match 'already exists') {
    Write-Success "Port 22 already configured on tunnel"
} else {
    Write-Success "Port 22 configured on tunnel"
}

Write-Detail "Configuring ACP port (7333) on tunnel..."
$portResult = & devtunnel port create $TunnelName -p 7333 2>&1
if ($portResult -match 'already exists') {
    Write-Success "Port 7333 already configured on tunnel"
} else {
    Write-Success "Port 7333 configured on tunnel"
}

Write-Detail "Granting tenant access for cross-machine connectivity..."
& devtunnel access create $TunnelName --tenant 2>&1 | Out-Null
Write-Success "Tenant access granted (same org users can connect)"

$sw.Stop()
Write-Elapsed $sw

# ---------------------------------------------------------------------------
# Step 5: Scheduled task for auto-hosting
# ---------------------------------------------------------------------------
Write-Step "Setting up auto-host scheduled task"

$sw = [System.Diagnostics.Stopwatch]::StartNew()

$taskName = "DevTunnel-$TunnelName"

Write-Detail "Resolving devtunnel executable path..."
$devtunnelPath = (Get-Command devtunnel -ErrorAction SilentlyContinue).Source
if (-not $devtunnelPath) {
    $devtunnelPath = 'devtunnel'
}
Write-Detail "Using: $devtunnelPath"

Write-Detail "Checking for existing scheduled task '$taskName'..."
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

if ($existingTask) {
    Write-Success "Scheduled task '$taskName' already exists (state: $($existingTask.State))"
} else {
    Write-Detail "Creating scheduled task to auto-host tunnel at logon..."
    Write-Detail "  Executable: $devtunnelPath"
    Write-Detail "  Arguments:  host $TunnelName"
    Write-Detail "  Trigger:    At logon for $env:USERNAME"
    
    $action = New-ScheduledTaskAction -Execute $devtunnelPath -Argument "host $TunnelName"
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force | Out-Null
    Write-Success "Scheduled task '$taskName' created (runs at logon)"
}

Write-Detail "Starting the tunnel now..."
Start-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Write-Detail "Waiting 5 seconds for tunnel to initialize..."
for ($i = 1; $i -le 5; $i++) {
    Start-Sleep -Seconds 1
    Write-Host "    ." -NoNewline -ForegroundColor DarkGray
}
Write-Host ""

$sw.Stop()
Write-Elapsed $sw

# ---------------------------------------------------------------------------
# Step 6: Install ACP Bridge (Copilot CLI remote agent server)
# ---------------------------------------------------------------------------
Write-Step "Setting up ACP Bridge for remote agent access"

$sw = [System.Diagnostics.Stopwatch]::StartNew()

$acpBridgeDir = Join-Path $env:USERPROFILE ".tangent"
$acpBridgePath = Join-Path $acpBridgeDir "acp-bridge.js"

if (-not (Test-Path $acpBridgeDir)) {
    New-Item -ItemType Directory -Path $acpBridgeDir -Force | Out-Null
}

# Download or copy the ACP bridge script
$bridgeUrl = "https://raw.githubusercontent.com/charris-msft/tangent/remote/assets/acp-bridge.js"
Write-Detail "Downloading ACP bridge from $bridgeUrl..."
try {
    Invoke-WebRequest -Uri $bridgeUrl -OutFile $acpBridgePath -UseBasicParsing -ErrorAction Stop
    Write-Success "ACP bridge downloaded to $acpBridgePath"
} catch {
    Write-Warn "Could not download ACP bridge. Copy assets/acp-bridge.js to $acpBridgePath manually."
}

# Install @github/copilot globally if not present
Write-Detail "Checking for @github/copilot..."
$copilotCheck = & npm list -g @github/copilot 2>&1
if ($copilotCheck -match 'empty') {
    Write-Detail "Installing @github/copilot globally..."
    & npm install -g @github/copilot 2>&1 | Out-Null
    Write-Success "@github/copilot installed globally"
} else {
    Write-Success "@github/copilot already installed"
}

# Create scheduled task for ACP bridge (auto-start at logon)
$acpTaskName = "Tangent-ACP-Bridge"
$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodePath) { $nodePath = "node" }

$existingAcpTask = Get-ScheduledTask -TaskName $acpTaskName -ErrorAction SilentlyContinue
if ($existingAcpTask) {
    Write-Success "Scheduled task '$acpTaskName' already exists (state: $($existingAcpTask.State))"
} else {
    Write-Detail "Creating scheduled task for ACP bridge (port 7333)..."
    $acpAction = New-ScheduledTaskAction -Execute $nodePath -Argument "`"$acpBridgePath`" 7333"
    $acpTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $acpSettings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $acpTaskName -Action $acpAction -Trigger $acpTrigger -Settings $acpSettings -RunLevel Highest -Force | Out-Null
    Write-Success "Scheduled task '$acpTaskName' created (runs at logon, port 7333)"
}

Write-Detail "Starting ACP bridge..."
Start-ScheduledTask -TaskName $acpTaskName -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# Verify it's listening
$acpListening = Get-NetTCPConnection -LocalPort 7333 -State Listen -ErrorAction SilentlyContinue
if ($acpListening) {
    Write-Success "ACP bridge is listening on port 7333"
} else {
    Write-Warn "ACP bridge may still be starting. Run 'node $acpBridgePath 7333' manually to test."
}

$sw.Stop()
Write-Elapsed $sw

# ---------------------------------------------------------------------------
# Step 7: Retrieve tunnel URL
# ---------------------------------------------------------------------------
Write-Step "Retrieving tunnel connection info"

$sw = [System.Diagnostics.Stopwatch]::StartNew()

Write-Detail "Querying tunnel details..."
$hostedInfo = & devtunnel show $TunnelName 2>&1
$sshHost = $null

Write-Detail "Tunnel output:"
$hostedInfo | ForEach-Object { Write-Detail "  $_" }

foreach ($line in $hostedInfo) {
    if ($line -match 'Connect via browser:\s+https://([^\s]+)') {
        $sshHost = $Matches[1]
        break
    }
    if ($line -match '([\w.-]+\.devtunnels\.ms)') {
        $sshHost = $Matches[1]
        break
    }
}

if ($sshHost) {
    Write-Success "Tunnel host resolved: $sshHost"
} else {
    Write-Warn "Could not auto-detect tunnel URL from output"
    Write-Detail "Run 'devtunnel show $TunnelName' manually to find the URL"
}

$sw.Stop()
Write-Elapsed $sw

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "╔════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║  ✓ Dev Box Setup Complete!                    ║" -ForegroundColor Green
Write-Host "╚════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  Tunnel Name : " -NoNewline -ForegroundColor Gray
Write-Host "$TunnelName" -ForegroundColor White
if ($sshHost) {
    Write-Host "  Tunnel Host : " -NoNewline -ForegroundColor Gray
    Write-Host "$sshHost" -ForegroundColor White
} else {
    Write-Host "  Tunnel Host : " -NoNewline -ForegroundColor Gray
    Write-Host "(run 'devtunnel show $TunnelName' to find URL)" -ForegroundColor Yellow
}
Write-Host "  SSH User    : " -NoNewline -ForegroundColor Gray
Write-Host "$env:USERNAME" -ForegroundColor White
Write-Host "  SSH Port    : " -NoNewline -ForegroundColor Gray
Write-Host "22" -ForegroundColor White
Write-Host ""
Write-Host "  Add this to your LOCAL machine's ~/.tangent/devbox-config.json:" -ForegroundColor Cyan
Write-Host ""

$configSnippet = @"
  {
    "devCenterEndpoint": "<your-devcenter-endpoint>",
    "projectName": "<your-project>",
    "devBoxes": {
      "$($env:COMPUTERNAME)": {
        "tunnelHost": "$(if ($sshHost) { $sshHost } else { '<tunnel-url>' })",
        "sshUser": "$($env:USERNAME)"
      }
    }
  }
"@

Write-Host $configSnippet -ForegroundColor Yellow
Write-Host ""
Write-Host "  Test SSH from your local machine:" -ForegroundColor Cyan
if ($sshHost) {
    Write-Host "    ssh $($env:USERNAME)@$sshHost" -ForegroundColor White
} else {
    Write-Host "    ssh $($env:USERNAME)@<tunnel-url>" -ForegroundColor White
}
Write-Host ""
