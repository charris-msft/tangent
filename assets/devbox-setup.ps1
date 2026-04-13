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

    The tunnel uses authenticated access — connecting clients must authenticate
    with the same Microsoft Entra ID or GitHub identity used to create the tunnel.
    This is the recommended approach for enterprise environments.

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
    [string]$TunnelName = "$($env:COMPUTERNAME)-ssh"
)

$ErrorActionPreference = 'Stop'

function Write-Step {
    param([string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "    [OK] $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host "    [WARN] $Message" -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# Step 1: OpenSSH Server
# ---------------------------------------------------------------------------
Write-Step "Checking OpenSSH Server..."

$sshCapability = Get-WindowsCapability -Online | Where-Object Name -like 'OpenSSH.Server*'
if ($sshCapability.State -ne 'Installed') {
    Write-Host "    Installing OpenSSH Server..."
    Add-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0' | Out-Null
    Write-Success "OpenSSH Server installed"
} else {
    Write-Success "OpenSSH Server already installed"
}

# Enable and start sshd
$sshService = Get-Service sshd -ErrorAction SilentlyContinue
if ($sshService) {
    if ($sshService.StartType -ne 'Automatic') {
        Set-Service -Name sshd -StartupType Automatic
        Write-Success "sshd set to auto-start"
    }
    if ($sshService.Status -ne 'Running') {
        Start-Service sshd
        Write-Success "sshd started"
    } else {
        Write-Success "sshd already running"
    }
} else {
    Write-Warn "sshd service not found after install — reboot may be required"
}

# Ensure firewall rule exists
$fwRule = Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue
if (-not $fwRule) {
    New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server (sshd)' `
        -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null
    Write-Success "Firewall rule created for port 22"
} else {
    Write-Success "Firewall rule already exists"
}

# Set default shell to PowerShell for SSH sessions
$regPath = 'HKLM:\SOFTWARE\OpenSSH'
if (-not (Test-Path $regPath)) {
    New-Item -Path $regPath -Force | Out-Null
}
$currentShell = Get-ItemProperty -Path $regPath -Name DefaultShell -ErrorAction SilentlyContinue
$pwshPath = (Get-Command powershell.exe).Source
if (-not $currentShell -or $currentShell.DefaultShell -ne $pwshPath) {
    New-ItemProperty -Path $regPath -Name DefaultShell -Value $pwshPath -PropertyType String -Force | Out-Null
    Write-Success "Default SSH shell set to PowerShell"
} else {
    Write-Success "Default SSH shell already set"
}

# ---------------------------------------------------------------------------
# Step 2: devtunnel CLI
# ---------------------------------------------------------------------------
Write-Step "Checking devtunnel CLI..."

$devtunnel = Get-Command devtunnel -ErrorAction SilentlyContinue
if (-not $devtunnel) {
    Write-Host "    Installing devtunnel CLI via winget..."
    try {
        winget install Microsoft.devtunnel --accept-package-agreements --accept-source-agreements --silent
        # Refresh PATH
        $env:PATH = [System.Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('PATH', 'User')
        $devtunnel = Get-Command devtunnel -ErrorAction SilentlyContinue
        if ($devtunnel) {
            Write-Success "devtunnel installed"
        } else {
            Write-Warn "devtunnel installed but not found in PATH — restart your terminal"
        }
    } catch {
        # Fallback: direct download
        Write-Host "    winget failed, downloading directly..."
        $downloadUrl = 'https://aka.ms/TunnelsCliDownload/win-x64'
        $installPath = Join-Path $env:LOCALAPPDATA 'Microsoft\devtunnel'
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

# ---------------------------------------------------------------------------
# Step 3: devtunnel login (if needed)
# ---------------------------------------------------------------------------
Write-Step "Checking devtunnel authentication..."

$loginCheck = & devtunnel show $TunnelName 2>&1
if ($loginCheck -match 'not logged in' -or $loginCheck -match 'login') {
    Write-Host "    You need to log in to devtunnel. Opening browser for authentication..."
    & devtunnel user login
    Write-Success "devtunnel login complete"
} else {
    Write-Success "devtunnel already authenticated"
}

# ---------------------------------------------------------------------------
# Step 4: Create named tunnel
# ---------------------------------------------------------------------------
Write-Step "Setting up dev tunnel '$TunnelName'..."

# Check if tunnel already exists
$existing = & devtunnel show $TunnelName 2>&1
if ($LASTEXITCODE -eq 0 -and $existing -notmatch 'not found') {
    Write-Success "Tunnel '$TunnelName' already exists"
} else {
    Write-Host "    Creating tunnel..."
    & devtunnel create $TunnelName
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create tunnel '$TunnelName'"
    }
    Write-Success "Tunnel '$TunnelName' created"
}

# Ensure port 22 is mapped
Write-Host "    Configuring port 22..."
& devtunnel port create $TunnelName -p 22 2>&1 | Out-Null
Write-Success "Port 22 configured on tunnel"

# ---------------------------------------------------------------------------
# Step 5: Get tunnel URL
# ---------------------------------------------------------------------------
Write-Step "Retrieving tunnel connection info..."

$tunnelInfo = & devtunnel show $TunnelName 2>&1
$tunnelUrl = $null

# Parse the tunnel URL from output
foreach ($line in $tunnelInfo) {
    if ($line -match 'Connect via browser:\s+https://([^\s]+)') {
        $tunnelUrl = $Matches[1]
        break
    }
    if ($line -match 'Tunnel ID:\s+([^\s]+)') {
        # Tunnel ID format: user.tunnelname — the URL is constructed from this
        $tunnelId = $Matches[1]
    }
    if ($line -match '([\w.-]+\.devtunnels\.ms)') {
        $tunnelUrl = $Matches[1]
        break
    }
}

# The SSH host for the tunnel is the tunnel endpoint
# When hosted, SSH connects via: ssh -p 22 user@{tunnelId}.devtunnels.ms
# Or via the tunnel's port-specific URL

# ---------------------------------------------------------------------------
# Step 6: Scheduled task for auto-hosting
# ---------------------------------------------------------------------------
Write-Step "Setting up auto-host scheduled task..."

$taskName = "DevTunnel-$TunnelName"
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

$devtunnelPath = (Get-Command devtunnel -ErrorAction SilentlyContinue).Source
if (-not $devtunnelPath) {
    $devtunnelPath = 'devtunnel'
}

if ($existingTask) {
    Write-Success "Scheduled task '$taskName' already exists"
} else {
    $action = New-ScheduledTaskAction -Execute $devtunnelPath -Argument "host $TunnelName"
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force | Out-Null
    Write-Success "Scheduled task '$taskName' created (runs at logon)"
}

# Start the tunnel now
Write-Step "Starting dev tunnel..."
Start-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

# Get the actual connection URL after hosting
$hostedInfo = & devtunnel show $TunnelName 2>&1
$sshHost = $null
foreach ($line in $hostedInfo) {
    if ($line -match '([\w.-]+\.devtunnels\.ms)') {
        $sshHost = $Matches[1]
        break
    }
}

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------
Write-Host "`n" -NoNewline
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Dev Box Setup Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Tunnel Name : $TunnelName" -ForegroundColor White
if ($sshHost) {
    Write-Host "Tunnel Host : $sshHost" -ForegroundColor White
} else {
    Write-Host "Tunnel Host : (run 'devtunnel show $TunnelName' to find URL)" -ForegroundColor Yellow
}
Write-Host "SSH User    : $env:USERNAME" -ForegroundColor White
Write-Host "SSH Port    : 22" -ForegroundColor White
Write-Host ""
Write-Host "Add this to your LOCAL machine's ~/.tangent/devbox-config.json:" -ForegroundColor Cyan
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
Write-Host "Test SSH from your local machine:" -ForegroundColor Cyan
if ($sshHost) {
    Write-Host "  ssh $($env:USERNAME)@$sshHost" -ForegroundColor White
} else {
    Write-Host "  ssh $($env:USERNAME)@<tunnel-url>" -ForegroundColor White
}
Write-Host ""
