# Squad Scripts

Automation and validation tooling for the Tangent Squad.

## validate-squad-process.ps1

Non-destructive validation script for Squad structural checks. Safe to run on dirty worktree.

**Usage:**
```powershell
# Basic validation (warns on missing package, doesn't fail)
.\.squad\scripts\validate-squad-process.ps1

# Strict validation (fails if packaged exe missing)
.\.squad\scripts\validate-squad-process.ps1 -RequirePackage
```

**Checks:**
1. `.squad/team.md` has `## Members` and `## Model Policy`
2. `.squad/routing.md` mentions Response Mode Selection and Squad-First Reflex
3. `.squad/ceremonies.md` mentions Per-Task Gate and Packaging Smoke Gate
4. `.gitattributes` contains union merge rules for append-only Squad files
5. Reports latest regression hook status from `test-results/hook-report.json` (non-failing)
6. Reports package status at `dist\win-unpacked\Tangent.exe` (warns or fails based on `-RequirePackage`)

**Exit codes:**
- `0`: All structural checks passed
- `1`: One or more structural checks failed

**Constraints:**
- Does NOT run tests, builds, or kill processes
- Safe on dirty worktree
- Designed for Tangent's Electron packaging workflow (not FC2's multi-webserver assumptions)
