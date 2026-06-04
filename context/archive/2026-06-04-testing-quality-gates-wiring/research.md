---
date: 2026-06-04T17:10:31+0200
researcher: mariuszborek
git_commit: ae111862d44e4de96bde65996d621796356e537b
branch: main
repository: 10xCards
topic: "Ground rollout Phase 3 (Quality-gates wiring): what gates exist vs. what CI must add"
tags: [research, codebase, ci, quality-gates, vitest, playwright, supabase, e2e]
status: complete
last_updated: 2026-06-04
last_updated_by: mariuszborek
---

# Research: Phase 3 — Quality-gates wiring

**Date**: 2026-06-04T17:10:31+0200
**Researcher**: mariuszborek
**Git Commit**: ae111862d44e4de96bde65996d621796356e537b
**Branch**: main
**Repository**: 10xCards

## Research Question

Ground rollout Phase 3 of `context/foundation/test-plan.md` ("Quality-gates
wiring"). Determine **what gates run today vs. what Phase 3 must add** to lock
the floor in CI (lint, typecheck, unit+integration) plus one e2e on the
critical flow (paste→generate→accept→export). Verify the test plan's response
guidance and flag any §2/§5 corrections.

## Summary

The protections from Phases 1–2 exist as **real tests**, but **none of them
guard a merge today** — the CI workflow runs only `lint` + `build`. Phase 3 is
almost entirely net-new CI wiring, not test authoring. Four findings drive the
plan:

1. **CI runs lint + build only** (`.github/workflows/ci.yml:18-24`). It does
   **not** run `astro check` (typecheck), `npm test`, or e2e. So today there is
   **no test gate at all**.

2. **The test plan's §5 claim is false.** `test-plan.md:149` states "lint +
   typecheck already run in CI" — typecheck (`astro check`) is **not** in
   `ci.yml`. `astro build` does not run `astro check`. → **backport correction**.

3. **A naive `npm test` step in CI would be green-but-hollow.** Of 10 test
   files, **7 silently skip** when Supabase is unreachable (the auth/RLS/
   persistence spine), because `isSupabaseReachable()` swallows the
   missing-env / unreachable cases and returns `false` → `describe.skipIf`
   marks the suite _skipped, not failed_. The command exits 0. To make the
   integration gate mean anything, **Phase 3 must stand up Supabase in CI** and
   add a guard so the suite **fails** (not skips) when env is absent in CI.

4. **The critical-flow e2e does not exist yet.** `tests/e2e/seed.spec.ts` covers
   Risk #4 (manual add → reload) only. The paste→generate→accept→export spec
   must be written. The infra to support it is fully in place: `OPENROUTER_MOCK=true`
   in `.env` makes `npm run dev` serve deterministic candidates with no network
   call, and the Playwright setup/chromium/cleanup projects already seed + sign
   in a user. e2e in CI **also** needs Supabase (auth.setup uses the service-role key).

The cheapest-layer hypotheses in §2 hold. The one genuinely browser-level risk
(the full value path, incl. a real file download) is the e2e's job; everything
else is already covered by the existing unit/integration suite and only needs a
CI gate wrapped around it.

## Detailed Findings

### A. Current CI — lint + build only

`.github/workflows/ci.yml`:

- Triggers: push + PR to `main` (`ci.yml:3-7`).
- Steps: `actions/checkout@v4` → `setup-node@v4` (node 22, npm cache) → `npm ci`
  → `npx astro sync` → `npm run lint` → `npm run build` (with `SUPABASE_URL` /
  `SUPABASE_KEY` secrets for the build) (`ci.yml:13-24`).
- **Absent**: `npx astro check`, `npm test`, any Playwright step, and the
  `SUPABASE_SERVICE_ROLE_KEY` secret.

Available scripts (`package.json:5-20`): `lint`, `typecheck` (=`astro check`),
`test` (=`vitest run`), `test:watch`, `e2e` (=`playwright test`), `e2e:ui`,
`e2e:report`. So the commands Phase 3 needs already exist as npm scripts; only
the CI invocation is missing.

### B. Typecheck gap (§5 correction)

- `package.json:12` — `"typecheck": "astro check"`.
- `ci.yml` never invokes it; `npm run build` = `astro build` (`package.json:7`),
  which generates types via `astro sync` but does **not** run the `astro check`
  diagnostic pass.
- `test-plan.md:149` asserts "lint + typecheck already run in CI" — **incorrect**.
  Only lint runs. Phase 3 adds `npx astro check` (after `astro sync`, which CI
  already does) and the §5 / §6.6 text should be corrected to match.

### C. Unit+integration suite — what runs in a bare CI runner

Gate mechanism: each integration file resolves `const reachable = await
isSupabaseReachable()` at top-level await, then wraps its suite in
`describe.skipIf(!reachable)(...)`.

- `test/helpers/supabase.ts:20-22` — `hasTestEnv()` requires **all three** of
  `SUPABASE_URL`, `SUPABASE_KEY` (read as the anon key — note the env-name vs
  internal-name mismatch, `supabase.ts:16`), `SUPABASE_SERVICE_ROLE_KEY`.
- `test/helpers/supabase.ts:29-50` — `isSupabaseReachable()`: returns `false`
  if env missing (`:30-36`, before any network call) **and** returns `false` on
  any fetch failure / non-200 / 2s timeout (`:44-49`, caught). **Never throws.**
- Result: with no env, `npm test` **PASSES** with the gated suites skipped.

| Test file                                       | In CI w/o Supabase | Signal                                                                         |
| ----------------------------------------------- | ------------------ | ------------------------------------------------------------------------------ |
| `test/output-safety/anki-export.test.ts`        | **RUNS**           | #7 CSV formula-injection (pure)                                                |
| `test/generation/generate-service.test.ts`      | **RUNS**           | #5/#3 generation failure + transient-input (fetch stubbed, `astro:env` mocked) |
| `test/authz/middleware-gating.test.ts`          | **RUNS**           | #6 page-gating redirect (Supabase factory mocked)                              |
| `test/rls/flashcards-rls.test.ts`               | **SKIP**           | **#2 RLS cross-account — the load-bearing security test**                      |
| `test/authz/flashcards-handler.test.ts`         | **SKIP**           | #1 handler ownership (GET returns only caller's rows)                          |
| `test/authz/srs-service.test.ts`                | **SKIP**           | #1 service-layer ownership                                                     |
| `test/authz/api-gating.test.ts`                 | **SKIP**           | #6 API self-gate → 401                                                         |
| `test/persistence/flashcards-roundtrip.test.ts` | **SKIP**           | #4 create+list round-trip, no silent loss                                      |
| `test/generation/generate-route.test.ts`        | **SKIP**           | #5 real-handler HTTP status (needs `getUser()`)                                |
| `test/smoke.test.ts`                            | **SKIP**           | seed-harness sanity                                                            |

So a bare-runner `npm test` exercises injection-escaping, generation error
mapping, and page redirects — but **zero cross-account isolation, zero
handler/service ownership, zero API auth-gating, zero persistence**. The
authorization spine (Risks #1/#2/#4) evaporates with only `console.warn` lines.

**Coverage**: `@vitest/coverage-v8@^4.1.8` is installed (`package.json:50`) but
**never configured** — no `coverage` block in `vitest.config.ts`, no `--coverage`
on either test script. `npm test` produces no coverage report today.

### D. Making the integration gate real in CI

To run the gated suites in CI, the runner must provide a reachable Supabase plus
all three env vars and the migrated schema:

- The `supabase` CLI is already a devDependency (`package.json:64`), so a
  `supabase start` step (or a Postgres+GoTrue service container) is feasible.
- Migrations must be applied so the `flashcards` table + per-operation RLS
  policies exist (`supabase/migrations/20260527000000_flashcard_schema.sql`) —
  the cross-account tests query real rows.
- **New secret required**: `SUPABASE_SERVICE_ROLE_KEY` (used by `adminClient()`
  to seed/delete users, `supabase.ts:53-57`) — not present in current CI.
- **Silent-skip guard (important)**: even with Supabase up, a mis-wired env var
  re-hollows the gate to green. Phase 3 should make CI **fail** when
  `hasTestEnv()` is false (e.g. a `CI && !hasTestEnv → exit 1` assertion, or
  assert a non-zero count of gated suites actually ran). Otherwise a future
  env regression silently disables the security gate.

Prior intent confirms this was deliberately deferred, not decided:

- Phase 1 plan: "integration gate stays ad hoc (not on every commit) … until
  rollout Phase 3 wires CI"; "skips with a clear message when the DB is
  unreachable rather than failing spuriously".
- Phase 1 plan: "Not wiring CI gates or e2e — rollout Phase 3."
- Phase 2 plan: "No e2e / CI gate wiring — that is Phase 3 of the rollout."

### E. The critical-flow e2e

**Does not exist.** `tests/e2e/seed.spec.ts` is the lone spec and covers only
Risk #4: `"manually added flashcard survives a page reload"` (add → reload →
delete). No generate / accept / export path. §6.3 cookbook is still `TBD`.

Infra in place (all under `tests/e2e/`):

- `auth.setup.ts` — seeds a confirmed user via the service-role admin API
  (`seedUser()`), signs in via `POST /api/auth/signin` (needs `Origin` header
  for CSRF, `maxRedirects:0`), writes storageState to `tests/e2e/.auth/user.json`
  and the user id to `.auth/seed-user.json`.
- `auth.teardown.ts` — `deleteUser(id)` (CASCADE drops flashcards), removes the
  seed-record file.
- `playwright.config.ts` — `testDir: tests/e2e`; projects `setup` → `chromium`
  (storageState, `dependencies:["setup"]`) → `cleanup` teardown; `webServer:
npm run dev` on `http://localhost:4321`, `reuseExistingServer` locally,
  `retries:2` + `forbidOnly` in CI; `trace:on-first-retry`.

**Determinism**: `OPENROUTER_MOCK=true` is present in `.env` (verified). The
service short-circuits before any fetch and returns three static candidates —
`ephemeral`, `serendipity`, `ubiquitous` (`src/lib/services/generate.ts:22-32`).
`npm run dev` (the e2e webServer) reads `.env` at the Node runtime, so the mock
is genuinely in effect — no test-side env trickery (the §6.5 "inlined at
vite-config time" caveat is scoped to the Vitest harness, not the dev server).

**UI map for the spec** (two protected pages, `/generate` + `/collection`, both
in `PROTECTED_ROUTES` `src/middleware.ts:4`; inputs derive their accessible name
from placeholder, buttons from text):

1. **Paste** — `/generate` → `GenerateView.tsx`: `getByRole("textbox", { name:
"Paste foreign language text here…" })` (ellipsis char).
2. **Generate** — `getByRole("button", { name: "Generate" })`; POSTs
   `/api/flashcards/generate`; candidates render as `CandidateCard`s (no list
   role) — assert `getByText("ephemeral")`.
3. **Accept** — per-card `getByRole("button", { name: "Accept" })` (no bulk);
   POSTs `/api/flashcards`; card re-renders with `getByText("✓ Saved")`.
4. **Export** — `/collection` → `getByRole("button", { name: "Export to Anki" })`
   (**disabled until ≥1 card exists** — must accept first); `GET
/api/flashcards/export` triggers a real browser download. Assert via
   `page.waitForEvent("download")` → `download.suggestedFilename()` matches
   `/^anki-export-\d{4}-\d{2}-\d{2}\.txt$/`, optionally read contents for the
   accepted word.
5. **Cleanup** — the accepted card persisted a real row; delete via `/collection`
   (`Delete` button → dialog `getByRole("dialog", { name: "Delete flashcard?" })`),
   mirroring `seed.spec.ts:78-84`.

**Hydration gotcha**: islands fetch data in `useEffect`; after `goto("/collection")`
wait for `GET /api/flashcards` (`waitForResponse`) before interacting — the seed
spec does exactly this (`seed.spec.ts:51-55`).

**e2e in CI also needs Supabase** + `SUPABASE_SERVICE_ROLE_KEY` (auth.setup
seeds via admin API). Same dependency as the integration gate, so both gates
share one Supabase-in-CI decision. No OpenRouter secret needed (mock mode).

### F. Conventions to mirror (from the seed spec)

Role-based locators (`getByRole`/`getByPlaceholder`, never CSS/testid),
wait-for-state (`toBeVisible`/`waitForResponse`/`waitForEvent`, never
`waitForTimeout`), timestamp-unique data, per-test cleanup, risk-tied test name.
`.gitignore` already ignores `tests/e2e/.auth/`, `test-results/`,
`playwright-report/`, `blob-report/`, `playwright/.cache/`, `.playwright-cli/`.

## Code References

- `.github/workflows/ci.yml:18-24` — current CI steps (lint + build only)
- `package.json:5-20` — npm scripts (typecheck/test/e2e exist)
- `package.json:50,64` — `@vitest/coverage-v8` installed (unused), `supabase` CLI devDep
- `test/helpers/supabase.ts:20-22` — `hasTestEnv()` requires three env vars
- `test/helpers/supabase.ts:29-50` — `isSupabaseReachable()` swallows errors → skip-not-fail
- `vitest.config.ts:8,13-21` — `loadEnv("test", …, "")`, `test.env`, no coverage block
- `src/lib/services/generate.ts:22-32` — `OPENROUTER_MOCK` short-circuit + `MOCK_CANDIDATES`
- `src/middleware.ts:4` — `PROTECTED_ROUTES` includes `/generate`, `/collection`
- `tests/e2e/seed.spec.ts` — exemplar spec (Risk #4 only); conventions to mirror
- `tests/e2e/auth.setup.ts`, `auth.teardown.ts` — seed/sign-in/cleanup infra
- `playwright.config.ts:16,27-49` — testDir, projects, webServer
- `src/components/generate/GenerateView.tsx`, `collection/CollectionView.tsx`,
  `generate/CandidateCard.tsx` — critical-flow UI targets
- `test-plan.md:149` — **incorrect** "lint + typecheck already run in CI" claim

## Architecture Insights

- **Tests exist; gates don't.** Phase 3 is CI plumbing, not test authoring —
  except the one missing critical-flow e2e spec.
- **One Supabase-in-CI decision unlocks both the integration gate and e2e.**
  Both depend on a reachable Supabase + service-role key + migrated schema.
- **The reachability gate is a double-edged sword**: great for local dev (skip
  cleanly), dangerous in CI (green while testing nothing). The fix is not to
  remove the gate but to make CI assert that it _didn't_ trip.
- **Determinism is already solved for generation** via `OPENROUTER_MOCK`; the
  e2e needs no network and no OpenRouter secret.

## Historical Context (from prior changes)

- `context/archive/2026-06-01-testing-runner-bootstrap-authz/plan.md` — integration
  gate intentionally ad-hoc until Phase 3; "Not wiring CI gates or e2e — rollout Phase 3."
- `context/archive/2026-06-03-testing-generation-integrity/plan.md` — "No e2e / CI
  gate wiring — that is Phase 3 of the rollout (Quality-gates wiring)."
- `context/foundation/test-plan.md` §5 — gates table; §6.5 — generation cookbook
  incl. the `OPENROUTER_MOCK` inlining caveat (Vitest-scoped).

## Backport corrections to `test-plan.md` (for `/10x-test-plan`)

These are §5/§6 text corrections, **no file anchors added** (principle #3 holds):

1. **§5 line 149 is false** — "lint + typecheck already run in CI" should read
   "lint runs in CI; typecheck (`astro check`) and the test gates are wired by
   this phase." Typecheck is currently **not** in CI.
2. **§5 unit+integration gate** — note the wiring requires Supabase-in-CI +
   `SUPABASE_SERVICE_ROLE_KEY` + a silent-skip guard, else the gate is hollow.

## Related Research

- `context/archive/2026-06-01-testing-runner-bootstrap-authz/research.md` — Risk
  #1/#2/#6 grounding (RLS-sole endpoints, API self-gate vs middleware).
- `context/archive/2026-06-03-testing-generation-integrity/research.md` —
  generation-path mock + transient-input grounding.

## Open Questions

1. **Supabase-in-CI mechanism**: `supabase start` (CLI already a devDep, simplest,
   ~slow cold start) vs a Postgres+GoTrue service container (faster, more wiring)?
   → `/10x-plan` decides; both make the gate real.
2. **Run integration + e2e on every PR, or split** (fast unit gate on every PR;
   integration+e2e on a heavier job)? Cost × signal vs CI latency.
3. **Coverage**: wire `--coverage` now (dep is installed) or defer? No threshold
   is defined; turning it on without a gate is low-value.
4. **e2e scope discipline**: keep to the single value-path spec (cost × signal);
   do not re-test what integration already covers.
