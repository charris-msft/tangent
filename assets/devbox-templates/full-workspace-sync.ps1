# Full workspace sync back to primary machine on session end
# This script is triggered by Copilot CLI's sessionEnd hook

param(
    [string]$LocalPath = $env:TANGENT_LOCAL_PATH,
    [string]$RemotePath = $env:TANGENT_REMOTE_PATH,
    [string]$SshHost = $env:TANGENT_SSH_HOST,
    [string]$SshUser = $env:TANGENT_SSH_USER,
    [string]$ExcludePatterns = $env:TANGENT_EXCLUDE_PATTERNS
)

$ErrorActionPreference = 'Continue'
$LogFile = "$env:TEMP\tangent-sync.log"

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $LogFile -Value "[$timestamp] $Message"
}

Write-Log "=== Full workspace sync (sessionEnd) ==="
Write-Log "Remote Path: $RemotePath"
Write-Log "Local Path: $LocalPath"
Write-Log "SSH: $SshUser@$SshHost"

try {
    # Build exclude options from patterns
    $excludes = @('node_modules', '.git', '.env', '*.log', '.DS_Store', 'Thumbs.db')
    if ($ExcludePatterns) {
        $excludes += $ExcludePatterns -split ','
    }
    
    $excludeArgs = $excludes | ForEach-Object { "--exclude=$_" }
    
    # Build rsync command (Dev Box → Local)
    # Full sync includes checksum verification for integrity
    $rsyncArgs = @(
        '-avzc',  # -c for checksum
        '--delete',
        $excludeArgs,
        '-e', 'ssh -o StrictHostKeyChecking=no',
        "$RemotePath/",
        "${SshUser}@${SshHost}:${LocalPath}/"
    )
    
    Write-Log "Executing: rsync $($rsyncArgs -join ' ')"
    
    # Execute rsync
    $result = & rsync @rsyncArgs 2>&1
    $exitCode = $LASTEXITCODE
    
    if ($exitCode -eq 0) {
        Write-Log "Full sync completed successfully"
        Write-Log "Output: $result"
    } else {
        Write-Log "Full sync failed with exit code $exitCode"
        Write-Log "Error: $result"
    }
} catch {
    Write-Log "Exception during full sync: $_"
}

# Always exit 0 to avoid breaking agent flow
Write-Log "=== Full sync complete ==="
exit 0
