# Quality-gates wiring — Plan Brief

> Full plan: `context/changes/testing-quality-gates-wiring/plan.md`
> Research: `context/changes/testing-quality-gates-wiring/research.md`

## What & Why

Rollout Phase 3 of the test plan: lock the Phase 1–2 protections (authorization,
RLS, transient-input, silent-loss, generation failure paths, auth gating,
output-safety) as **required CI gates**, and add the one browser-level e2e on the
critical user flow. Today nothing guards a merge — CI runs only `lint` + `build`, so
every protection that shipped can silently regress to production. This phase is
almost entirely net-new CI plumbing, not test authoring.

## Starting Point

`.github/workflows/ci.yml` runs `checkout → setup-node → npm ci → astro sync → lint
→ build` and nothing else. The unit/integration suites exist and pass, but a naive
`npm test` in CI exits 0 while **7 of 10 files skip** (the whole auth/RLS/persistence
spine) because they `skipIf` when Supabase is unreachable. The critical-flow e2e
doesn't exist; only a Risk-#4 seed spec does. All e2e infra (auth setup/teardown,
Playwright projects, `OPENROUTER_MOCK` determinism) is already in place.

## Desired End State

Every PR to `main` runs two required jobs: a fast `quality` gate (lint + typecheck +
build + unit, no Supabase) and a heavy `integration-e2e` gate (local Supabase via the
CLI → migrations → integration suites → critical-flow e2e). A dropped or mis-wired
secret makes the heavy job **fail**, never silently skip. `test-plan.md` §5/§6.3
reflects reality and the Phase 3 rollout row reads `complete`.

## Key Decisions Made

| Decision          | Choice                             | Why (1 sentence)                                                                             | Source   |
| ----------------- | ---------------------------------- | -------------------------------------------------------------------------------------------- | -------- |
| Supabase in CI    | `supabase` CLI `start`             | Already a devDep; identical to local dev, applies the real RLS migration the tests need.     | Plan     |
| Job layout        | Split fast + heavy                 | Fast lint/type/unit feedback without paying Supabase cold-start; clear which gate failed.    | Plan     |
| Skip-guard        | Fail-fast on `CI && !hasTestEnv()` | Cheap, unambiguous; reuses the existing `hasTestEnv()` and keeps local dev skipping cleanly. | Plan     |
| Coverage          | Defer                              | No threshold defined; a report nobody gates on is low-value noise.                           | Plan     |
| Heavy-job trigger | Every PR + push to main            | Matches §5 ("required on PR"); the gate actually blocks merges that break the value path.    | Plan     |
| Backport scope    | Targeted                           | Fix the false §5 line, fill §6.3, flip status — nothing more (matches research).             | Research |

## Scope

**In scope:** typecheck in CI; unit gate (fast job); Supabase-backed integration gate
(heavy job) with `.env`-from-secrets + fail-fast guard; one critical-flow e2e spec
wired into CI; `test-plan.md` §5/§6.3/§3 backport.

**Out of scope:** coverage wiring; any new test beyond the one e2e; re-testing at e2e
what integration covers; render-XSS DOM test (deferred); hosted Supabase in CI;
freshness-ledger rewrite.

## Architecture / Approach

Two CI jobs split by cost. `quality` carries the always-runnable gates for fast
feedback. `integration-e2e` stands up local Supabase once, writes `.env` from the
local keys + `OPENROUTER_MOCK=true` (both Vitest and the e2e dev server read `.env`,
not bare env), asserts `hasTestEnv()` under CI before running, then runs the gated
suites and the e2e against that one instance.

## Phases at a Glance

| Phase                      | What it delivers                                   | Key risk                                                                       |
| -------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1. Static + unit fast gate | typecheck + unit in `ci.yml`, every PR             | None significant — zero-infra                                                  |
| 2. Integration heavy gate  | Supabase-in-CI + fail-fast guard; gated suites run | Green-but-hollow if guard is wrong → mitigated by `CI && !hasTestEnv → exit 1` |
| 3. Critical-flow e2e       | paste→generate→accept→export spec + CI wiring      | e2e flake → `retries:2` + trace; scope creep → single value-path spec only     |
| 4. Backport test-plan.md   | §5 fix, §6.3 cookbook, status → complete           | Low — doc only                                                                 |

**Prerequisites:** local Supabase (`supabase start`, Docker) for verifying Phases 2–3;
a `SUPABASE_SERVICE_ROLE_KEY` source for CI (local-dev key from `supabase start`
output, or a repo secret).
**Estimated effort:** ~2–3 sessions across 4 phases; the bulk is CI workflow iteration
(Phase 2) and authoring/stabilizing the one e2e (Phase 3).

## Open Risks & Assumptions

- `supabase start` in CI needs `supabase/config.toml` in the repo — verify it's present
  before relying on the CLI path.
- The fail-fast guard protects against missing env, not a reachable-but-empty DB;
  applying migrations in the same job keeps that risk low.
- e2e cold-start + browser install adds ~1–2 min to the heavy job — acceptable for a
  blocking value-path gate.

## Success Criteria (Summary)

- A regression in any Phase 1–2 protection (type, unit, RLS, ownership, value path)
  turns a CI job red before merge.
- Dropping a Supabase secret turns the heavy job red — never green-with-skips.
- The critical user flow (paste→generate→accept→export, incl. a real download) is
  proven end-to-end on every PR.
