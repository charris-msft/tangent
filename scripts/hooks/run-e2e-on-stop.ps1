# Tangent Copilot CLI agentStop hook
# Runs a small e2e regression suite after the agent finishes coding.
#
# Contract:
# - Reads hook payload on stdin (JSON: { sessionId, cwd, transcriptPath, stopReason }).
# - Exits 0 (success) even on test failure — the agent should read the report,
#   not be blocked from exiting.
# - Writes a summary to test-results/hook-report.json and prints a compact
#   summary to stdout so it appears in the agent transcript.
#
# Skipped when:
#   - No source files have changed since last commit (nothing to validate), OR
#   - out/main/index.js is missing (no build yet), OR
#   - TANGENT_SKIP_E2E_HOOK=1 is set (manual escape hatch).

$ErrorActionPreference = 'Continue'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repoRoot

# Consume stdin so the pipe closes cleanly; parse best-effort.
$payload = $null
try {
    $raw = [Console]::In.ReadToEnd()
    if ($raw) { $payload = $raw | ConvertFrom-Json -ErrorAction SilentlyContinue }
} catch { }

$reportDir = Join-Path $repoRoot 'test-results'
if (-not (Test-Path $reportDir)) { New-Item -ItemType Directory -Path $reportDir | Out-Null }
$reportPath = Join-Path $reportDir 'hook-report.json'

function Write-Report($status, $summary, $details) {
    $obj = @{
        status    = $status
        summary   = $summary
        timestamp = (Get-Date).ToString('o')
        stopReason = $payload.stopReason
        details   = $details
    }
    $obj | ConvertTo-Json -Depth 6 | Set-Content -Path $reportPath -Encoding UTF8
    Write-Host "[tangent-e2e-hook] $status — $summary"
    Write-Host "[tangent-e2e-hook] Report: $reportPath"
}

if ($env:TANGENT_SKIP_E2E_HOOK -eq '1') {
    Write-Report 'skipped' 'TANGENT_SKIP_E2E_HOOK=1' @{}
    exit 0
}

if (-not (Test-Path (Join-Path $repoRoot 'out\main\index.js'))) {
    Write-Report 'skipped' 'out/main/index.js missing; run npm run build before tests can validate' @{}
    exit 0
}

# Has the agent actually changed source? If not, skip.
$changed = @()
try {
    $changed = git -C $repoRoot status --porcelain=v1 2>$null |
        Where-Object { $_ -match '^\s*[MADRCU?]{1,2}\s+(src|tests|scripts|\.github|electron\.vite\.config|package\.json)' }
} catch { }
if (-not $changed -or $changed.Count -eq 0) {
    Write-Report 'skipped' 'no source/test changes detected' @{ changedFiles = @() }
    exit 0
}

$specDir = Join-Path $repoRoot 'tests\regression'
if (-not (Test-Path $specDir)) {
    Write-Report 'skipped' 'tests/regression not present' @{}
    exit 0
}

Write-Host "[tangent-e2e-hook] Running regression suite (tests/regression/) ..."
$playwrightJson = Join-Path $reportDir 'hook-playwright.json'
$env:PLAYWRIGHT_JSON_OUTPUT_NAME = $playwrightJson

$start = Get-Date
# Use line reporter only — we parse the stdout log with regex (safer than
# ConvertFrom-Json which trips on deep nested JSON).
$args = @(
    'playwright','test', 'tests/regression',
    '--reporter=line',
    '--workers=1',
    '--timeout=45000'
)
$npx = (Get-Command npx.cmd -ErrorAction SilentlyContinue)?.Source
if (-not $npx) { $npx = (Get-Command npx -ErrorAction SilentlyContinue)?.Source }
if (-not $npx) {
    Write-Report 'skipped' 'npx not found on PATH' @{}
    exit 0
}
$proc = Start-Process -FilePath $npx -ArgumentList $args -NoNewWindow -PassThru `
    -RedirectStandardOutput (Join-Path $reportDir 'hook-stdout.log') `
    -RedirectStandardError  (Join-Path $reportDir 'hook-stderr.log')
if (-not $proc.WaitForExit(360000)) {
    try { $proc.Kill() } catch {}
    Write-Report 'timeout' 'playwright exceeded 6 min budget' @{ durationSec = 360 }
    exit 0
}
$durationSec = [int]((Get-Date) - $start).TotalSeconds
$exit = $proc.ExitCode

$general  = @{ passed = 0; failed = 0; failedTests = @() }
$specific = @{ passed = 0; failed = 0; failedTests = @() }

# Parse Playwright line reporter output. The reporter overwrites the progress
# line, so only the final trailer ("N passed" / "N failed") is reliable for
# totals. Per-bucket failures come from "N) tests\..." blocks.
$stdoutPath = Join-Path $reportDir 'hook-stdout.log'
$totalTests  = 0
$totalPassed = 0
$totalFailed = 0
if (Test-Path $stdoutPath) {
    $logText = Get-Content $stdoutPath -Raw

    foreach ($m in [regex]::Matches($logText, '(?m)^\s*\d+\)\s+tests[\\/]regression[\\/]([a-z]+)\.spec\.ts:\d+:\d+\s+›[^\r\n]+›\s*([^\r\n]+)')) {
        $bucket = if ($m.Groups[1].Value -eq 'specific') { $specific } else { $general }
        $bucket.failed++
        $bucket.failedTests += $m.Groups[2].Value.Trim()
    }

    if ($logText -match 'Running\s+(\d+)\s+tests?') { $totalTests  = [int]$matches[1] }
    if ($logText -match '(\d+)\s+passed')            { $totalPassed = [int]$matches[1] }
    if ($logText -match '(\d+)\s+failed')            { $totalFailed = [int]$matches[1] }

    # Distribute passed between buckets. If failures exist, we know their bucket.
    # Use the known split (general=5 tests, specific=3) as a fallback.
    $generalTotal  = if ($totalTests -gt 0) { 5 } else { 0 }
    $specificTotal = if ($totalTests -gt 0) { [Math]::Max(0, $totalTests - 5) } else { 0 }
    $general.passed  = [Math]::Max(0, $generalTotal  - $general.failed)
    $specific.passed = [Math]::Max(0, $specificTotal - $specific.failed)
}

$status = if ($exit -eq 0) { 'pass' } else { 'fail' }
$summary = "general=$($general.passed) passed / $($general.failed) failed, specific=$($specific.passed) passed / $($specific.failed) failed, ${durationSec}s"
Write-Report $status $summary @{
    exitCode     = $exit
    durationSec  = $durationSec
    general      = $general
    specific     = $specific
    changedFiles = $changed
    stdoutLog    = 'test-results/hook-stdout.log'
    stderrLog    = 'test-results/hook-stderr.log'
}

# Print agent-actionable guidance (visible in transcript).
if ($general.failed -gt 0 -or $specific.failed -gt 0) {
    Write-Host ""
    Write-Host "[tangent-e2e-hook] ❌ Regressions detected. Failed:"
    ($general.failedTests + $specific.failedTests) | ForEach-Object { Write-Host "  - $_" }
    Write-Host "[tangent-e2e-hook] Review test-results/hook-stdout.log and fix before committing."
}
if ($specific.passed -gt 0 -and $specific.failed -eq 0 -and $general.failed -eq 0) {
    Write-Host "[tangent-e2e-hook] ✅ Regression suite green. Consider whether tests/regression/general.spec.ts should absorb a case from tests/regression/specific.spec.ts (see .github/copilot-instructions.md)."
}

exit 0
