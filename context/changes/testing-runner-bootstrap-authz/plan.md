# Test Runner Bootstrap + Authorization/RLS Coverage — Implementation Plan

## Overview

Stand up the integration test runner (Vitest) from zero against local Supabase, then prove cross-account isolation and auth gating for the top failure scenarios in `context/foundation/test-plan.md` — Risk #1 (endpoint authorization / IDOR), Risk #2 (RLS backstop), Risk #6 (middleware / API auth gating). This is rollout Phase 1 of the test plan: it establishes the location, naming, run command, and two-user seeding pattern that Phases 2–3 reuse.

## Current State Analysis

- **No test infrastructure exists.** `package.json` scripts are `dev/build/preview/astro/lint/lint:fix/format` only; no `vitest`/`msw`/`jsdom` in devDeps, no `vitest.config.*`, no `*.test.*`/`*.spec.*`, no `test/` directory. `overrides` pins `vite: ^7.3.2` (compatible with Vitest 4.x).
- **RLS is sound and complete.** `flashcards` has four granular per-operation policies, all `auth.uid() = user_id`, in the create migration (`supabase/migrations/20260527000000_flashcard_schema.sql:13-27`). The second migration adds FSRS columns and deliberately no new policies.
- **App-layer ownership is asymmetric.** `create`, `due`, `review` enforce ownership in app code (`insert({ user_id })` / `.eq("user_id", userId)`). `list`, `update`, `delete`, `export` carry **no** app-layer `user_id` filter — RLS is their sole backstop. They do not leak while RLS holds; the risk is single-point-of-failure.
- **Middleware guards pages, not APIs.** `PROTECTED_ROUTES = ["/dashboard","/generate","/review","/collection"]`, matched by `startsWith` (`src/middleware.ts:4,18`). No `/api/*` entry — every flashcard endpoint self-guards with its own `getUser()` → 401. Middleware also fails *open* when Supabase env is absent.
- **Service layer is the cleanest test seam.** `getDueCards(supabase, userId)` (`src/lib/services/srs.ts:71`) and `reviewCard(supabase, userId, cardId, rating)` (`srs.ts:107`) take a ready signed-in client + userId — no cookie/workerd coupling.
- **Local Supabase is test-ready.** `supabase/config.toml`: API on `54321`, DB on `54322`, `[auth] enable_confirmations = false` (line 209) — so `signUp` → immediate `signInWithPassword` works with no email step. No `supabase/seed.sql` exists (seed programmatically). `SUPABASE_SERVICE_ROLE_KEY` is **not** in `.env.example` yet.
- **OpenRouter has a built-in mock seam.** `generateFlashcardCandidates` returns `MOCK_CANDIDATES` when `OPENROUTER_MOCK === "true"` (`src/lib/services/generate.ts:25-28`). Not exercised in this phase (generation is Phase 2 of the rollout).

## Desired End State

`npm test` runs a Vitest suite against a running local Supabase that:
- proves user B cannot SELECT/UPDATE/DELETE user A's flashcard row at the DB layer, and cannot INSERT a row owned by A (Risk #2);
- proves the due/review service paths and a representative list endpoint never cross accounts (Risk #1);
- proves an unauthenticated request to a protected API endpoint returns 401 with no data, and a protected page-prefix redirects to `/auth/signin` (Risk #6);
- documents, via test and `lessons.md`, that `list/update/delete/export` rely on RLS alone.

Verification: with `npx supabase start` running, `npm test` passes green; `npm run lint` and `npx astro check` remain clean; test-plan §6 cookbook and §3 status reflect the shipped phase.

### Key Discoveries:

- RLS-sole endpoints (`src/pages/api/flashcards/index.ts:22`, `[id].ts:48-53,84`, `export.ts:25-28`) — assert the cross-account **outcome**, never the query shape (mirroring would pass against the gap).
- Belt-and-suspenders paths via service layer (`srs.ts:74-80,115-140`) — cleanest seam for Risk #1.
- Middleware page-only gating (`src/middleware.ts:4,18`) — Risk #6 must test page redirect AND API 401 separately.
- `enable_confirmations = false` (`supabase/config.toml:209`) — enables programmatic two-user seeding.
- `getViteConfig` from `astro/config` is required so the `@/*` alias and `astro:env/server` imports resolve under test (Astro v6 testing guidance, Context7 `/websites/astro_build_en`).

## What We're NOT Doing

- **Not adding `.eq("user_id", user.id)` to the four RLS-sole endpoints.** Decision: keep Phase 1 a pure test rollout; the gap is filed in `lessons.md` + an open follow-up. No behavior change in this PR.
- **Not testing the generation path** (silent-loss, transient input, AI failure/empty/zero-candidate, output-safety) — that is rollout Phase 2 (#3/#4/#5/#7).
- **Not wiring CI gates or e2e** — rollout Phase 3.
- **Not spinning up workerd / `wrangler dev`** — no handler imports Cloudflare-specific globals; Node 22 + `nodejs_compat` covers the APIs used.
- **Not testing the SRS lost-update concurrency hazard** — explicitly out of scope per test-plan §7 (single-writer MVP; already guarded by the `reps` optimistic check).
- **Not raw-pg RLS testing** — RLS is exercised via the signed-in PostgREST path that mirrors production.
- **Not handler-context tests for each of update/delete/export** — covered by the RLS test + one representative list handler test.

## Implementation Approach

Build the environment first (Phase 1), then layer the three risk suites on top in cost×signal order: the cheap, high-signal direct-DB RLS test (Phase 2) that backstops four endpoints at once; the service-layer + one-handler endpoint authorization tests (Phase 3); the middleware/API gating tests (Phase 4). Close by writing the cookbook and filing the RLS-sole gap (Phase 5). Integration tests are gated behind a running local Supabase; the suite skips with a clear message when the DB is unreachable rather than failing spuriously.

The two-user model is the spine: a `service_role` admin client seeds users A and B (unique per-run emails) and tears them down; each assertion runs through a per-user anon client that has done `signInWithPassword`, so the JWT → PostgREST → `auth.uid()` path is exercised exactly as in production.

## Critical Implementation Details

- **Timing & lifecycle**: `auth.users` persists across runs unless the DB is reset. Seed with a per-run unique email nonce (sourced from an env var or `process.pid`/`process.hrtime` set in `setup.ts` — not from a banned `Date.now()` in any workflow context) and tear users down in `afterAll` via `admin.auth.admin.deleteUser(id)` (CASCADE drops their flashcards). A crashed run orphans users → periodic `npx supabase db reset` is the recovery, documented in the cookbook.
- **Config**: use `getViteConfig()` from `astro/config`, not bare `defineConfig` — otherwise `@/*` and `astro:env/server` fail to resolve in tests. Set `test.environment: "node"` (Astro v6 guidance; jsdom is wrong for SSR/endpoint tests).
- **State sequencing**: per-user anon clients must `signInWithPassword` *before* any asserted query; the anon client carries the session JWT that RLS reads. A query on an unauthenticated anon client sees zero rows (no `auth.uid()`), which would be a false pass for "B cannot see A" — so tests must assert B *is signed in* yet still denied.

## Phase 1: Runner bootstrap & two-user seeding harness

### Overview

Install and configure Vitest, add scripts and test env, and build the seeding harness (admin client + per-user signed-in clients + teardown). Prove the harness reaches local Supabase with one smoke test.

### Changes Required:

#### 1. Vitest dependency + config

**File**: `vitest.config.ts` (new), `package.json`

**Intent**: Add Vitest as a dev dependency and configure it through Astro so test code resolves the same module graph as the app. Add `test` / `test:watch` scripts.

**Contract**: `vitest.config.ts` exports `getViteConfig({ test: { environment: "node", globals: true, setupFiles: ["./test/setup.ts"], include: ["test/**/*.test.ts", "src/**/*.test.ts"] } })` imported from `astro/config`. `package.json` scripts gain `"test": "vitest run"` and `"test:watch": "vitest"`. Install `vitest` + `@vitest/coverage-v8` at current versions (resolve at install time, do not pin blind).

#### 2. Test environment variables

**File**: `.env.example`

**Intent**: Declare the service_role key tests need for admin seeding, alongside the existing URL/anon vars, and document the `npx supabase start` copy step.

**Contract**: add `SUPABASE_SERVICE_ROLE_KEY=` to `.env.example` with a comment pointing at the `npx supabase start` output. Tests read `SUPABASE_URL`, `SUPABASE_KEY` (anon), and `SUPABASE_SERVICE_ROLE_KEY` from `process.env`.

#### 3. Seeding harness + setup

**File**: `test/setup.ts` (new), `test/helpers/supabase.ts` (new)

**Intent**: Provide reusable helpers to seed two isolated users and obtain a signed-in anon client per user, plus teardown. This is the pattern Phases 2–4 and rollout Phase 2 reuse.

**Contract**: a plain `@supabase/supabase-js` client built directly (NOT `src/lib/supabase.ts`, which needs Astro cookies). Helpers expose roughly:
- `adminClient()` → service_role client (`{ auth: { persistSession: false } }`).
- `seedUser(email?, password?)` → creates a user via `admin.auth.admin.createUser({ email, password, email_confirm: true })`, returns `{ id, email, password }`; default email carries a per-run nonce.
- `signedInClient(email, password)` → anon client after `signInWithPassword`; the asserted-operations client.
- `deleteUser(id)` for `afterAll`.
- A guard that detects an unreachable local Supabase and skips integration tests with a clear message.

#### 4. Smoke test

**File**: `test/smoke.test.ts` (new)

**Intent**: Prove the harness can seed a user, sign in, and round-trip one row through `flashcards` — establishing the runner works end-to-end before risk tests are layered on.

**Contract**: seed user A, sign in, `insert` one flashcard with `user_id = A.id`, `select` it back, assert it returns exactly that row; teardown deletes A.

### Success Criteria:

#### Automated Verification:

- [ ] `vitest.config.ts` exists and `npm test` discovers the suite
- [ ] `npm test` smoke test passes against a running local Supabase
- [ ] `npm run lint` passes
- [ ] `npx astro check` passes
- [ ] Suite skips with a clear message (not a hard failure) when local Supabase is unreachable

#### Manual Verification:

- [ ] `npx supabase start` then `npm test` runs green from a clean checkout after copying keys into `.env`
- [ ] `.env.example` documents `SUPABASE_SERVICE_ROLE_KEY` and the copy step clearly
- [ ] No orphaned `auth.users` remain after a normal run (teardown verified in Studio)

**Implementation Note**: After completing this phase and all automated verification passes, pause for human confirmation of the manual testing before proceeding.

---

## Phase 2: RLS backstop tests (Risk #2)

### Overview

Exercise the four `flashcards` RLS policies directly with user B's signed-in credentials, proving B cannot reach A's row at the DB layer. This is the sole backstop for the RLS-sole endpoints, so it is the highest-signal test in the phase.

### Changes Required:

#### 1. RLS isolation tests

**File**: `test/rls/flashcards-rls.test.ts` (new)

**Intent**: Prove every operation's policy denies cross-account access, asserting the observable outcome (no rows / no mutation), derived from the PRD isolation guardrail and the policy definitions — not from any handler's query.

**Contract**: seed users A and B; insert a row owned by A (via A's signed-in client or admin). With **B's signed-in anon client**:
- SELECT of A's row id → returns zero rows.
- UPDATE of A's row id → affects zero rows (returned data empty / no change observed via A re-reading).
- DELETE of A's row id → affects zero rows (A's row still present when A re-reads).
- INSERT with `user_id = A.id` → rejected by the `insert_own` WITH CHECK.
Each assertion confirms B *is authenticated* (sign-in succeeded) yet still denied — guarding against the false pass where an unauthenticated client trivially sees nothing.

### Success Criteria:

#### Automated Verification:

- [ ] `npm test` RLS suite passes: B denied SELECT/UPDATE/DELETE of A's row and INSERT-as-A
- [ ] Test confirms B's session is authenticated before asserting denial
- [ ] `npm run lint` passes

#### Manual Verification:

- [ ] Temporarily weakening one policy in a scratch migration makes the corresponding assertion fail (oracle sanity check — revert after)

**Implementation Note**: After automated verification passes, pause for human confirmation before proceeding.

---

## Phase 3: Endpoint authorization tests (Risk #1)

### Overview

Prove the application paths never cross accounts: the due/review service functions scope to the caller, and a representative list endpoint, exercised through its real handler, returns only the caller's rows (proving session-wiring on top of RLS).

### Changes Required:

#### 1. Service-layer authorization tests

**File**: `test/authz/srs-service.test.ts` (new)

**Intent**: Prove `getDueCards` and `reviewCard` scope to the passed `userId` and that B cannot mutate or read A's card through them.

**Contract**: seed A and B, seed a due card owned by A. With B's signed-in client:
- `getDueCards(clientB, B.id)` → does not include A's card.
- `reviewCard(clientB, B.id, <A's cardId>, rating)` → throws "Flashcard not found" (the `.eq("user_id")` + RLS combination yields no row).
Also a positive path: A's own due card is returned by `getDueCards(clientA, A.id)` and reviewable by A.

#### 2. Representative handler test

**File**: `test/authz/flashcards-handler.test.ts` (new)

**Intent**: Exercise one RLS-sole endpoint through its actual route handler to prove the handler wires the caller's session into the query (catches a session-wiring regression that a service test would miss).

**Contract**: import the `GET` export from `src/pages/api/flashcards/index.ts`; construct a minimal `APIContext` carrying B's authenticated session (auth cookies obtained from a `@supabase/ssr` sign-in, or the minimal cookie set the SSR client reads); seed rows for both A and B; assert the response body contains only B's rows and none of A's. A snippet of the context-construction shape belongs here because it is the non-obvious contract Phase 4 reuses:

```ts
const context = {
  request: new Request("http://localhost/api/flashcards", { headers: new Headers({ Cookie: bSessionCookie }) }),
  cookies: makeCookieStub(),
  params: {},
} as unknown as APIContext;
const res = await GET(context);
```

### Success Criteria:

#### Automated Verification:

- [ ] `npm test` service-layer suite passes: B cannot read/review A's card; A can read/review own
- [ ] `npm test` handler suite passes: GET list as B returns only B's rows
- [ ] `npm run lint` passes
- [ ] `npx astro check` passes

#### Manual Verification:

- [ ] The handler test fails if B's session cookie is swapped for A's (confirms it asserts identity, not just non-emptiness)

**Implementation Note**: After automated verification passes, pause for human confirmation before proceeding.

---

## Phase 4: Middleware / API auth gating tests (Risk #6)

### Overview

Prove both gating layers independently: a protected API endpoint returns 401 to an unauthenticated request (no data), and a protected page-prefix redirects unauthenticated users to `/auth/signin`. Document, via test, that `/api/*` is not covered by `PROTECTED_ROUTES`.

### Changes Required:

#### 1. API endpoint 401 test

**File**: `test/authz/api-gating.test.ts` (new)

**Intent**: Prove an unauthenticated request to a protected flashcard API endpoint is rejected with 401 and returns no flashcard data — verifying the in-handler gate, since middleware does not cover `/api/*`.

**Contract**: import a flashcard handler (e.g. `GET` from `flashcards/index.ts`); call it with an `APIContext` whose request carries **no** auth cookie; assert `res.status === 401` and the body contains an error, not rows. Reuses the context-construction shape from Phase 3.

#### 2. Middleware page-gating test

**File**: `test/authz/middleware-gating.test.ts` (new)

**Intent**: Prove the middleware redirects unauthenticated requests to protected page prefixes and lets authenticated ones through, and assert the `/api/*` coverage gap explicitly so a future change that assumes APIs are gated is caught.

**Contract**: invoke the middleware `onRequest` with a constructed context for a protected page path (`/dashboard`) and `locals.user = null` → expect a redirect to `/auth/signin`; with a user present → expect `next()` is reached. A separate assertion documents that a `/api/...` path is **not** matched by `PROTECTED_ROUTES.some(startsWith)` (the gap), so reliance on in-handler 401 is intentional and recorded.

### Success Criteria:

#### Automated Verification:

- [ ] `npm test` API-gating suite passes: unauthenticated → 401, no data
- [ ] `npm test` middleware suite passes: unauthenticated page → redirect; authenticated → pass-through
- [ ] Test documents `/api/*` is outside `PROTECTED_ROUTES`
- [ ] `npm run lint` passes

#### Manual Verification:

- [ ] Removing the in-handler auth check in a scratch edit makes the API-401 test fail (oracle sanity check — revert after)

**Implementation Note**: After automated verification passes, pause for human confirmation before proceeding.

---

## Phase 5: Cookbook + lessons + plan sync

### Overview

Capture the patterns this phase established so future tests are cheap to add, file the RLS-sole gap as a lesson, and advance the rollout state.

### Changes Required:

#### 1. Test-plan cookbook

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the §6 "TBD" placeholders this phase resolves with concrete recipes.

**Contract**: fill §6.1 (adding a unit test), §6.2 (integration test — seed two users, assert B cannot reach A at app and DB layers), §6.4 (new API endpoint — handler-context pattern + ownership/side-effect assertion); add a §6.6 note. Advance the Phase 1 row Status in §3 toward `complete`.

#### 2. Lessons entry for the RLS-sole gap

**File**: `context/foundation/lessons.md`

**Intent**: Record that `list/update/delete/export` rely on RLS alone, so future reviews flag any RLS weakening as a multi-endpoint leak and a follow-up can add the app-layer filters.

**Contract**: append a lesson — Context (the four endpoints + file:lines), Problem (RLS is the sole backstop; a weakened policy leaks with nothing in app code to catch it), Rule (add `.eq("user_id", user.id)` defense-in-depth when touching these endpoints; never assert the query shape in tests), Applies-to.

### Success Criteria:

#### Automated Verification:

- [ ] `npm run lint` / format passes on edited markdown (lint-staged Prettier)
- [ ] test-plan §6.1/§6.2/§6.4 no longer read "TBD — see §3 Phase 1"

#### Manual Verification:

- [ ] Cookbook recipes are accurate enough that a new contributor could add an integration test by following them
- [ ] `lessons.md` entry reads clearly and references correct file:lines

**Implementation Note**: Final phase — after verification, the change is ready to archive.

---

## Testing Strategy

### Unit Tests:

- Middleware gating logic (page redirect vs pass-through; `/api/*` non-coverage).
- (Future) any pure helper extracted during bootstrap.

### Integration Tests (real local Supabase):

- RLS denial for B across SELECT/UPDATE/DELETE/INSERT (Phase 2).
- Service-layer authorization for due/review (Phase 3).
- Representative list handler returns only caller's rows (Phase 3).
- API endpoint 401 for unauthenticated request (Phase 4).

### Manual Testing Steps:

1. `npx supabase start`; copy URL/anon/service_role keys into `.env`.
2. `npm test` → all suites green.
3. In Supabase Studio, confirm no orphaned `auth.users` after the run.
4. Oracle sanity checks: temporarily weaken a policy / remove a handler auth check and confirm the matching test goes red; revert.

## Performance Considerations

Integration tests hit a real local Postgres; keep seeded data minimal (1–2 rows per user) and prefer per-run unique emails over full `db reset` to keep the watch loop fast. Run integration suites serially if parallel file execution races on shared seed data.

## Migration Notes

No schema migrations. `.env.example` gains `SUPABASE_SERVICE_ROLE_KEY`; contributors must copy the local key from `npx supabase start` output. The integration gate stays ad hoc (not on every commit) per test-plan §4 until rollout Phase 3 wires CI.

## References

- Related research: `context/changes/testing-runner-bootstrap-authz/research.md`
- Test plan: `context/foundation/test-plan.md` (§2 Risk Map, §3 Phase 1, §6 cookbook)
- RLS policies: `supabase/migrations/20260527000000_flashcard_schema.sql:13-27`
- Service seam: `src/lib/services/srs.ts:71,107`
- Middleware: `src/middleware.ts:4,18`
- RLS-sole endpoints: `src/pages/api/flashcards/index.ts:22`, `[id].ts:48-53,84`, `export.ts:25-28`
- Astro testing guidance: Context7 `/websites/astro_build_en` (repo `astro_6.3.1`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Runner bootstrap & two-user seeding harness

#### Automated

- [x] 1.1 vitest.config.ts exists and `npm test` discovers the suite — 9ecf680
- [x] 1.2 `npm test` smoke test passes against a running local Supabase — 9ecf680
- [x] 1.3 `npm run lint` passes — 9ecf680
- [x] 1.4 `npx astro check` passes — 9ecf680
- [x] 1.5 Suite skips with a clear message when local Supabase is unreachable — 9ecf680

#### Manual

- [x] 1.6 `npx supabase start` then `npm test` runs green from a clean checkout after copying keys — 9ecf680
- [x] 1.7 `.env.example` documents `SUPABASE_SERVICE_ROLE_KEY` and the copy step — 9ecf680
- [x] 1.8 No orphaned `auth.users` remain after a normal run — 9ecf680

### Phase 2: RLS backstop tests (Risk #2)

#### Automated

- [x] 2.1 RLS suite passes: B denied SELECT/UPDATE/DELETE of A's row and INSERT-as-A — 8fd3d0e
- [x] 2.2 Test confirms B's session is authenticated before asserting denial — 8fd3d0e
- [x] 2.3 `npm run lint` passes — 8fd3d0e

#### Manual

- [x] 2.4 Weakening one policy in a scratch migration makes the matching assertion fail (revert after) — 8fd3d0e

### Phase 3: Endpoint authorization tests (Risk #1)

#### Automated

- [x] 3.1 Service-layer suite passes: B cannot read/review A's card; A can read/review own — 1de98a2
- [x] 3.2 Handler suite passes: GET list as B returns only B's rows — 1de98a2
- [x] 3.3 `npm run lint` passes — 1de98a2
- [x] 3.4 `npx astro check` passes — 1de98a2

#### Manual

- [x] 3.5 Handler test fails if B's session cookie is swapped for A's — 1de98a2

### Phase 4: Middleware / API auth gating tests (Risk #6)

#### Automated

- [x] 4.1 API-gating suite passes: unauthenticated → 401, no data — 7e19b9c
- [x] 4.2 Middleware suite passes: unauthenticated page → redirect; authenticated → pass-through — 7e19b9c
- [x] 4.3 Test documents `/api/*` is outside `PROTECTED_ROUTES` — 7e19b9c
- [x] 4.4 `npm run lint` passes — 7e19b9c

#### Manual

- [x] 4.5 Removing the in-handler auth check makes the API-401 test fail (revert after) — 7e19b9c

### Phase 5: Cookbook + lessons + plan sync

#### Automated

- [x] 5.1 lint/format passes on edited markdown — 621cdf2
- [x] 5.2 test-plan §6.1/§6.2/§6.4 no longer read "TBD — see §3 Phase 1" — 621cdf2

#### Manual

- [x] 5.3 Cookbook recipes are accurate enough for a new contributor to follow — 621cdf2
- [x] 5.4 `lessons.md` entry reads clearly and references correct file:lines — 621cdf2
