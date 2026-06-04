# Test Runner Bootstrap + Authorization/RLS Coverage — Plan Brief

> Full plan: `context/changes/testing-runner-bootstrap-authz/plan.md`
> Research: `context/changes/testing-runner-bootstrap-authz/research.md`

## What & Why

Rollout Phase 1 of the test plan: stand up the Vitest integration runner from zero against local Supabase and prove cross-account isolation for the three load-bearing risks — endpoint authorization (#1), the RLS backstop (#2), and middleware/API auth gating (#6). The top risk is both a PRD catastrophe-tier guardrail (data isolation) and a lived incident the author was burned by before.

## Starting Point

No test infrastructure exists at all (no Vitest, no config, no `test/` dir). RLS on `flashcards` is sound and complete, but the app layer is asymmetric: `create/due/review` enforce ownership in code, while `list/update/delete/export` carry no app-layer `user_id` filter and lean entirely on RLS. Middleware guards four page prefixes but no `/api/*` path — endpoints self-guard with their own 401 check.

## Desired End State

`npm test` (with local Supabase running) proves: user B cannot SELECT/UPDATE/DELETE/INSERT against user A's rows at the DB layer; the due/review service paths and a representative list endpoint never cross accounts; an unauthenticated request to a protected API returns 401 with no data while a protected page redirects to `/auth/signin`. The cookbook and a `lessons.md` entry capture the patterns and the RLS-sole gap.

## Key Decisions Made

| Decision               | Choice                                              | Why (1 sentence)                                                                                         | Source   |
| ---------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------- |
| RLS-sole endpoint gap  | Test-only; file the gap                             | Keep Phase 1 a pure test rollout — no behavior change in a test PR; the direct-DB test pins the backstop | Plan     |
| Endpoint coverage seam | RLS test + one representative handler               | Cost×signal — one handler test catches session-wiring without 4× cookie plumbing                         | Plan     |
| RLS exercise path      | Signed-in anon client (PostgREST)                   | Mirrors the exact production SSR path (JWT → PostgREST → `auth.uid()`)                                   | Plan     |
| Test isolation         | Per-run unique emails + teardown                    | Reruns never collide without a slow full DB reset                                                        | Plan     |
| Test credentials       | `.env.example` + `process.env`                      | One documented source, matches existing `.env` pattern, CI-injectable                                    | Plan     |
| Oracle framing         | Assert the cross-account outcome, never query shape | Mirroring the implementation would pass against the RLS-sole gap                                         | Research |

## Scope

**In scope:** Vitest bootstrap (config, scripts, env, seeding harness); RLS denial tests (#2); service-layer + one handler authorization tests (#1); middleware/API gating tests (#6); cookbook + lessons + status sync.

**Out of scope:** Adding `.eq("user_id")` to the four endpoints (filed, not fixed); generation-path tests (#3/#4/#5/#7 — rollout Phase 2); CI gates + e2e (Phase 3); workerd/`wrangler` test runtime; SRS lost-update concurrency (test-plan §7); raw-pg RLS testing.

## Architecture / Approach

Environment first, then risk suites in cost×signal order. The spine is a two-user model: a `service_role` admin client seeds users A and B (unique per-run emails) and tears them down; each assertion runs through a per-user signed-in anon client so the JWT → PostgREST → `auth.uid()` path is exercised as in production. Vitest is configured via `getViteConfig()` from `astro/config` with `environment: "node"` so `@/*` and `astro:env/server` resolve. Handlers are invoked as plain functions with a constructed `APIContext` — no workerd.

## Phases at a Glance

| Phase                  | What it delivers                                                  | Key risk                                                    |
| ---------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------- |
| 1. Runner bootstrap    | Vitest config, scripts, env, two-user seeding harness, smoke test | Cookie/`astro:env` resolution in tests; orphaned seed users |
| 2. RLS backstop (#2)   | B denied SELECT/UPDATE/DELETE/INSERT on A's row                   | False pass if B isn't actually authenticated                |
| 3. Endpoint authz (#1) | Service tests for due/review + one list-handler test              | Mirroring the query shape instead of asserting outcome      |
| 4. Auth gating (#6)    | API 401 + middleware page-redirect; `/api/*` gap documented       | Testing only the page layer and missing the API surface     |
| 5. Cookbook + lessons  | §6 recipes filled, RLS-sole gap filed, §3 status advanced         | Recipes too thin to be reusable                             |

**Prerequisites:** Docker + `npx supabase start` running; local URL/anon/service_role keys copied into `.env`.
**Estimated effort:** ~2–3 sessions across 5 phases (Phase 1 is the bulk of the setup).

## Open Risks & Assumptions

- Integration tests require a running local Supabase; the suite skips (not fails) when it's unreachable, but that means an unguarded CI would skip silently — CI wiring is deferred to rollout Phase 3, so document the ad-hoc gate clearly.
- Per-run email nonce must avoid banned time/random sources in any workflow context — source it from an env var or process identifiers set in `setup.ts`.
- A crashed run can orphan `auth.users`; recovery is a periodic `npx supabase db reset`.

## Success Criteria (Summary)

- `npm test` proves B can never reach A's flashcards at either the app or DB layer.
- An unauthenticated request gets 401 (API) / redirect (page) and never returns data.
- A new contributor can add an integration test by following the §6 cookbook, and the RLS-sole gap is recorded for future review.
