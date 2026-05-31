---
date: 2026-05-31T00:00:00+02:00
researcher: mariuszborek
git_commit: 681ed5d2eb4e11a9b796bb4604dc9caec45c7b5a
branch: navigation-improvements
repository: 10xCards
topic: "Is ts-fsrs-docs.md compatible with the 10xCards codebase for implementing S-06 (srs-flow)?"
tags: [research, codebase, srs, ts-fsrs, cloudflare-workers, supabase, rls, astro-islands]
status: complete
last_updated: 2026-05-31
last_updated_by: mariuszborek
---

# Research: ts-fsrs ⇄ 10xCards codebase compatibility for S-06 (srs-flow)

**Date**: 2026-05-31T00:00:00+02:00
**Researcher**: mariuszborek
**Git Commit**: 681ed5d2eb4e11a9b796bb4604dc9caec45c7b5a
**Branch**: navigation-improvements
**Repository**: 10xCards

## Research Question

Review the codebase and decide whether `context/changes/srs-flow/ts-fsrs-docs.md` is
compatible with it, in order to implement **S-06 (srs-flow)** from
`context/foundation/roadmap.md` — an in-app spaced-repetition review flow powered by the
external `ts-fsrs` scheduler instead of a custom algorithm.

This is the **internal-research** counterpart to the existing **external** selection doc
(`srs-flow-research.md`, which picked `ts-fsrs`). Scope here: does our actual codebase
support what `ts-fsrs-docs.md` assumes?

## Summary

**Verdict: COMPATIBLE.** Every assumption in `ts-fsrs-docs.md` holds against the live
codebase across all four dimensions — runtime, schema/RLS, API/service patterns, and
frontend. `ts-fsrs` (the pure-TS scheduler package, not the WASM optimizer) drops into the
existing Astro-SSR-on-Cloudflare-Workers + Supabase + React-islands stack with no
architectural friction. The implementation sketch in §"Implementation sketch for S-06" of
the docs is sound.

Two refinements and one genuinely-new convention to carry into planning:

1. **RLS — simpler than the docs imply.** The docs say the SRS migration "MUST add
   per-operation RLS." That's only true for a *sibling* table. If we **extend the existing
   `flashcards` table** with `ALTER TABLE ... ADD COLUMN` (recommended), the existing
   table-level per-operation policies (`select_own` / `update_own`, both
   `auth.uid() = user_id`) **automatically cover the new columns — no new policies needed.**

2. **Persist dates as ISO strings in `timestamptz`, not epoch-ms.** The docs' §5
   `afterHandler` example maps `Date → .getTime()` (epoch-ms numbers). The codebase types
   **all** timestamps as ISO `string` over `timestamptz` columns and relies on PostgREST
   auto-serialization (no manual date code anywhere). Follow §6 of the docs (which correctly
   says `timestamptz`), **not** the §5 `getTime()` variant — otherwise you'd be pushed toward
   `bigint` columns that clash with the project convention.

3. **New convention introduced: `Date ⇄ ISO-string` round-trip.** `ts-fsrs` consumes/produces
   JS `Date`s (`card.due`, `card.last_review`); the DB layer speaks ISO strings. So:
   `card.due.toISOString()` on write, `new Date(row.due)` on read before feeding a card back
   into `scheduler.repeat()` / `scheduler.next()`. This conversion does not exist today and is
   the single net-new piece of plumbing.

Also note: **`ts-fsrs` is not yet installed** (`npm install ts-fsrs` required), and the
docs' own "⚠️ verify the exact `Card` interface against the installed version before writing
the migration" remains a valid pre-migration step.

## Detailed Findings

### 1. Runtime & dependency compatibility — ✅ confirmed

The docs' core claim ("pure TS, edge-safe; do NOT pull the Rust/WASM optimizer") matches the
runtime exactly.

- `astro.config.mjs:11` — `output: "server"` (full SSR).
- `astro.config.mjs:16` — adapter `@astrojs/cloudflare`. No `vite.ssr.external/noExternal`
  overrides that would block bundling a new dep.
- `wrangler.jsonc:5-6` — `compatibility_date: "2026-05-08"`, `compatibility_flags: ["nodejs_compat"]`.
- `package.json:3` — `"type": "module"` (ESM); `ts-fsrs` ships ESM/CJS/UMD → fits.
- Existing prod deps are all pure-JS (`@supabase/ssr`, `zod@^4.4.3`, React 19, Astro 6.3.1) —
  the same shape as `ts-fsrs`. **No WASM/WASI/native addon is used at runtime** (only
  build-time tools like shiki/lightningcss/oxide live in `node_modules`).
- `.nvmrc` → `22.14.0` ≥ ts-fsrs advisory `engines: node>=20`.
- `tsconfig.json` extends `astro/tsconfigs/strict`, `@/*` path alias — resolves ts-fsrs `.d.ts`
  with no config change.

Conclusion: the `ts-fsrs` scheduler will bundle and run on Workers. The docs' warning to avoid
`@open-spaced-repetition/binding` (Rust/WASM/WASI) is correct and aligns with
`srs-flow-research.md`'s edge-runtime constraint.

### 2. Schema & RLS — ✅ confirmed, with an RLS simplification

Single migration on disk: `supabase/migrations/20260527000000_flashcard_schema.sql` (naming
format `YYYYMMDDHHmmss_description.sql` confirmed; the SRS migration will be the second file).

Current `flashcards` table (`20260527000000_flashcard_schema.sql:2-10`):
```sql
CREATE TABLE flashcards (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  word        TEXT        NOT NULL,
  translation TEXT        NOT NULL,
  context     TEXT,
  deleted_at  TIMESTAMPTZ,             -- present but dead: no code reads/writes/filters it
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
RLS (`:13-27`): enabled, four per-operation policies, all `auth.uid() = user_id`
(`select_own` / `insert_own` / `update_own` / `delete_own`); index `idx_flashcards_user_id` (`:30`).

The docs' §6 Card-field → column mapping is type-compatible with Postgres. Recommended
extension migration (mirrors F-01 style, columns DEFAULTed so existing rows backfill to an
FSRS "New" card):
```sql
ALTER TABLE flashcards
  ADD COLUMN due            TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  ADD COLUMN stability      DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN difficulty     DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN elapsed_days   INTEGER          NOT NULL DEFAULT 0,
  ADD COLUMN scheduled_days INTEGER          NOT NULL DEFAULT 0,
  ADD COLUMN reps           INTEGER          NOT NULL DEFAULT 0,
  ADD COLUMN lapses         INTEGER          NOT NULL DEFAULT 0,
  ADD COLUMN state          SMALLINT         NOT NULL DEFAULT 0 CHECK (state BETWEEN 0 AND 3),
  ADD COLUMN last_review    TIMESTAMPTZ;     -- nullable
CREATE INDEX idx_flashcards_due ON flashcards(user_id, due);  -- for the "due now" query
```
**RLS note (refines the docs):** because the existing policies are table-level/per-operation,
`ALTER TABLE ADD COLUMN` needs **no new RLS** — `select_own`/`update_own` already cover the new
columns. New per-operation RLS would only be required if you chose a sibling `flashcard_srs`
table. **Recommendation: extend `flashcards`** (simpler, RLS-free migration, single-row review
write). Still keep RLS in mind per the project hard rule — here it's satisfied by inheritance.

### 3. API routes & service layer — ✅ confirmed, two patterns to establish

The two new endpoints (list-due, submit-rating) fit a rigidly consistent route template.

- Existing flashcard routes: `src/pages/api/flashcards/index.ts` (`GET` list / `POST` create),
  `[id].ts` (`PATCH` / `DELETE`), `generate.ts` (`POST`), `export.ts` (`GET`).
- Every route: `export const prerender = false` (e.g. `index.ts:6`); uppercase typed
  `APIRoute` exports; **auth via `createClient(context.request.headers, context.cookies)` then
  `supabase.auth.getUser()`** (routes ignore `context.locals.user` even though
  `middleware.ts:13` sets it); zod `safeParse` with
  `parsed.error.issues[0]?.message ?? "Validation error"`; responses are
  `new Response(JSON.stringify({ <singleKey> }), { status, headers: {"Content-Type":"application/json"} })`,
  errors always `{ error: string }`. Status codes 200/201/204/400/401/404/500 in use.
- DB access today lives **inline in routes** via PostgREST `{ data, error }` branching
  (`index.ts:22-26`, `[id].ts:48-57`), e.g.
  `supabase.from("flashcards").select("*").order("created_at",{ascending:false})`.
- Only one extracted service exists: `src/lib/services/generate.ts` — and it takes **no**
  supabase client / userId (`generateFlashcardCandidates(input): Promise<FlashcardCandidate[]>`,
  `generate.ts:25`), reads its own secrets, and **throws** on failure (route try/catches to a
  `{ error }` response).

**Two decisions with no existing precedent (establish them in the plan):**
1. **DB-service signature.** None exists. Recommended convention: create the client in the
   route and pass it in — `getDueCards(supabase, userId)` and
   `reviewCard(supabase, userId, cardId, rating)`; service throws, route try/catches.
   "List due" adds `.lte("due", new Date().toISOString())`; "submit rating" loads the row →
   rehydrates Dates → `scheduler.next()` → persists via the ISO-string mapping.
2. **Zod schemas are inline per-route** (no shared schema file); the rating endpoint's
   `z.object({ rating: ... })` follows that.

### 4. Frontend islands & navigation — ✅ confirmed, near-exact precedent

`GenerateView` is an almost direct template for a review session.

- `src/components/generate/GenerateView.tsx` — **phase-based island** (`"idle" | "loading" |
  "review"`), `useState`, plain `fetch()` to `/api/flashcards/generate`, optimistic updates.
  This maps onto a review session's `loading → reviewing → done` phases.
- `src/components/collection/CollectionView.tsx` — list + per-item fetch/error/loading
  precedent.
- Islands mount with `client:load` and pages wrap in `AppLayout`, e.g. `collection.astro`:
  `<AppLayout title="Collection"><CollectionView client:load /></AppLayout>`.
- shadcn/ui available in `src/components/ui/`: `Button` (variants include `cosmic`,
  `cosmic-outline`, `cosmic-ghost` — ideal for the four rating buttons), `Card` (+ sub-parts),
  `Dialog`, `Input`, `Textarea`, `Skeleton`.
- Nav lives in `src/components/Topbar.astro:30-44` (rendered by `AppLayout`); current items:
  Dashboard / Generate / Collection, with active-link detection (`Topbar.astro:8-13`). Add a
  `<a href="/review">Nauka</a>` entry there.
- New page `src/pages/review.astro` + island `src/components/review/ReviewSession.tsx`. Add
  `"/review"` to `PROTECTED_ROUTES` in `src/middleware.ts:4`
  (currently `["/dashboard", "/generate", "/collection"]`).

### 5. Shared types impact

`src/types.ts` defines `Flashcard` (`:1-9`), `FlashcardInsert` (`:11-16`),
`FlashcardCandidate` (`:18-22`). All timestamps are typed `string` (`created_at`,
`deleted_at`) — confirming the ISO-string convention. Adding SRS fields: extend `Flashcard`
with `due: string`, `stability/difficulty/elapsed_days/scheduled_days/reps/lapses: number`,
`state: number`, `last_review: string | null`; add a small review-write DTO (e.g.
`FlashcardSrsUpdate`) rather than overloading `FlashcardInsert`.

## Code References

- `astro.config.mjs:11,16` — SSR output + Cloudflare adapter.
- `wrangler.jsonc:5-6` — compat date + `nodejs_compat`.
- `package.json:3,36` — ESM project; zod (no native runtime deps).
- `.nvmrc:1` — Node 22.14.0.
- `supabase/migrations/20260527000000_flashcard_schema.sql:2-10,13-30` — table + per-operation RLS + index.
- `src/lib/supabase.ts:5-24` — SSR client factory (returns `null` if env absent).
- `src/pages/api/flashcards/index.ts:6,8-20,22-28,34-79` — route template (prerender, auth, zod, query, response).
- `src/pages/api/flashcards/[id].ts:48-57,84-90` — UPDATE/DELETE + 404 patterns.
- `src/lib/services/generate.ts:25,45` — the sole service (no client/userId; throws).
- `src/types.ts:1-22` — entity/DTO types; timestamps typed `string`.
- `src/components/generate/GenerateView.tsx` — phase-based island precedent.
- `src/components/ui/button.tsx:11-22` — `cosmic*` button variants.
- `src/components/Topbar.astro:8-13,30-44` — nav items + active-link logic.
- `src/middleware.ts:4,13,18-22` — `PROTECTED_ROUTES`, `locals.user`, redirect.

## Architecture Insights

- **RLS by inheritance**: table-level per-operation policies mean column-additive migrations
  carry zero RLS cost — a deliberate strength of the F-01 design for exactly this kind of
  extension.
- **Routes own HTTP, services own domain**: services throw, routes shape responses; the DB
  client is created at the route boundary. The SRS work should keep that split.
- **Boundary is ISO strings, not Dates**: the codebase never lets a JS `Date` cross the
  DB/wire boundary. `ts-fsrs` is the first dependency that traffics in `Date`s, so the
  `Date ⇄ string` adapter is the one new seam — keep it isolated in the SRS service.
- **Phase-state islands**: `GenerateView`'s `idle→loading→review` is the house style for
  multi-step interactive flows; the review session is the same shape.

## Historical Context (from prior changes)

- `context/changes/srs-flow/srs-flow-research.md` — **external** library selection: chose FSRS
  over SM-2 and `ts-fsrs` over alternatives (MIT, zero-dep, edge-safe scheduler; optimizer is a
  separate WASM package to avoid). This internal research confirms the codebase honours those
  constraints.
- `context/changes/srs-flow/ts-fsrs-docs.md` — Context7-sourced API/persistence/schema
  reference; this document validates it against the live codebase and flags the §5-vs-§6 date
  nuance.
- `context/changes/srs-flow/change.md` — slice identity; lists the three roadmap unknowns
  (library choice, schema fields, session UX) — library + schema are now resolved here; UX
  scope remains for planning.
- `context/foundation/roadmap.md:139-152` — S-06 definition; prerequisite F-01 is `done`.

## Related Research

- `context/changes/srs-flow/srs-flow-research.md` (external selection)
- `context/changes/srs-flow/ts-fsrs-docs.md` (implementation reference)

## Open Questions

Carried into `/10x-plan` (none block planning):

1. **Extend `flashcards` vs sibling `flashcard_srs` table** — recommendation: extend (RLS-free,
   single-row review write). Confirm at plan time.
2. **Verify the exact `ts-fsrs` `Card` interface** against the installed/pinned version after
   `npm install ts-fsrs`, before finalizing migration columns (per the docs' ⚠️ note) — recent
   versions added/renamed fields.
3. **Expose `request_retention` / `maximum_interval` as user settings, or hardcode MVP
   defaults?** — default to `fsrs()` no-arg for MVP.
4. **Review-session UX scope** — card ordering (due-date asc?), reveal interaction, four rating
   buttons (Again/Hard/Good/Easy), end-of-queue state. Owner: design.
5. **`preview` (scheduler.repeat) "next due" hints in the UI — in or out for MVP?**
