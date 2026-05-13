# Ceremonies

> Team meetings that happen before or after work. Each squad configures their own.

## Squad-First Reflex

| Field | Value |
|-------|-------|
| **Trigger** | every user request |
| **When** | before |
| **Condition** | always — runs before coordinator responds to any user request |
| **Facilitator** | coordinator (automatic) |
| **Participants** | coordinator only |
| **Time budget** | instant (<5s) |
| **Enabled** | ✅ yes |

**Checklist (coordinator internal):**
1. Is there a Squad member who owns this domain? If yes → route to them
2. Can multiple agents work in parallel? If yes → spawn all as background
3. Is this a simple fact I can answer directly? If yes → answer inline
4. Default → spawn single specialist foreground

**Anti-pattern detection:**
- ❌ Am I about to write code? (spawn coder instead)
- ❌ Am I about to run tests? (spawn Basher instead)
- ❌ Am I spawning sequentially when parallel is possible? (use background mode)

---

## Pre-Flight Baseline

| Field | Value |
|-------|-------|
| **Trigger** | manual or auto |
| **When** | before |
| **Condition** | before starting new feature work or after major refactor |
| **Facilitator** | tester (Basher) |
| **Participants** | tester + any agent who modified tests |
| **Time budget** | 2-5 minutes |
| **Enabled** | ✅ yes |

**Agenda:**
1. Run `npm run build` to verify clean build
2. Run `npm run test` (unit tests) and confirm all pass
3. Run `npm run test:regression` (E2E) and confirm all pass
4. Document baseline status (all green / known failures)
5. If failures found → fix before proceeding OR document as known issues

**Output:** Baseline status documented in session or `.squad/log/baseline-YYYY-MM-DD.md`

**Rationale:** Prevents "was it already broken?" questions. Establishes clean starting point.

---

## Per-Task Gate

| Field | Value |
|-------|-------|
| **Trigger** | auto |
| **When** | after |
| **Condition** | after code changes to `src/` (excluding docs-only changes) |
| **Facilitator** | tester (Basher) |
| **Participants** | tester + implementer |
| **Time budget** | 2-5 minutes |
| **Enabled** | ✅ yes |

**Agenda:**
1. Run `npm run build` — must succeed
2. Run `npm run test` — must pass (or match baseline)
3. If changes touch E2E-tested behavior → run `npm run test:regression`
4. Update `tests/regression/specific.spec.ts` to cover the bug just fixed
5. After hook runs, read `test-results/hook-report.json` for failures
6. If new failure in general suite → replace weakest test in `general.spec.ts`

**Gate criteria:**
- ✅ Build succeeds
- ✅ Unit tests pass or match baseline
- ✅ Regression tests pass (if applicable)
- ✅ `specific.spec.ts` updated to prevent regression
- ✅ Hook report shows no new failures

**On failure:** Fix immediately or revert changes. Don't proceed.

---

## Packaging Smoke Gate

| Field | Value |
|-------|-------|
| **Trigger** | manual |
| **When** | after |
| **Condition** | before delivering exe to user OR after changes to main/preload/packaging |
| **Facilitator** | implementer or tester |
| **Participants** | whoever is delivering the exe |
| **Time budget** | 3-5 minutes |
| **Enabled** | ✅ yes (manual trigger) |

**Agenda:**
1. Run `npm run build` (must succeed)
2. Run `npx electron-builder --dir --config.npmRebuild=false` (must succeed)
3. Launch `dist\win-unpacked\Tangent.exe` manually
4. Verify: app launches, sessions panel renders, agent sidebar shows agents
5. Smoke test: create session, launch agent, verify terminal renders
6. Close app gracefully

**Gate criteria:**
- ✅ Packaging completes without errors
- ✅ `dist\win-unpacked\Tangent.exe` exists and is recent
- ✅ App launches and core UI renders
- ✅ One end-to-end flow works (create session → launch agent)

**On failure:** Fix packaging issues before delivering exe. Never deliver untested exe.

**Rationale:** `npm run build` alone does NOT update the packaged exe. This gate ensures the deliverable actually works.

---

## Process Hygiene Sweep

| Field | Value |
|-------|-------|
| **Trigger** | manual |
| **When** | after |
| **Condition** | end of session or before committing major work |
| **Facilitator** | any agent |
| **Participants** | implementer |
| **Time budget** | 1-2 minutes |
| **Enabled** | ✅ yes (manual trigger) |

**Agenda:**
1. Check `git status` — any unintended files staged/modified?
2. Review `.squad/` changes — accurate and complete?
3. Any temp files created? Clean them up
4. Any console.log / debugging code left behind? Remove it
5. Does commit message follow conventions? (if committing)

**Checklist:**
- ✅ No unintended file changes
- ✅ `.squad/` files reflect work done
- ✅ No temp files in repo
- ✅ No debug code in src/
- ✅ Commit message is clear

**Rationale:** Prevents accidental commits, keeps history clean, ensures Squad state accurate.

---

## Design Review

| Field | Value |
|-------|-------|
| **Trigger** | auto |
| **When** | before |
| **Condition** | multi-agent task involving 2+ agents modifying shared systems |
| **Facilitator** | lead |
| **Participants** | all-relevant |
| **Time budget** | focused |
| **Enabled** | ✅ yes |

**Agenda:**
1. Review the task and requirements
2. Agree on interfaces and contracts between components
3. Identify risks and edge cases
4. Assign action items

---

## Retrospective

| Field | Value |
|-------|-------|
| **Trigger** | auto |
| **When** | after |
| **Condition** | build failure, test failure, or reviewer rejection |
| **Facilitator** | lead |
| **Participants** | all-involved |
| **Time budget** | focused |
| **Enabled** | ✅ yes |

**Agenda:**
1. What happened? (facts only)
2. Root cause analysis
3. What should change?
4. Action items for next iteration
