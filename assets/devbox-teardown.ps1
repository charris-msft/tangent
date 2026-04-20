#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Tears down an existing dev tunnel and scheduled task so you can re-run devbox-setup.ps1 cleanly.

.DESCRIPTION
    This script:
    1. Stops and removes the DevTunnel scheduled task
    2. Kills any running devtunnel host processes
    3. Deletes the named dev tunnel

    After teardown completes, re-run devbox-setup.ps1 to create a fresh tunnel.

.NOTES
    Run this via RDP on your Dev Box before re-running setup.
#>

param(
    [string]$TunnelName = "$($env:COMPUTERNAME.ToLower() -replace '[^a-z0-9-]', '')-ssh"
)

$ErrorActionPreference = 'Stop'
$stepNumber = 0
$totalSteps = 3
$hadErrors = $false

function Write-Banner {
    Write-Host ""
    Write-Host "╔════════════════════════════════════════════════╗" -ForegroundColor Yellow
    Write-Host "║  Tangent Dev Box Teardown                     ║" -ForegroundColor Yellow
    Write-Host "║  Machine: $($env:COMPUTERNAME.PadRight(37))║" -ForegroundColor Yellow
    Write-Host "║  User:    $($env:USERNAME.PadRight(37))║" -ForegroundColor Yellow
    Write-Host "║  Tunnel:  $($TunnelName.PadRight(37))║" -ForegroundColor Yellow
    Write-Host "╚════════════════════════════════════════════════╝" -ForegroundColor Yellow
    Write-Host ""
}

function Write-Step {
    param([string]$Message)
    $script:stepNumber++
    Write-Host ""
    Write-Host "[$stepNumber/$totalSteps] $Message" -ForegroundColor Yellow
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
# Step 1: Stop and remove the DevTunnel scheduled task
# ---------------------------------------------------------------------------
Write-Step "Removing DevTunnel scheduled task"

$sw = [System.Diagnostics.Stopwatch]::StartNew()

# Try both naming conventions: "DevTunnel-<name>" and the bare tunnel name
$taskCandidates = @("DevTunnel-$TunnelName", $TunnelName)
$taskFound = $false

foreach ($taskName in $taskCandidates) {
    Write-Detail "Checking for task '$taskName'..."
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task) {
        $taskFound = $true
        if ($task.State -eq 'Running') {
            Write-Detail "Stopping running task '$taskName'..."
            Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
            Write-Success "Stopped task '$taskName'"
        }
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        Write-Success "Removed task '$taskName'"
    }
}

if (-not $taskFound) {
    Write-Warn "No scheduled task found (tried: $($taskCandidates -join ', '))"
}

$sw.Stop()
Write-Elapsed $sw

# ---------------------------------------------------------------------------
# Step 2: Kill any running devtunnel host processes
# ---------------------------------------------------------------------------
Write-Step "Killing devtunnel host processes"

$sw = [System.Diagnostics.Stopwatch]::StartNew()

$devtunnelProcs = Get-Process -Name "devtunnel" -ErrorAction SilentlyContinue
if ($devtunnelProcs) {
    $count = ($devtunnelProcs | Measure-Object).Count
    Write-Detail "Found $count running devtunnel process(es)..."
    $devtunnelProcs | Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Success "Killed $count devtunnel process(es)"
} else {
    Write-Detail "No running devtunnel processes found"
}

$sw.Stop()
Write-Elapsed $sw

# ---------------------------------------------------------------------------
# Step 3: Delete the dev tunnel
# ---------------------------------------------------------------------------
Write-Step "Deleting dev tunnel"

$sw = [System.Diagnostics.Stopwatch]::StartNew()

Write-Detail "Deleting tunnel '$TunnelName'..."
$deleteOutput = & devtunnel delete $TunnelName -f 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Success "Tunnel '$TunnelName' deleted"
} else {
    $outputStr = $deleteOutput | Out-String
    if ($outputStr -match 'not found|does not exist') {
        Write-Warn "Tunnel '$TunnelName' not found (already deleted or never created)"
    } else {
        Write-Fail "Failed to delete tunnel '$TunnelName': $outputStr"
        $hadErrors = $true
    }
}

$sw.Stop()
Write-Elapsed $sw

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host ("═" * 50) -ForegroundColor DarkGray
if ($hadErrors) {
    Write-Host "  Teardown completed with warnings — check output above." -ForegroundColor Yellow
} else {
    Write-Host "  ✓ Teardown complete." -ForegroundColor Green
}
Write-Host "  Re-run devbox-setup.ps1 to create a fresh tunnel with GitHub auth." -ForegroundColor Cyan
Write-Host ""
