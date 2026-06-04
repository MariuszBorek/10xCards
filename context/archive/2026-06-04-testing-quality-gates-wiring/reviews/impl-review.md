<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Quality-gates wiring

- **Plan**: context/changes/testing-quality-gates-wiring/plan.md
- **Scope**: All 4 phases
- **Date**: 2026-06-04
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 3 observations

## Verdicts

| Dimension           | Verdict                                            |
| ------------------- | -------------------------------------------------- |
| Plan Adherence      | PASS                                               |
| Scope Discipline    | PASS                                               |
| Safety & Quality    | WARNING                                            |
| Architecture        | PASS                                               |
| Pattern Consistency | PASS                                               |
| Success Criteria    | PASS (live: both CI jobs green on run 26966562355) |

All four warnings are non-blocking hardening on CI / e2e test-infra; none affect the
gates' correctness. Plan adherence is clean and every "What We're NOT Doing"
guardrail (no coverage wiring, no new tests beyond the one e2e, local-only Supabase,
no render-XSS DOM test) held.

## Findings

### F1 — Supabase keys echoed to CI logs via `tee`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: .github/workflows/ci.yml:46-53
- **Detail**: `... | tee .env >> "$GITHUB_ENV"` echoes all four lines — incl. SUPABASE_SERVICE_ROLE_KEY (full RLS-bypass) and SUPABASE_KEY — to stdout / the build log. These are the well-known LOCAL dev keys (deterministic, public), so real impact is low, but printing a service-role credential is a poor pattern to model. Secondary: writing to $GITHUB_ENV via `>>` is the documented multi-line-injection vector (theoretical here — local keys carry no newlines).
- **Fix**: Write the four lines to `.env` without teeing to stdout, then append to $GITHUB_ENV separately (`{ echo ...; } > .env` then `cat .env >> "$GITHUB_ENV"`).
- **Decision**: SKIPPED (low impact, local public keys; user opted to archive)

### F2 — No `permissions:` block (over-broad GITHUB_TOKEN)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: .github/workflows/ci.yml:1-9
- **Detail**: Neither job declares `permissions:`, so the workflow inherits the repo's default GITHUB_TOKEN scope (often write). Nothing here needs write.
- **Fix**: Add top-level `permissions:\n  contents: read`.
- **Decision**: SKIPPED (user opted to archive)

### F3 — e2e teardown: orphan-user risk (hard-coded list + non-isolated loop)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Reliability)
- **Location**: tests/e2e/auth.teardown.ts:12-20
- **Detail**: Teardown deletes a hard-coded two-file list of seeded users. (1) A future third seeded user won't be deleted — orphan auth.users rows. (2) The delete loop isn't per-iteration guarded: if the first deleteUser throws, the loop aborts and the second user is never deleted. In CI the DB is ephemeral (no accumulation); locally orphans persist until `supabase db reset`.
- **Fix A ⭐ Recommended**: Derive the record-file list from a glob (`tests/e2e/.auth/seed-user*.json`) and wrap each delete in try/catch (or Promise.allSettled).
  - Strength: Removes the drift hazard and the partial-cleanup hazard in one edit; self-maintaining.
  - Tradeoff: Slightly more code in teardown.
  - Confidence: HIGH — standard cleanup-robustness pattern.
  - Blind spot: None significant.
- **Fix B**: Leave as-is (CI ephemeral DB makes it harmless there).
  - Strength: Zero work; CI unaffected.
  - Tradeoff: Local orphans accumulate; exemplar models a fragile teardown.
  - Confidence: MED — fine until a user is added or run locally.
- **Decision**: SKIPPED (user opted to archive; candidate follow-up)

### F4 — e2e setup: seed-record written only after sign-in succeeds

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: tests/e2e/auth.setup.ts:~52
- **Detail**: The seed-record file (teardown's input for deletion) is written only after the sign-in assertion passes. If sign-in throws, the user exists in auth.users but no record file is written → teardown can never delete it → orphan.
- **Fix**: Write the seed-record file immediately after `seedUser()` returns (before sign-in).
- **Decision**: SKIPPED (user opted to archive)

### F5 — storageState uses dedicated `critical-flow.json`, not plan's `user.json`

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: tests/e2e/critical-flow.spec.ts:27
- **Detail**: Plan contract literally said `user.json`; impl uses a dedicated per-run user (+ matching auth.setup/teardown edits). Justified improvement — sharing user.json with seed.spec.ts under fullyParallel would break the "exactly one Delete button" cleanup invariant. Also adds a file-contents assertion ("ephemeral") beyond the contract.
- **Fix**: None — accepted as a justified improvement.
- **Decision**: ACCEPTED (justified improvement)

### F6 — change.md status `implemented` vs plan's terminal token `complete`

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/testing-quality-gates-wiring/change.md:5
- **Detail**: Plan item §4 prose said end at `complete`; `implemented` is the /10x-implement lifecycle vocabulary /10x-archive gates on. Correct for the toolchain.
- **Fix**: None — `implemented` is the right lifecycle token.
- **Decision**: ACCEPTED (correct per toolchain)

### F7 — Actions pinned to floating major tags, not SHAs

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: .github/workflows/ci.yml:13,31,63,69
- **Detail**: checkout@v4 / setup-node@v4 / upload-artifact@v4 use mutable tags. SHA-pinning is the supply-chain convention, but the pre-existing workflow already used @v4 (consistent with the repo). GitHub's Node-20 deprecation annotation fires on checkout@v4/setup-node@v4 — bump when convenient (Node-20 forced to 24 from 2026-06-16, removed 2026-09-16).
- **Fix**: None now — consistent with repo; revisit at next CI maintenance.
- **Decision**: SKIPPED (noted for future CI maintenance)
