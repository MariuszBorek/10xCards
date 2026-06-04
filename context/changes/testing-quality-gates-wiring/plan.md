# Quality-gates wiring Implementation Plan

## Overview

Rollout Phase 3 of `context/foundation/test-plan.md`. The Phase 1–2 protections
(Risks #1/#2 authorization+RLS, #3 transient input, #4 silent-loss, #5 generation
failure paths, #6 auth gating, #7 output-safety) all exist as **real tests**, but
**nothing guards a merge today** — CI runs only `lint` + `build`. This phase wires
the test plan's §5 gates into CI so any regression in those protections fails CI
before reaching production, and adds the one genuinely browser-level gate the
critical user flow needs (paste→generate→accept→export). It is almost entirely
net-new CI plumbing, not test authoring — except the single missing e2e spec.

## Current State Analysis

- **CI is lint + build only** (`.github/workflows/ci.yml:13-24`): `checkout →
setup-node@22 → npm ci → astro sync → npm run lint → npm run build` (build gets
  `SUPABASE_URL` / `SUPABASE_KEY` secrets). No `astro check`, no `npm test`, no
  Playwright, no `SUPABASE_SERVICE_ROLE_KEY`. **There is no test gate at all.**
- **The npm scripts already exist** (`package.json:11-19`): `lint`, `typecheck`
  (`astro check`), `test` (`vitest run`), `e2e` (`playwright test`). Phase 3 only
  needs the CI invocation, not new scripts.
- **A naive `npm test` in CI would be green-but-hollow.** Integration suites gate
  on `describe.skipIf(!(await isSupabaseReachable()))`; `isSupabaseReachable()`
  returns `false` (never throws) when env is missing or Supabase is unreachable
  (`test/helpers/supabase.ts:29-50`). With no env, 7 of 10 test files **skip** and
  `vitest run` exits 0. The skipped set is the entire authorization/RLS/persistence
  spine (Risks #1/#2/#4). The three that run unconditionally —
  `test/output-safety/anki-export.test.ts`, `test/generation/generate-service.test.ts`,
  `test/authz/middleware-gating.test.ts` — need no Supabase.
- **`hasTestEnv()` is already exported** (`test/helpers/supabase.ts:20-22`): true
  only when all three of `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
  are set. The CI fail-fast guard reuses it directly.
- **Both Supabase-backed harnesses read secrets from a `.env` file**, not bare
  process env: Vitest via `loadEnv("test", cwd, "")` → `test.env` (`vitest.config.ts:8,19`);
  the e2e dev server via `process.loadEnvFile(".env")` (`playwright.config.ts:7-11`)
  feeding `astro dev`, which itself loads `.env` through Vite. So each Supabase-backed
  CI job must **materialize `.env` from secrets**, not just `env:`-export them.
- **The critical-flow e2e does not exist.** `tests/e2e/seed.spec.ts` covers Risk #4
  only (manual add → reload). The e2e infra is fully in place: `auth.setup.ts`
  (seed + sign-in → storageState), `auth.teardown.ts` (CASCADE delete), the
  `setup → chromium → cleanup` projects, `webServer: npm run dev`, and
  `OPENROUTER_MOCK=true` in `.env` makes generation deterministic with no network call
  (`src/lib/services/generate.ts:22-32`).
- **§5 of the test plan is factually wrong**: `test-plan.md:149` claims "lint +
  typecheck already run in CI." Only lint runs; `astro build` does not run
  `astro check`. This is a backport correction this change owns.

### Key Discoveries:

- `test/helpers/supabase.ts:20-22` — `hasTestEnv()` exists and is exactly the
  predicate the CI fail-fast guard needs; no new env-detection code required.
- `vitest.config.ts:8` and `playwright.config.ts:7-11` — both harnesses source
  secrets from `.env`, so CI must write `.env` from secrets before running either.
- `playwright.config.ts:19-20,47` — `forbidOnly`, `retries:2`, and
  `reuseExistingServer:false` already key off `process.env.CI`; the e2e job needs
  no Playwright-config change, only `.env` + the webServer.
- `src/lib/services/generate.ts:22-32` — `OPENROUTER_MOCK==="true"` short-circuits
  before any fetch and returns `ephemeral` / `serendipity` / `ubiquitous`; the e2e
  needs no OpenRouter secret.
- `supabase/migrations/20260527000000_flashcard_schema.sql` — the `flashcards`
  table + per-operation RLS policies the cross-account tests query; CI must apply it.
- `supabase` CLI is already a devDependency (`package.json:64`) — `supabase start`
  is feasible with no new install.

## Desired End State

A PR to `main` runs two CI jobs:

1. **`quality` (fast)** — lint, typecheck (`astro check`), build, and the
   unconditional unit tests. Fails on any syntactic/type drift or unit regression.
   Pays no Supabase cost.
2. **`integration-e2e` (heavy)** — stands up local Supabase, applies migrations,
   runs the gated integration suites (cross-account isolation, persistence,
   route/handler ownership, API gating) **and** the critical-flow e2e. A missing or
   mis-wired secret makes this job **fail**, never silently skip.

Both jobs are required and run on every PR + push to `main`. `test-plan.md` §5/§6.3
reflects what actually shipped, and the Phase 3 rollout row reads `complete`.

**Verification**: open a throwaway PR — both jobs run; intentionally breaking a
type, a unit assertion, an RLS policy, or the value path turns the corresponding
job red; removing the `SUPABASE_SERVICE_ROLE_KEY` secret turns the heavy job red
(not green-with-skips).

## What We're NOT Doing

- **No coverage wiring.** `@vitest/coverage-v8` stays unused; no `--coverage`, no
  threshold. No baseline is defined, and a report nobody gates on is low-value
  (decision recorded in plan-brief).
- **No new tests beyond the one critical-flow e2e.** The integration/unit suites are
  complete from Phases 1–2; this phase wraps a gate around them.
- **No re-testing at e2e what integration already covers.** The e2e proves only the
  genuinely browser-level value path + a real file download. Cross-account isolation,
  handler ownership, generation failure branches, CSV neutralization stay at their
  existing cheaper layers.
- **No render-XSS DOM test** — deferred in Phase 2 (zero raw-HTML sinks; revisit when
  one is introduced). Unchanged here.
- **No hosted/cloud Supabase in CI** — local CLI only, to preserve seed/teardown
  isolation and avoid shared mutable state.
- **No freshness-ledger (§8) rewrite** — that is `/10x-test-plan --refresh`'s job;
  this change touches only §5 (correction), §3 (status), and §6.3 (cookbook).

## Implementation Approach

Split the gates by cost. A `quality` job carries the cheap, always-runnable gates
(lint/typecheck/build/unit) for fast PR feedback. A separate `integration-e2e` job
carries everything that needs a real Supabase — both the integration suites and the
e2e share one `supabase start` + one `.env`-from-secrets step, so the slow setup is
paid once. The single most important safety property is that the heavy job **cannot
go green while testing nothing**: a fail-fast guard asserts `hasTestEnv()` in CI
before the suites run, so a dropped secret is a red build, not a silent hole.

Phases are ordered so each lands a usable gate: the fast gate first (immediate,
zero-infra value), then the integration gate (the security spine), then the e2e
(the value path), then the doc backport once the gates are real.

## Critical Implementation Details

- **`.env` must be materialized from secrets in the heavy job.** Both Vitest
  (`loadEnv` from `.env`) and the e2e dev server (`process.loadEnvFile(".env")` +
  `astro dev`) read `.env`, not bare process env. The job must write a `.env`
  containing `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and
  `OPENROUTER_MOCK=true` after `supabase start` (whose output prints the local URL +
  keys). The anon/service keys for a local `supabase start` are the well-known local
  development keys — read them from the `supabase start` status output rather than
  hardcoding.
- **Migrations must be applied before the suites run.** The cross-account tests query
  real `flashcards` rows; `supabase start` on a fresh checkout applies migrations in
  `supabase/migrations/`, but verify with `supabase db reset` (or `supabase migration
up`) so the RLS policies exist. If `supabase/config.toml` is absent in CI,
  `supabase start` needs it — confirm the repo's `supabase/` dir carries config.
- **The fail-fast guard runs only under CI.** Gate on `process.env.CI` so local dev
  keeps skipping cleanly (the whole point of `isSupabaseReachable()`); in CI a false
  `hasTestEnv()` exits non-zero with a clear message. Place it as a step before
  `npm test`, or as a tiny preflight the test command depends on.
- **e2e in CI uses `reuseExistingServer:false` automatically** (`CI` is set), so the
  job must let Playwright start its own `npm run dev`; do not pre-start a server.

## Phase 1: Static + unit fast gate

### Overview

Restructure `ci.yml` so the existing job becomes the fast `quality` gate: add the
typecheck step and run the unconditional unit tests on every PR. No Supabase.

### Changes Required:

#### 1. CI workflow — add typecheck + unit tests to the fast path

**File**: `.github/workflows/ci.yml`

**Intent**: Add `npx astro check` (typecheck — currently absent) and `npm test`
(which, with no Supabase env, runs the three unconditional unit files and skips the
rest) to the existing job. Rename the job to `quality` to signal its scope. Keep
lint + build. This gives every PR a real type + unit gate with zero infra.

**Contract**: The `quality` job runs, in order: `npm ci` → `npx astro sync` →
`npm run lint` → `npx astro check` → `npm test` → `npm run build` (build keeps its
`SUPABASE_URL`/`SUPABASE_KEY` env). `astro check` runs after `astro sync` (types
generated). `npm test` here is expected to run only the unconditional unit files;
the gated suites are the heavy job's responsibility (Phase 2). Triggers stay
push + PR to `main`.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Typecheck passes: `npx astro check`
- Unit tests pass locally with no Supabase env: `npm test` (gated suites skip, three unconditional files run)
- Build passes: `npm run build`
- Workflow file is valid YAML / parses: `npx --yes @action-validator/cli .github/workflows/ci.yml` (or equivalent)

#### Manual Verification:

- A pushed PR shows the `quality` job running typecheck + unit steps, both green
- Introducing a type error turns the `quality` job red on the `astro check` step
- Introducing a failing unit assertion turns the `quality` job red on `npm test`

**Implementation Note**: After this phase and all automated verification passes,
pause for manual confirmation that the `quality` job behaves as expected on a real
PR before proceeding.

---

## Phase 2: Supabase-backed integration heavy gate

### Overview

Add a second CI job that stands up local Supabase, materializes `.env` from secrets,
applies migrations, asserts the env is present (fail-fast), and runs the gated
integration suites — so cross-account isolation, persistence, handler/service
ownership, and API gating actually execute in CI instead of skipping.

### Changes Required:

#### 1. New `SUPABASE_SERVICE_ROLE_KEY` repository secret

**File**: GitHub repository secrets (out-of-band, not a file) — documented in the plan.

**Intent**: The seeding/teardown admin client (`adminClient()`, `test/helpers/supabase.ts:53-57`)
needs the service-role key, which CI does not currently have. For a **local**
`supabase start`, the service-role key is the well-known local dev key, so a real
secret may be unnecessary if the job reads keys from `supabase start` output — but
record the decision explicitly in the workflow.

**Contract**: Either (a) the heavy job derives all three keys from `supabase start`
status output (preferred for local CLI — no secret to rotate), or (b) a
`SUPABASE_SERVICE_ROLE_KEY` secret is added. The plan's default is (a); the job must
not hardcode keys inline.

#### 2. CI workflow — `integration` job

**File**: `.github/workflows/ci.yml`

**Intent**: Add a job that installs deps, starts local Supabase via the CLI, applies
migrations, writes `.env` from the local keys + `OPENROUTER_MOCK=true`, runs the
CI-env guard, then `npm test`. Runs on the same triggers as `quality`.

**Contract**: Job steps: `checkout` → `setup-node@22` (npm cache) → `npm ci` →
`supabase start` (or `supabase db reset` to ensure migrations) → capture local URL +
anon + service-role keys → write `.env` (`SUPABASE_URL`, `SUPABASE_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_MOCK=true`) → fail-fast guard step →
`npm test`. The job sets `CI` (GitHub Actions sets it automatically). It is a
**required** check on PRs.

#### 3. CI fail-fast env guard

**File**: `test/ci-guard.ts` (new) or an inline workflow step

**Intent**: Prevent the green-but-hollow trap. When running under CI, if
`hasTestEnv()` is false, exit non-zero with a clear message naming the missing vars —
before any suite runs. Local dev (no `CI`) is unaffected and keeps skipping cleanly.

**Contract**: A guard that reads `process.env.CI` and the exported `hasTestEnv()`
from `test/helpers/supabase.ts`; `CI && !hasTestEnv()` → `process.exit(1)` with a
message. Wired as a CI step before `npm test` (e.g. `node --import tsx test/ci-guard.ts`
or a `package.json` script), or as a `globalSetup`/first test that throws under CI.
Prefer a standalone step so the failure is unambiguous in the job log.

### Success Criteria:

#### Automated Verification:

- With local Supabase running + `.env` populated, the gated suites RUN (not skip): `npm test` reports the RLS / handler / persistence / api-gating files as passed, not skipped
- The fail-fast guard exits non-zero when `CI=1` and a Supabase var is unset: `CI=1 SUPABASE_SERVICE_ROLE_KEY= node ... test/ci-guard.ts` returns exit code 1
- The guard is a no-op locally without `CI`: running it with `CI` unset exits 0
- Migrations apply cleanly in a fresh DB: `npx supabase db reset` succeeds and the `flashcards` table + RLS policies exist
- Full suite passes against local Supabase: `npm test` exits 0 with no skipped gated suites

#### Manual Verification:

- A pushed PR shows the `integration` job standing up Supabase and running the gated suites green
- Removing/blanking the service-role key (or any of the three) turns the `integration` job red on the guard step — never green-with-skips
- Breaking an RLS policy in the migration turns the `integration` job red on the cross-account test

**Implementation Note**: After this phase and all automated verification passes,
pause for manual confirmation that the heavy job runs the gated suites (not skips
them) and that dropping a secret produces a red build, before proceeding.

---

## Phase 3: Critical-flow e2e

### Overview

Author the single browser-level spec for the value path
(paste→generate→accept→export→cleanup), then wire `npm run e2e` into the heavy job so
a broken critical flow blocks the merge. Reuses the Phase 2 Supabase setup and
`OPENROUTER_MOCK`.

### Changes Required:

#### 1. Critical-flow e2e spec

**File**: `tests/e2e/critical-flow.spec.ts` (new)

**Intent**: Prove the end-to-end value path works in a real browser, crossing
auth → routing → generate API (mock) → accept/persist (RLS) → export (real file
download). Mirror `seed.spec.ts` conventions exactly: role-based locators,
wait-for-state, timestamp-unique data, per-test cleanup, risk-tied name. This is the
one risk that genuinely needs a browser (a real download cannot be proven below e2e).

**Contract**: One `test(...)` using `test.use({ storageState: "tests/e2e/.auth/user.json" })`
(the auth.setup session). Steps, per the research UI map:

1. `goto("/generate")`; fill `getByRole("textbox", { name: "Paste foreign language text here…" })` (ellipsis char).
2. Click `getByRole("button", { name: "Generate" })`; assert a mock candidate renders — `getByText("ephemeral")`.
3. Click that candidate's `getByRole("button", { name: "Accept" })`; assert `getByText("✓ Saved")`.
4. `goto("/collection")`, `waitForResponse` on `GET /api/flashcards` (hydration gate, mirroring `seed.spec.ts:51-55`); click `getByRole("button", { name: "Export to Anki" })` (enabled only with ≥1 card — accept happened first). Capture the download via `page.waitForEvent("download")`; assert `download.suggestedFilename()` matches `/^anki-export-\d{4}-\d{2}-\d{2}\.txt$/`.
5. Cleanup: delete the accepted card via `/collection` (`Delete` → `getByRole("dialog", { name: "Delete flashcard?" })` → its `Delete`), mirroring `seed.spec.ts:78-84`.

No `page.waitForTimeout`; no CSS/testid/XPath locators. (Drive via `/10x-e2e` if
preferred — same spec, same conventions.)

#### 2. CI workflow — add e2e to the heavy job

**File**: `.github/workflows/ci.yml`

**Intent**: Run the e2e in the same job that already has Supabase up + `.env`
written, after the integration tests. Install Playwright browsers, then `npm run e2e`.
Upload the Playwright HTML report / trace as an artifact on failure.

**Contract**: Add to the heavy job, after `npm test`: `npx playwright install --with-deps
chromium` → `npm run e2e`. The job already wrote `.env` with `OPENROUTER_MOCK=true`
(Phase 2), so generation is deterministic and no OpenRouter secret is needed. The
e2e gate is **blocking** and runs on every PR + push to `main`. On failure, upload
`playwright-report/` via `actions/upload-artifact`.

### Success Criteria:

#### Automated Verification:

- The spec passes locally against the dev server with `OPENROUTER_MOCK=true`: `npm run e2e` (with local Supabase up) exits 0
- The spec uses only role/label/text locators and wait-for-state (no `waitForTimeout`, no CSS/testid): grep confirms
- The download assertion fires: the test captures a `download` event and the filename matches the date pattern
- Linting passes on the new spec: `npm run lint`

#### Manual Verification:

- A pushed PR shows the e2e step running in the heavy job and going green
- Breaking the value path (e.g. disabling the Accept handler) turns the heavy job red on the e2e step
- On a forced failure, the Playwright report artifact is attached to the run
- The accepted row is cleaned up — re-running the spec leaves no residue (per-run user isolation)

**Implementation Note**: After this phase and all automated verification passes,
pause for manual confirmation that the e2e runs and blocks correctly on a real PR
before proceeding.

---

## Phase 4: Backport test-plan.md corrections

### Overview

Correct the factually-wrong §5 claim, document the Supabase-in-CI + skip-guard
requirement, fill the §6.3 e2e cookbook with the pattern this phase established, and
flip the Phase 3 rollout row to `complete`.

### Changes Required:

#### 1. §5 typecheck correction + gate notes

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the false "lint + typecheck already run in CI" line with the
truth, and note that the unit+integration gate requires Supabase-in-CI + the
service-role key + the fail-fast skip-guard.

**Contract**: §5 line 149 changes from "lint + typecheck already run in CI" to "lint
runs in CI; typecheck (`astro check`), the unit+integration gates, and the e2e gate
are wired by rollout Phase 3 (this change)." Add a sentence under the gates table
noting the integration gate stands up Supabase via the CLI + writes `.env` from keys

- a CI fail-fast guard so the gate cannot pass while skipping. No file anchors added
  (test-plan principle #3).

#### 2. §6.3 e2e cookbook

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the `TBD` §6.3 with the concrete pattern: storageState from
auth.setup, role-based locators, `OPENROUTER_MOCK` determinism, hydration
`waitForResponse` gate, download capture, per-run-user cleanup — pointing at
`critical-flow.spec.ts` and `seed.spec.ts` as the canonical examples.

**Contract**: §6.3 changes from "TBD — see §3 Phase 3" to a filled sub-section
mirroring the depth of §6.2/§6.4/§6.5, referencing `tests/e2e/critical-flow.spec.ts`
and the auth.setup/teardown + webServer infra.

#### 3. §3 status + §6.6 phase note

**File**: `context/foundation/test-plan.md`

**Intent**: Flip the Phase 3 rollout row Status to `complete` and append a 2–3 line
§6.6 note on anything surprising (the `.env`-from-secrets requirement; the fail-fast
guard pattern).

**Contract**: §3 Phase 3 row Status `change opened` → `complete`. §6.6 gains a
"Phase 3 (quality-gates wiring)" bullet. Header "Last updated" line refreshed to
note Phase 3 complete.

#### 4. change.md status

**File**: `context/changes/testing-quality-gates-wiring/change.md`

**Intent**: Reflect completion.

**Contract**: `status: planned` after this plan lands (set by `/10x-plan`), then
`complete` after Phase 4 (set by `/10x-implement`); `updated:` stamped.

### Success Criteria:

#### Automated Verification:

- The false §5 claim is gone: `grep -n "typecheck already run in CI" context/foundation/test-plan.md` returns nothing
- §6.3 no longer reads TBD: `grep -n "6.3" context/foundation/test-plan.md` context shows filled content, not "TBD — see §3 Phase 3"
- §3 Phase 3 Status reads `complete`
- Markdown formats cleanly: `npm run format` leaves test-plan.md unchanged (or only its own edits)

#### Manual Verification:

- §5 now accurately describes which gates run where after this phase
- §6.3 gives a next contributor enough to write a new e2e without re-deriving the pattern
- The Phase 3 row and §6.6 reflect what actually shipped

**Implementation Note**: This is the closing documentation phase; after automated
verification, a quick human read-through of the edited §5/§6.3 confirms accuracy.

---

## Testing Strategy

### Unit Tests:

- No new unit tests. Phase 1 wires the existing unconditional unit files
  (`anki-export`, `generate-service`, `middleware-gating`) into the `quality` gate.

### Integration Tests:

- No new integration tests. Phase 2 makes the existing gated suites (RLS, handler
  ownership, srs-service, api-gating, persistence round-trip, generate-route) run in
  CI against a real Supabase instead of skipping.

### Manual Testing Steps:

1. Open a throwaway PR to `main`; confirm both `quality` and `integration-e2e` jobs run.
2. Push a type error → `quality` red on `astro check`; revert.
3. Push a failing unit assertion → `quality` red on `npm test`; revert.
4. Blank the service-role secret (or break `.env` write) → heavy job red on the guard
   step, NOT green-with-skips; restore.
5. Break an RLS policy → heavy job red on the cross-account test; revert.
6. Break the value path (e.g. disable Accept) → heavy job red on the e2e step; revert.
7. Confirm the e2e cleans up its row (re-run leaves no residue).

## Performance Considerations

- The `quality` job pays no Supabase cost — fast PR feedback on the common failure.
- The heavy job pays one `supabase start` cold-start (~60–90s, Docker image pull)
  shared by integration + e2e. `npm ci` runs in both jobs; the npm cache mitigates.
- `retries:2` in CI (existing Playwright config) absorbs e2e flake without re-running
  the whole job.

## Migration Notes

- The `flashcards` schema migration (`supabase/migrations/20260527000000_flashcard_schema.sql`)
  must be applied in CI before the gated suites run — `supabase start` / `db reset`
  handles this. No data migration; CI uses a fresh ephemeral DB per run.

## References

- Research: `context/changes/testing-quality-gates-wiring/research.md`
- Test plan: `context/foundation/test-plan.md` (§5 gates, §6.3 cookbook, §3 Phase 3)
- Exemplar e2e: `tests/e2e/seed.spec.ts`; auth infra: `tests/e2e/auth.setup.ts`, `auth.teardown.ts`
- Skip-gate mechanism: `test/helpers/supabase.ts:20-50`
- Env loading: `vitest.config.ts:8`, `playwright.config.ts:7-11`
- Determinism: `src/lib/services/generate.ts:22-32` (`OPENROUTER_MOCK`)
- Prior intent (deferral to Phase 3): `context/archive/2026-06-01-testing-runner-bootstrap-authz/plan.md`, `context/archive/2026-06-03-testing-generation-integrity/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Static + unit fast gate

#### Automated

- [x] 1.1 Lint passes: `npm run lint` — 8602954
- [x] 1.2 Typecheck passes: `npx astro check` — 8602954
- [x] 1.3 Unit tests pass locally with no Supabase env: `npm test` (gated suites skip, three unconditional files run) — 8602954
- [x] 1.4 Build passes: `npm run build` — 8602954
- [x] 1.5 Workflow file is valid YAML / parses — 8602954

#### Manual

- [ ] 1.6 Pushed PR shows the `quality` job running typecheck + unit steps, both green
- [ ] 1.7 Introducing a type error turns `quality` red on `astro check`
- [ ] 1.8 Introducing a failing unit assertion turns `quality` red on `npm test`

### Phase 2: Supabase-backed integration heavy gate

#### Automated

- [x] 2.1 Gated suites RUN (not skip) with local Supabase + `.env`: `npm test` reports them passed, not skipped — 876ff9e
- [x] 2.2 Fail-fast guard exits non-zero when `CI=1` and a Supabase var is unset — 876ff9e
- [x] 2.3 Guard is a no-op locally without `CI` (exits 0) — 876ff9e
- [x] 2.4 Migrations apply cleanly: `npx supabase db reset` succeeds, table + RLS policies exist — 876ff9e
- [x] 2.5 Full suite passes against local Supabase: `npm test` exits 0 with no skipped gated suites — 876ff9e

#### Manual

- [ ] 2.6 Pushed PR shows the `integration` job running gated suites green
- [ ] 2.7 Dropping/blanking a Supabase secret turns the job red on the guard step (not green-with-skips)
- [ ] 2.8 Breaking an RLS policy turns the job red on the cross-account test

### Phase 3: Critical-flow e2e

#### Automated

- [x] 3.1 Spec passes locally with `OPENROUTER_MOCK=true` + local Supabase: `npm run e2e` exits 0
- [x] 3.2 Spec uses only role/label/text locators + wait-for-state (no `waitForTimeout`, no CSS/testid)
- [x] 3.3 Download assertion fires; filename matches the date pattern
- [x] 3.4 Linting passes on the new spec: `npm run lint`

#### Manual

- [ ] 3.5 Pushed PR shows the e2e step running in the heavy job, green
- [ ] 3.6 Breaking the value path turns the heavy job red on the e2e step
- [ ] 3.7 On forced failure, the Playwright report artifact is attached
- [ ] 3.8 Accepted row is cleaned up — re-run leaves no residue

### Phase 4: Backport test-plan.md corrections

#### Automated

- [ ] 4.1 False §5 claim gone: `grep -n "typecheck already run in CI" context/foundation/test-plan.md` returns nothing
- [ ] 4.2 §6.3 no longer reads TBD
- [ ] 4.3 §3 Phase 3 Status reads `complete`
- [ ] 4.4 Markdown formats cleanly: `npm run format`

#### Manual

- [ ] 4.5 §5 accurately describes which gates run where after this phase
- [ ] 4.6 §6.3 gives a contributor enough to write a new e2e without re-deriving the pattern
- [ ] 4.7 Phase 3 row + §6.6 reflect what shipped
