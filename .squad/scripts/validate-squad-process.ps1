# .squad/scripts/validate-squad-process.ps1
# Non-destructive validation script for Tangent Squad upgrade structural checks.
# Safe to run on dirty worktree. Does NOT run tests, builds, or kill processes.

[CmdletBinding()]
param(
    [switch]$RequirePackage
)

$ErrorActionPreference = 'Stop'
$exitCode = 0

Write-Host "`n=== Tangent Squad Process Validation ===" -ForegroundColor Cyan
Write-Host "Checking structural Squad files and conventions...`n" -ForegroundColor Gray

# --- 1. Check .squad/team.md structure ---
Write-Host "[1/6] Checking .squad/team.md..." -ForegroundColor Yellow
$teamPath = ".squad\team.md"
if (-not (Test-Path $teamPath)) {
    Write-Host "  FAIL: .squad/team.md not found" -ForegroundColor Red
    $exitCode = 1
} else {
    $teamContent = Get-Content $teamPath -Raw
    $hasMembers = $teamContent -match '##\s+Members'
    $hasModelPolicy = $teamContent -match '##\s+Model Policy'
    
    if ($hasMembers -and $hasModelPolicy) {
        Write-Host "  PASS: Contains '## Members' and '## Model Policy'" -ForegroundColor Green
    } else {
        Write-Host "  FAIL: Missing required sections" -ForegroundColor Red
        if (-not $hasMembers) { Write-Host "    - Missing '## Members'" -ForegroundColor Red }
        if (-not $hasModelPolicy) { Write-Host "    - Missing '## Model Policy'" -ForegroundColor Red }
        $exitCode = 1
    }
}

# --- 2. Check .squad/routing.md structure ---
Write-Host "[2/6] Checking .squad/routing.md..." -ForegroundColor Yellow
$routingPath = ".squad\routing.md"
if (-not (Test-Path $routingPath)) {
    Write-Host "  FAIL: .squad/routing.md not found" -ForegroundColor Red
    $exitCode = 1
} else {
    $routingContent = Get-Content $routingPath -Raw
    $hasResponseMode = $routingContent -match 'Response Mode Selection'
    $hasSquadFirst = $routingContent -match 'Squad-First Reflex'
    
    if ($hasResponseMode -and $hasSquadFirst) {
        Write-Host "  PASS: Mentions 'Response Mode Selection' and 'Squad-First Reflex'" -ForegroundColor Green
    } else {
        Write-Host "  FAIL: Missing required Squad V2 concepts" -ForegroundColor Red
        if (-not $hasResponseMode) { Write-Host "    - Missing 'Response Mode Selection'" -ForegroundColor Red }
        if (-not $hasSquadFirst) { Write-Host "    - Missing 'Squad-First Reflex'" -ForegroundColor Red }
        $exitCode = 1
    }
}

# --- 3. Check .squad/ceremonies.md structure ---
Write-Host "[3/6] Checking .squad/ceremonies.md..." -ForegroundColor Yellow
$ceremoniesPath = ".squad\ceremonies.md"
if (-not (Test-Path $ceremoniesPath)) {
    Write-Host "  FAIL: .squad/ceremonies.md not found" -ForegroundColor Red
    $exitCode = 1
} else {
    $ceremoniesContent = Get-Content $ceremoniesPath -Raw
    $hasPerTask = $ceremoniesContent -match 'Per-Task Gate'
    $hasPackaging = $ceremoniesContent -match 'Packaging Smoke Gate'
    
    if ($hasPerTask -and $hasPackaging) {
        Write-Host "  PASS: Mentions 'Per-Task Gate' and 'Packaging Smoke Gate'" -ForegroundColor Green
    } else {
        Write-Host "  FAIL: Missing required gate concepts" -ForegroundColor Red
        if (-not $hasPerTask) { Write-Host "    - Missing 'Per-Task Gate'" -ForegroundColor Red }
        if (-not $hasPackaging) { Write-Host "    - Missing 'Packaging Smoke Gate'" -ForegroundColor Red }
        $exitCode = 1
    }
}

# --- 4. Check .gitattributes union merge rules ---
Write-Host "[4/6] Checking .gitattributes union merge rules..." -ForegroundColor Yellow
$gitattributesPath = ".gitattributes"
if (-not (Test-Path $gitattributesPath)) {
    Write-Host "  FAIL: .gitattributes not found" -ForegroundColor Red
    $exitCode = 1
} else {
    $gitattributesContent = Get-Content $gitattributesPath -Raw
    $requiredRules = @(
        '.squad/decisions.md merge=union',
        '.squad/agents/*/history.md merge=union',
        '.squad/log/** merge=union',
        '.squad/orchestration-log/** merge=union'
    )
    
    $allPresent = $true
    foreach ($rule in $requiredRules) {
        $pattern = [regex]::Escape($rule)
        if ($gitattributesContent -notmatch $pattern) {
            if ($allPresent) {
                Write-Host "  FAIL: Missing union merge rules" -ForegroundColor Red
                $allPresent = $false
            }
            Write-Host "    - Missing: $rule" -ForegroundColor Red
            $exitCode = 1
        }
    }
    
    if ($allPresent) {
        Write-Host "  PASS: All required union merge rules present" -ForegroundColor Green
    }
}

# --- 5. Report regression hook status (non-failing) ---
Write-Host "[5/6] Checking regression hook status..." -ForegroundColor Yellow
$hookReportPath = "test-results\hook-report.json"
if (Test-Path $hookReportPath) {
    try {
        $hookReport = Get-Content $hookReportPath -Raw | ConvertFrom-Json
        Write-Host "  INFO: Last regression hook run:" -ForegroundColor Cyan
        Write-Host "    - Passed: $($hookReport.passed)" -ForegroundColor Gray
        Write-Host "    - Failed: $($hookReport.failed)" -ForegroundColor Gray
        
        if ($hookReport.failed -gt 0 -and $hookReport.failedTests) {
            Write-Host "    - Failed tests:" -ForegroundColor Gray
            foreach ($testTitle in $hookReport.failedTests) {
                Write-Host "      - $testTitle" -ForegroundColor Gray
            }
        }
    } catch {
        Write-Host "  WARN: Failed to parse hook-report.json: $_" -ForegroundColor Yellow
    }
} else {
    Write-Host "  INFO: No regression hook report found (not yet run)" -ForegroundColor Gray
}

# --- 6. Report package status ---
Write-Host "[6/6] Checking packaged executable..." -ForegroundColor Yellow
$packagePath = "dist\win-unpacked\Tangent.exe"
if (Test-Path $packagePath) {
    $fileInfo = Get-Item $packagePath
    $sizeKB = [math]::Round($fileInfo.Length / 1KB, 2)
    Write-Host "  PASS: Package exists: $packagePath ($sizeKB KB)" -ForegroundColor Green
} else {
    if ($RequirePackage) {
        Write-Host "  FAIL: Packaged exe not found at $packagePath" -ForegroundColor Red
        $exitCode = 1
    } else {
        Write-Host "  WARN: Packaged exe not found (run: npm run build && npx electron-builder --dir --config.npmRebuild=false)" -ForegroundColor Yellow
    }
}

# --- Summary ---
Write-Host ""
if ($exitCode -eq 0) {
    Write-Host "=== All structural checks passed ===" -ForegroundColor Green
} else {
    Write-Host "=== Structural checks failed ===" -ForegroundColor Red
}

exit $exitCode
