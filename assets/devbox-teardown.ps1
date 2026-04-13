#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Tears down an existing dev tunnel and scheduled task so you can re-run devbox-setup.ps1 cleanly.
#>

param(
    [string]$TunnelName = "$($env:COMPUTERNAME.ToLower() -replace '[^a-z0-9-]', '')-ssh"
)

Write-Host "`nTearing down tunnel '$TunnelName'..." -ForegroundColor Yellow

# Stop and remove scheduled task
$taskName = "DevTunnel-$TunnelName"
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
    if ($task.State -eq 'Running') {
        Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        Write-Host "  Stopped task '$taskName'" -ForegroundColor Gray
    }
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "  Removed task '$taskName'" -ForegroundColor Green
} else {
    Write-Host "  No task '$taskName' found" -ForegroundColor Gray
}

# Delete the tunnel
Write-Host "  Deleting tunnel '$TunnelName'..." -ForegroundColor Gray
& devtunnel delete $TunnelName -f 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
if ($LASTEXITCODE -eq 0) {
    Write-Host "  Tunnel deleted" -ForegroundColor Green
} else {
    Write-Host "  Tunnel not found or already deleted" -ForegroundColor Yellow
}

Write-Host "`nDone. Re-run devbox-setup.ps1 to create a fresh tunnel with GitHub auth." -ForegroundColor Cyan
