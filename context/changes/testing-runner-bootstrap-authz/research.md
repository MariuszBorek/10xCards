---
date: 2026-06-02T19:42:47+0200
researcher: mariuszborek
git_commit: 58f7818d37a379d828d4bb27014b4a3a46a960f2
branch: main
repository: 10xCards
topic: "Phase 1 test rollout — runner bootstrap + authorization/RLS coverage (Risks #1, #2, #6)"
tags: [research, codebase, testing, authorization, rls, middleware, vitest, supabase]
status: complete
last_updated: 2026-06-02
last_updated_by: mariuszborek
---

# Research: Phase 1 test rollout — runner bootstrap + authorization/RLS coverage

**Date**: 2026-06-02T19:42:47+0200
**Researcher**: mariuszborek
**Git Commit**: 58f7818d37a379d828d4bb27014b4a3a46a960f2
**Branch**: main
**Repository**: 10xCards

## Research Question

Ground Phase 1 of `context/foundation/test-plan.md` before planning tests. Two halves:

1. **Oracle anchoring** for the three risks this phase covers —
   - **#1** a flashcard API endpoint returns/mutates another user's data because ownership is not enforced on that operation;
   - **#2** an RLS policy on `flashcards` is missing/too permissive for one operation, leaking rows at the DB layer;
   - **#6** a middleware change lets an unauthenticated request reach a protected route/API endpoint, or logs users out.
2. **Runner bootstrap** — how to wire Vitest against this Astro 6 / workerd / local-Supabase stack (no test base exists yet), including two-user seeding and the OpenRouter edge mock.

## Summary

**The oracle is clear and — importantly — not what a naive read suggests.**

- **RLS is the load-bearing protection and it is sound.** `flashcards` has RLS enabled with four granular per-operation policies, all `auth.uid() = user_id`, applied in the create-table migration ([20260527000000_flashcard_schema.sql:13-27](https://github.com/MariuszBorek/10xCards/blob/58f7818d37a379d828d4bb27014b4a3a46a960f2/supabase/migrations/20260527000000_flashcard_schema.sql#L13-L27)). No `using (true)`, no anon exposure, no operation left uncovered.
- **The app layer is asymmetric.** Of the user-scoped operations, **only `create`, `due`, and `review` enforce ownership in app code** (explicit `.eq("user_id", …)` or `user_id: user.id` on insert). **`list`, `update`, `delete`, and `export` carry NO app-layer `user_id` filter** — they rely entirely on RLS to scope rows.
- **This is a two-faces situation (per the test-plan's own framing), not a live leak.** With RLS in place, `list`/`update`/`delete`/`export` do **not** cross accounts — RLS filters the rows. The real risk is **single-point-of-failure**: for those four operations RLS is the *only* guard, so a future migration that weakens one policy leaks immediately with nothing in app code to catch it. That is exactly why Phase 1 bundles #1 (prove the outcome — no cross-account access) **and** #2 (exercise RLS *directly* with a second user, because the app path can't be trusted to surface a policy regression for these four ops).
- **The oracle to assert is the OUTCOME, not the implementation shape**: user B can never read or mutate user A's flashcard via any operation, at both the app layer (request as B for A's row → denied/empty) and the DB layer (B's own credentials doing a raw SELECT/UPDATE/DELETE of A's row → denied/empty). Do **not** assert "the handler has a `.eq('user_id')` clause" — that would mirror the implementation and would *pass against the gap* for list/update/delete/export.

- **Risk #6 gap is precise and confirmed**: middleware guards only four **page** prefixes via `startsWith` ([middleware.ts:4,18-22](https://github.com/MariuszBorek/10xCards/blob/58f7818d37a379d828d4bb27014b4a3a46a960f2/src/middleware.ts#L4)). **No `/api/*` path is in `PROTECTED_ROUTES`** — every flashcard API endpoint self-guards with its own `getUser()` 401 check. "Protected pages imply protected APIs" is false here; both layers must be tested independently. Middleware also **fails open** when Supabase env is absent (`user = null`, request proceeds).

- **Runner bootstrap**: zero test infra today. Recommended path — Vitest via `getViteConfig()` from `astro/config` with `environment: "node"` (Astro v6 guidance), two-user seeding against local Supabase (`enable_confirmations = false`, so `signUp` → immediate `signInWithPassword` works), OpenRouter mocked via the **built-in `OPENROUTER_MOCK` toggle** (already in the code) or `vi.stubGlobal("fetch", …)` for the failure branches. **Prefer service-layer tests over handler-context tests for Phase 1** — `srs.ts` functions take a ready Supabase client + userId and sidestep both the cookie seam and any workerd concern.

## Detailed Findings

### Risk #1 — Endpoint authorization / IDOR surface

Auth context is established once in middleware and read by handlers:
- Middleware resolves the user and attaches it: [middleware.ts:9-13](https://github.com/MariuszBorek/10xCards/blob/58f7818d37a379d828d4bb27014b4a3a46a960f2/src/middleware.ts#L9-L13) — `context.locals.user = user ?? null`.
- Type: `User | null` ([env.d.ts:3](https://github.com/MariuszBorek/10xCards/blob/58f7818d37a379d828d4bb27014b4a3a46a960f2/src/env.d.ts#L3)).
- **Note**: handlers do not actually read `locals.user` — each calls `supabase.auth.getUser()` again itself. The session reaching the handler is carried by the request cookies (see Risk #2 SSR chain).

Per-operation ownership-enforcement matrix (all endpoints authenticate with a `getUser()` → 401 check; the column that matters is **app-layer ownership scoping**):

| Operation | Handler | App-layer `user_id` scoping | Backstop | Verdict |
|-----------|---------|------------------------------|----------|---------|
| GET list | [flashcards/index.ts:22](https://github.com/MariuszBorek/10xCards/blob/58f7818d37a379d828d4bb27014b4a3a46a960f2/src/pages/api/flashcards/index.ts#L22) | ❌ none — `select("*")` with no `.eq` | RLS only | **RLS-sole** |
| POST create | [flashcards/index.ts:71](https://github.com/MariuszBorek/10xCards/blob/58f7818d37a379d828d4bb27014b4a3a46a960f2/src/pages/api/flashcards/index.ts#L71) | ✅ `insert({ user_id: user.id, … })` | RLS | safe (belt+suspenders) |
| PATCH update | [flashcards/[id].ts:48-53](https://github.com/MariuszBorek/10xCards/blob/58f7818d37a379d828d4bb27014b4a3a46a960f2/src/pages/api/flashcards/%5Bid%5D.ts#L48-L53) | ❌ `.eq("id", id)` only | RLS only | **RLS-sole** |
| DELETE | [flashcards/[id].ts:84](https://github.com/MariuszBorek/10xCards/blob/58f7818d37a379d828d4bb27014b4a3a46a960f2/src/pages/api/flashcards/%5Bid%5D.ts#L84) | ❌ `.eq("id", id)` only | RLS only | **RLS-sole** |
| GET due | [flashcards/due.ts:22](https://github.com/MariuszBorek/10xCards/blob/58f7818d37a379d828d4bb27014b4a3a46a960f2/src/pages/api/flashcards/due.ts#L22) → [srs.ts:74-80](https://github.com/MariuszBorek/10xCards/blob/58f7818d37a379d828d4bb27014b4a3a46a960f2/src/lib/services/srs.ts#L74-L80) | ✅ `.eq("user_id", userId)` | RLS | safe (belt+suspenders) |
| POST review | [flashcards/[id]/review.ts:45](https://github.com/MariuszBorek/10xCards/blob/58f7818d37a379d828d4bb27014b4a3a46a960f2/src/pages/api/flashcards/%5Bid%5D/review.ts#L45) → [srs.ts:115-140](https://github.com/MariuszBorek/10xCards/blob/58f7818d37a379d828d4bb27014b4a3a46a960f2/src/lib/services/srs.ts#L115-L140) | ✅ both load+update `.eq("user_id", userId)` (+ `reps` optimistic guard) | RLS | safe (belt+suspenders) |
| GET export | [flashcards/export.ts:25-28](https://github.com/MariuszBorek/10xCards/blob/58f7818d37a379d828d4bb27014b4a3a46a960f2/src/pages/api/flashcards/export.ts#L25-L28) | ❌ `select(...)` with no `.eq` | RLS only | **RLS-sole** |
| POST generate | [flashcards/generate.ts](https://github.com/MariuszBorek/10xCards/blob/58f7818d37a379d828d4bb27014b4a3a46a960f2/src/pages/api/flashcards/generate.ts) | N/A — no DB touch | N/A | safe |

**Load-bearing finding for the oracle**: `list`, `update`, `delete`, `export` are *correct only because RLS holds*. The test must prove cross-account denial as an **observable outcome** for these (request as B for A's id/rows → no data / no mutation), and must do so without copying the handler's query shape as the expected value. The four belt-and-suspenders ops (create/due/review) would survive an RLS regression at the app layer, but the four RLS-sole ops would not — which is the bridge to Risk #2.

### Risk #2 — RLS policies on `flashcards`

Two migrations exist; only one table (`flashcards`); no `candidates`/`generations` tables.

Schema + RLS, all in the create migration ([20260527000000_flashcard_schema.sql](https://github.com/MariuszBorek/10xCards/blob/58f7818d37a379d828d4bb27014b4a3a46a960f2/supabase/migrations/20260527000000_flashcard_schema.sql)):
- `user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE` (line 4).
- `ENABLE ROW LEVEL SECURITY` (line 13).
- `select_own` — `FOR SELECT USING (auth.uid() = user_id)` (15-16).
- `insert_own` — `FOR INSERT WITH CHECK (auth.uid() = user_id)` (18-19).
- `update_own` — `FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)` (21-24).
- `delete_own` — `FOR DELETE USING (auth.uid() = user_id)` (26-27).

Second migration ([20260531000000_flashcard_srs_state.sql:4-5](https://github.com/MariuszBorek/10xCards/blob/58f7818d37a379d828d4bb27014b4a3a46a960f2/supabase/migrations/20260531000000_flashcard_srs_state.sql#L4-L5)) adds 10 FSRS columns and **deliberately adds no new policies** — the table-level policies cover new columns. Composite index `idx_flashcards_due(user_id, due)` (line 19) replaces the redundant `idx_flashcards_user_id` (dropped, line 24).

**Coverage verdict**: complete and sound — every operation (SELECT/INSERT/UPDATE/DELETE) has a granular policy, all `auth.uid() = user_id`, no permissive expression, no anon role (policies omit `TO`, defaulting to authenticated). The DB-layer oracle is therefore: *exercise each policy directly with a second user's credentials* and prove A's row is invisible/immutable to B — this is the test that would catch a future migration weakening any one policy, which is the only thing that protects the four RLS-sole endpoints above.

**SSR session → `auth.uid()` chain** (how the policy sees the right user):
1. `createClient(requestHeaders, cookies)` builds a `@supabase/ssr` server client that parses the `Cookie` header — [supabase.ts:5-23](https://github.com/MariuszBorek/10xCards/blob/58f7818d37a379d828d4bb27014b4a3a46a960f2/src/lib/supabase.ts#L5-L23). Returns `null` if `SUPABASE_URL`/`SUPABASE_KEY` absent (line 6-8).
2. The session JWT travels as `Authorization: Bearer <jwt>` to PostgREST, which sets the Postgres `auth.uid()` session var before the query runs. RLS evaluates `auth.uid() = user_id` per row.

### Risk #6 — Middleware auth gating

[middleware.ts](https://github.com/MariuszBorek/10xCards/blob/58f7818d37a379d828d4bb27014b4a3a46a960f2/src/middleware.ts):
- `PROTECTED_ROUTES = ["/dashboard", "/generate", "/review", "/collection"]` (line 4) — **page routes only**.
- Match: `PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))` (line 18). Unauthenticated → `context.redirect("/auth/signin")` (line 20).
- **No `/api/*` entry** → every flashcard API endpoint passes through middleware ungated and relies on its own in-handler `getUser()` → 401.
- **Fail-open**: when `createClient` returns `null` (env absent), `locals.user = null` and the request proceeds (lines 9-16); API handlers then hit "Supabase not configured" rather than a 401.

Session lifecycle (the "logs users out" half):
- Sign-in: `signInWithPassword` then redirect `/` — cookie set via SSR `setAll` ([auth/signin.ts:13,19](https://github.com/MariuszBorek/10xCards/blob/58f7818d37a379d828d4bb27014b4a3a46a960f2/src/pages/api/auth/signin.ts#L13)).
- Sign-out: `signOut` clears the cookie ([auth/signout.ts:5-9](https://github.com/MariuszBorek/10xCards/blob/58f7818d37a379d828d4bb27014b4a3a46a960f2/src/pages/api/auth/signout.ts#L5-L9)).

**Oracle for #6**: assert on **both** layers separately — (a) unauthenticated GET of a protected *page* prefix → 302 to `/auth/signin`; (b) unauthenticated request to a protected *API* endpoint → 401 with no data body. Testing only the page layer would miss the entire API surface.

### Runner bootstrap (Vitest + Astro + workerd + local Supabase)

**Current state — no test infra.** Scripts are `dev/build/preview/astro/lint/lint:fix/format` only ([package.json:5-13](https://github.com/MariuszBorek/10xCards/blob/58f7818d37a379d828d4bb27014b4a3a46a960f2/package.json#L5-L13)); no `vitest`/`msw`/`jsdom` in devDeps; no `vitest.config.*`, no `*.test.*`/`*.spec.*`. `overrides` pins `vite: ^7.3.2` (package.json:60-62) — compatible with Vitest 4.x.

Relevant installed versions (from package.json, do not invent): `astro ^6.3.1`, `@astrojs/cloudflare ^13.5.0`, `@astrojs/react ^5.0.4`, `@supabase/ssr ^0.10.3`, `@supabase/supabase-js ^2.99.1`, `supabase ^2.23.4` (CLI), `zod ^4.4.3`, `ts-fsrs ^5.4.1`, Node `22.14.0`.

**Recommended config** (grounded in Context7 — Astro docs `/websites/astro_build_en` @ `astro_6.3.1`; Vitest `/vitest-dev/vitest`):
```ts
/// <reference types="vitest/config" />
import { getViteConfig } from "astro/config";
export default getViteConfig({
  test: {
    environment: "node",        // Astro v6 guidance: node (not jsdom) for SSR/endpoint tests
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
  },
});
```
`getViteConfig` is required (not bare `defineConfig`) so the `@/*` alias (tsconfig.json) and `astro:env/server` imports resolve under test. For a React-island DOM test later, override per-file with `/** @vitest-environment happy-dom */`.

**Two-user seeding** (grounded — Context7 `/supabase/supabase`): local config has `enable_confirmations = false` (`supabase/config.toml:209`), so `signUp` → immediate `signInWithPassword` works with no email step. Pattern: a `service_role` admin client for setup/teardown (`auth.admin.createUser({ email_confirm: true })` / `deleteUser`), and **per-user anon clients after `signInWithPassword` for the asserted operations** so RLS is actually exercised. Build the client directly with `@supabase/supabase-js` — do **not** reuse `src/lib/supabase.ts` (it needs Astro cookies + `astro:env`).

**OpenRouter mock**: boundary is [generate.ts](https://github.com/MariuszBorek/10xCards/blob/58f7818d37a379d828d4bb27014b4a3a46a960f2/src/lib/services/generate.ts). Built-in toggle `OPENROUTER_MOCK === "true"` returns `MOCK_CANDIDATES` and never calls `fetch` (generate.ts:26-28; env declared in astro.config.mjs; `.env.example` already sets it). For the *failure* branches (non-ok status at 44-45, JSON-parse fallback at 54-58) stub the global: `vi.stubGlobal("fetch", vi.fn(...))` + `vi.unstubAllGlobals()`. MSW is unnecessary for a single-URL no-SDK call.

**workerd caveat**: no handler/service imports anything Cloudflare/workerd-specific — only `astro` types, `zod`, `@/lib/*`, and standard web APIs (`fetch`/`Response`/`Headers`/`Date`) available in Node 22 (`nodejs_compat` is set in wrangler.jsonc). **Do not spin up workerd for Phase 1.** Handlers are plain functions taking one `APIContext`; call exported `GET`/`POST` directly with a constructed context. **But the cleanest Phase 1 path is service-layer tests** — `getDueCards(supabase, userId)` and `reviewCard(supabase, userId, …)` ([srs.ts:71,107](https://github.com/MariuszBorek/10xCards/blob/58f7818d37a379d828d4bb27014b4a3a46a960f2/src/lib/services/srs.ts#L71)) take a ready signed-in client + userId, bypassing the cookie seam and giving the cleanest RLS signal. Promote to full handler-context tests only where the cookie/`getUser()` gate itself is the risk under test (i.e. the #6 401 path).

## Code References

- `src/middleware.ts:4` — `PROTECTED_ROUTES` (page prefixes only; no `/api/*`)
- `src/middleware.ts:9-22` — user resolution, fail-open branch, page redirect
- `src/lib/supabase.ts:5-23` — `@supabase/ssr` server client; returns null if env absent
- `src/env.d.ts:3` — `locals.user: User | null`
- `src/pages/api/flashcards/index.ts:22` — list: `select("*")` no `user_id` filter (RLS-sole)
- `src/pages/api/flashcards/index.ts:71` — create: `insert({ user_id: user.id, … })` (app-scoped)
- `src/pages/api/flashcards/[id].ts:48-53,84` — update/delete: `.eq("id", id)` only (RLS-sole)
- `src/pages/api/flashcards/export.ts:25-28` — export: no `user_id` filter (RLS-sole)
- `src/lib/services/srs.ts:74-80,115-140` — due/review: `.eq("user_id", userId)` (app-scoped) + `reps` optimistic guard
- `src/lib/services/generate.ts:26-28` — `OPENROUTER_MOCK` short-circuit
- `supabase/migrations/20260527000000_flashcard_schema.sql:13-27` — RLS enable + 4 policies
- `supabase/migrations/20260531000000_flashcard_srs_state.sql:4-5,19,24` — FSRS columns, no new policies, due index
- `package.json:5-13,60-62` — no test scripts; vite override pin

## Architecture Insights

- **Defense-in-depth is intentional but uneven.** The two write paths most likely to be hit repeatedly (review via SRS, create) are belt-and-suspenders; the read/bulk paths (list, export) and the by-id mutations (update, delete) lean entirely on RLS. RLS being the *uniform* backstop is what makes the design safe today, and is precisely why the DB-layer test (#2) is not optional — it is the only guard for half the operations.
- **The "challenge" the test-plan demands maps directly onto code**: "logged-in implies authorized" (#1) is false for list/update/delete/export at the app layer; "the app-layer check is enough" (#2) is false for those same four ops; "protected pages imply protected APIs" (#6) is false because `PROTECTED_ROUTES` never lists `/api/*`.
- **Service layer is the natural test seam.** `srs.ts` functions are pure-ish (client + ids in, result out), no Astro/cookie/workerd coupling — the cost×signal sweet spot for Phase 1 integration tests against local Supabase.
- **Oracle hazard recorded**: the parallel audit initially labeled the four RLS-sole endpoints "CRITICAL IDOR." That framing is the *mirror-implementation trap* — under sound RLS they do not leak. The correct, source-derived oracle asserts the cross-account *outcome*, and the #2 direct-DB test is what actually pins the backstop those endpoints depend on.

## Historical Context (from prior changes)

- `context/foundation/test-plan.md` §2 Risk Map + Risk Response Guidance — the authoritative oracle source for #1/#2/#6 (what proves protection, what to challenge, likely cheapest layer). This research confirms its predictions against code.
- `context/foundation/lessons.md` — "Persisted read-modify-write state must guard against lost updates" (srs.ts:106-140). Already mitigated in `reviewCard` via the `.eq("reps", row.reps)` optimistic guard (srs.ts:138). The lost-update hazard itself is explicitly **out of Phase 1 scope** (test-plan §7) — do not add a concurrency test here.
- `context/changes/testing-runner-bootstrap-authz/change.md` — this phase's identity; status advanced `new → preparing` during this research.

## Related Research

- None yet — this is the first research artifact under `context/changes/`. Phase 2 (`#3/#4/#5/#7`) and Phase 3 (gates + e2e) will produce their own.

## Open Questions

1. **Should Phase 1 also assert the app-layer gap explicitly** (e.g. a regression test that fails if a future migration weakens RLS *and* no app filter exists for list/update/delete/export), or is the direct-DB #2 test sufficient? The plan should decide whether to (a) only prove the outcome with RLS in place, or (b) additionally recommend adding `.eq("user_id", user.id)` to the four RLS-sole endpoints as defense-in-depth (a code change, arguably out of a test-only phase).
2. **Handler-context vs service-layer for the #6 401 path** — the 401 gate lives in the handler, not the service, so at least the #6 assertions need a constructed `APIContext` (or a thin handler invocation). Plan should pick the minimal context stub vs Astro's mock-context helper.
3. **`SUPABASE_SERVICE_ROLE_KEY` is not in `.env.example`** today — needed for admin-seeded teardown. Add it in the runner-bootstrap phase.
4. **Test isolation**: `auth.users` rows persist across runs unless the DB is reset; decide between unique-email-per-run vs explicit `admin.deleteUser` teardown (CASCADE drops flashcards).
