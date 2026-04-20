# Sync workspace back to primary machine after agent turn
# This script is triggered by Copilot CLI's agentStop hook

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

Write-Log "=== Incremental workspace sync (agentStop) ==="
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
    $rsyncArgs = @(
        '-avz',
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
        Write-Log "Sync completed successfully"
        Write-Log "Output: $result"
    } else {
        Write-Log "Sync failed with exit code $exitCode"
        Write-Log "Error: $result"
    }
} catch {
    Write-Log "Exception during sync: $_"
}

# Always exit 0 to avoid breaking agent flow
Write-Log "=== Sync complete ==="
exit 0
