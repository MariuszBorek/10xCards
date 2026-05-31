# SRS Review Flow (S-06) Implementation Plan

## Overview

Add an in-app spaced-repetition review session to 10xCards, powered by the external
`ts-fsrs` scheduler (default FSRS weights — no custom algorithm, no optimizer). The app
persists per-card FSRS state on the existing `flashcards` table, serves the cards that are
due, and lets the user study them in a session: see the foreign word, recall the meaning,
reveal the translation, and grade recall with four buttons (Again/Hard/Good/Easy). Each
grade advances the card's schedule via `ts-fsrs` and persists the new state.

This delivers roadmap slice **S-06 (srs-flow)**, prerequisite F-01 (`flashcard-schema`) is
`done`.

## Current State Analysis

Grounded in `context/changes/srs-flow/research.md` (internal research, COMPATIBLE verdict)
and `context/changes/srs-flow/srs-flow-research.md` (external selection of `ts-fsrs`):

- **Runtime**: Astro 6 SSR + `@astrojs/cloudflare`, `nodejs_compat`, ESM, Node 22. A pure-TS,
  zero-dep library like `ts-fsrs`'s scheduler bundles and runs with no config change. The
  Rust/WASM optimizer (`@open-spaced-repetition/binding`) is excluded — MVP uses default
  weights (`research.md:69-88`).
- **Schema**: one migration, `supabase/migrations/20260527000000_flashcard_schema.sql`. The
  `flashcards` table has table-level, per-operation RLS keyed on `auth.uid() = user_id`
  (`select_own` / `insert_own` / `update_own` / `delete_own`) plus `idx_flashcards_user_id`.
  Adding columns via `ALTER TABLE` inherits that RLS — no new policies needed
  (`research.md:90-130`).
- **API/services**: flashcard routes (`src/pages/api/flashcards/{index,[id],generate,export}.ts`)
  follow a rigid template — `export const prerender = false`, `createClient(headers, cookies)`
  then `supabase.auth.getUser()`, zod `safeParse`, `Response(JSON.stringify({ <key> }), …)`,
  errors `{ error }`. DB access is inline via PostgREST `{ data, error }`. The only extracted
  service, `src/lib/services/generate.ts`, takes no client/userId and throws on failure
  (`research.md:132-160`).
- **Frontend**: `src/components/generate/GenerateView.tsx` is a phase-based island
  (`idle → loading → review`) using `useState` + `fetch` — a near-exact template for a review
  session. shadcn `Button` ships `cosmic` / `cosmic-outline` / `cosmic-ghost` variants; `Card`,
  `Dialog`, `Skeleton` available. Nav lives in `src/components/Topbar.astro:30-44`; protected
  pages are gated by `PROTECTED_ROUTES` in `src/middleware.ts:4` (`research.md:162-181`).
- **Date convention**: the codebase never lets a JS `Date` cross the DB/wire boundary — all
  timestamps are ISO `string` over `timestamptz`, relying on PostgREST serialization. `ts-fsrs`
  is the first dependency that produces/consumes `Date`s, so a `Date ⇄ ISO-string` adapter is
  the one net-new seam (`research.md:50-61, 216-218`).

## Desired End State

A logged-in user clicks **Nauka** in the nav, lands on `/review`, and is shown the first due
card (foreign word). They recall the meaning, click **Pokaż odpowiedź** to reveal the
translation (+ context), then click one of four rating buttons — each labelled with its
predicted next interval (e.g. `Dobrze · 3d`). The card's FSRS state updates and persists, the
next due card appears, and when the queue is empty they see an **"All caught up"** panel with
review count and links to Generate / Collection. New and existing cards are all schedulable
(existing rows backfilled to a "New" FSRS card, due now).

**Verify**: with seeded flashcards, `/review` walks the full due queue ordered by `due` asc;
each grade changes the persisted `due`/`state`/`reps`; reloading `/review` re-fetches the
updated queue; an empty queue shows the caught-up panel; unauthenticated access to `/review`
redirects to `/auth/signin`.

### Key Discoveries:

- RLS inheritance: `ALTER TABLE flashcards ADD COLUMN …` needs no new policies
  (`research.md:126-130`).
- Route template to copy verbatim: `src/pages/api/flashcards/index.ts:6-79`.
- Island template: `src/components/generate/GenerateView.tsx` (phase-state machine).
- Nav + protection wiring: `src/components/Topbar.astro:30-44`, `src/middleware.ts:4`.
- `ts-fsrs` `Card` shape must be verified against the installed version before finalizing
  migration columns (`research.md:63-65, 247-249`).

## What We're NOT Doing

- **No FSRS optimizer / per-user weight training** (`@open-spaced-repetition/binding`, WASM) —
  default weights only.
- **No review-history / `review_logs` table** — we persist only current per-card state, not a
  per-review audit trail. Learning stats remain a Non-Goal (roadmap §Parked).
- **No sibling `flashcard_srs` table** — state lives on `flashcards`.
- **No user-facing FSRS settings** (`request_retention`, `maximum_interval`) — hardcoded MVP
  defaults via `fsrs()`.
- **No production-direction study** (translation → word) and **no per-session direction
  toggle** — single direction: foreign word → recall translation.
- **No per-session card cap** and **no new-card injection logic** — the queue is exactly the
  cards with `due <= now()`.
- **No automated test runner** — verification is static checks + manual (the project has no
  test suite yet).
- **No due-count badge** on nav/dashboard.

## Implementation Approach

Build bottom-up in four phases, each independently verifiable: (1) land the dependency,
migration, and types; (2) encapsulate all `ts-fsrs` usage and the `Date ⇄ ISO` seam in a
single server-side service; (3) expose two API routes over that service following the existing
template; (4) build the review island + page and wire nav/middleware. `ts-fsrs` stays
**server-only** — the due endpoint returns each card already enriched with the four
next-interval previews (computed via `scheduler.repeat()`), so the client island never imports
the scheduler and stays a thin renderer.

## Critical Implementation Details

- **Date ⇄ ISO seam is isolated to the service.** `ts-fsrs` `createEmptyCard()`, `repeat()`,
  and `next()` operate on a `Card` whose `due`/`last_review` are JS `Date`s. The DB stores ISO
  strings in `timestamptz`. The service must hydrate a DB row → `Card` (`new Date(row.due)`,
  `row.last_review ? new Date(row.last_review) : undefined`) before calling the scheduler, and
  serialize back (`card.due.toISOString()`, `card.last_review?.toISOString() ?? null`) before
  writing. Do **not** use the docs' §5 `getTime()` epoch-ms variant — columns are `timestamptz`.
- **Verify the `Card` interface before the migration.** After `npm install ts-fsrs`, check the
  exact `Card` field names/types in the installed version (`node_modules/ts-fsrs` types or
  TypeDoc) against the nine columns. Recent versions have added/renamed fields; a mismatch is a
  silent data-loss footgun (`research.md:63-65`).
- **Backfill correctness.** Column DEFAULTs (`due = NOW()`, `state = 0`, numeric `0`) must
  reproduce a `createEmptyCard()` "New" card so existing rows are immediately and correctly
  schedulable. Confirm `createEmptyCard()`'s defaults match (notably `stability`/`difficulty`
  for a New card) when verifying the interface.

## Phase 1: Dependency, Schema Migration & Types

### Overview

Install `ts-fsrs`, extend the `flashcards` table with FSRS state columns (RLS inherited), and
update shared types.

### Changes Required:

#### 1. Add the dependency

**File**: `package.json` (+ lockfile)

**Intent**: Add `ts-fsrs` as a production dependency so the scheduler is available in SSR
routes.

**Contract**: `npm install ts-fsrs` adds an entry under `dependencies`. Pin the resolved
version; note it for the interface-verification step.

#### 2. SRS state migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_flashcard_srs_state.sql` (new)

**Intent**: Add the nine FSRS columns to `flashcards` with backfill-safe defaults and an index
for the due query. No RLS changes — existing per-operation policies cover new columns.

**Contract**: `ALTER TABLE flashcards ADD COLUMN` for `due timestamptz NOT NULL DEFAULT NOW()`,
`stability double precision NOT NULL DEFAULT 0`, `difficulty double precision NOT NULL DEFAULT
0`, `elapsed_days integer NOT NULL DEFAULT 0`, `scheduled_days integer NOT NULL DEFAULT 0`,
`reps integer NOT NULL DEFAULT 0`, `lapses integer NOT NULL DEFAULT 0`, `state smallint NOT
NULL DEFAULT 0 CHECK (state BETWEEN 0 AND 3)`, `last_review timestamptz` (nullable); plus
`CREATE INDEX idx_flashcards_due ON flashcards(user_id, due);`. Column names must match the
verified `ts-fsrs` `Card` fields 1:1. Use the timestamp naming format
`YYYYMMDDHHmmss_flashcard_srs_state.sql`.

#### 3. Shared types

**File**: `src/types.ts`

**Intent**: Reflect the new columns on the read type and add a focused DTO for review writes.

**Contract**: Extend `Flashcard` with `due: string`, `stability: number`, `difficulty:
number`, `elapsed_days: number`, `scheduled_days: number`, `reps: number`, `lapses: number`,
`state: number`, `last_review: string | null`. Add a `Rating`-input type (the four grades) and,
if helpful, a `DueCard` type = `Flashcard` + a `preview` map of rating → next-interval label.
Keep timestamps as `string` (ISO), consistent with `created_at`/`deleted_at`.

### Success Criteria:

#### Automated Verification:

- Dependency installs and lockfile updates: `npm install ts-fsrs`
- Migration applies cleanly against a fresh DB: `npx supabase db reset`
- Type check passes: `npx astro check`
- Lint passes: `npm run lint`

#### Manual Verification:

- Installed `ts-fsrs` `Card` interface verified field-by-field against the nine migration
  columns (names + types), and `createEmptyCard()` defaults match the column DEFAULTs.
- In Supabase Studio, existing `flashcards` rows show populated FSRS defaults (`state = 0`,
  `due ≈ now`, numerics `0`, `last_review` null).

**Implementation Note**: After completing this phase and all automated verification passes,
pause for manual confirmation before proceeding.

---

## Phase 2: SRS Service Layer

### Overview

Encapsulate all `ts-fsrs` usage and the `Date ⇄ ISO-string` seam in one server-side service.

### Changes Required:

#### 1. SRS service

**File**: `src/lib/services/srs.ts` (new)

**Intent**: Provide the scheduler, the due-card query (with next-interval previews), and the
rating-application logic, keeping `ts-fsrs` and date conversion out of routes and the client.

**Contract**: Export a shared scheduler `const scheduler = fsrs()` (default weights). Export:
- `getDueCards(supabase, userId): Promise<DueCard[]>` — selects `flashcards` where `due <=
  now()` ordered by `due` asc; for each row, hydrate a `Card` and call `scheduler.repeat(card,
  now)` to derive the four next-interval preview labels; return cards + previews. Throws on DB
  error.
- `reviewCard(supabase, userId, cardId, rating): Promise<Flashcard>` — load the row (RLS scopes
  to the user), hydrate `Card`, `scheduler.next(card, now, rating)`, serialize the updated card
  fields back to ISO/numeric, `UPDATE flashcards … WHERE id = cardId`, return the updated row.
  Throws on not-found / DB error.

Internal helpers `rowToCard(row)` and `cardToColumns(card)` own the `Date ⇄ ISO` conversion
(see Critical Implementation Details). Map the four rating buttons to `ts-fsrs` `Rating`
enum values. Interval label formatting (e.g. days/minutes) lives here so the client stays thin.

### Success Criteria:

#### Automated Verification:

- Type check passes: `npx astro check`
- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- A temporary scratch invocation (or first use via Phase 3) confirms `reviewCard` with each
  rating changes `due`/`state`/`reps`/`last_review` sensibly and that a re-hydrated card feeds
  back into the scheduler without `Invalid Date`.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: API Endpoints

### Overview

Expose the service over two routes following the existing flashcard-route template.

### Changes Required:

#### 1. List due cards

**File**: `src/pages/api/flashcards/due.ts` (new)

**Intent**: Return the current user's due cards with preview hints for the review session.

**Contract**: `export const prerender = false;` + `GET: APIRoute`. Create client → `getUser()`
→ 401 if absent → `getDueCards(supabase, user.id)` → `Response(JSON.stringify({ cards }), {
status: 200, headers })`. Service errors caught → `{ error }` / 500. No request body.

#### 2. Submit rating

**File**: `src/pages/api/flashcards/[id]/review.ts` (new)

**Intent**: Apply a rating to one card and persist the new FSRS state.

**Contract**: `export const prerender = false;` + `POST: APIRoute`. Create client → `getUser()`
→ 401 → parse `context.params.id` → zod `safeParse` body `{ rating }` (enum of the four
grades) with the standard error message extraction → `reviewCard(supabase, user.id, id,
rating)` → `Response(JSON.stringify({ card }), { status: 200, headers })`. Invalid body → 400;
card not found → 404; service error → 500. (Route nesting `[id]/review.ts` mirrors the existing
`[id].ts` param pattern.)

### Success Criteria:

#### Automated Verification:

- Type check passes: `npx astro check`
- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- `GET /api/flashcards/due` (authenticated, `npm run dev`) returns due cards with four preview
  labels each; returns `[]` when nothing is due.
- `POST /api/flashcards/<id>/review` with `{ "rating": "good" }` returns the updated card with a
  later `due`; an invalid rating returns 400; an unknown id returns 404; unauthenticated returns
  401.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Review UI, Page, Nav & Middleware

### Overview

Build the review-session island and wire it into routing, navigation, and protection.

### Changes Required:

#### 1. Review session island

**File**: `src/components/review/ReviewSession.tsx` (new)

**Intent**: Drive the study loop: fetch the due queue, show one card at a time (word → reveal
translation → grade), advance, and show an end/empty panel.

**Contract**: Phase-state island modelled on `GenerateView` —
`phase: "loading" | "reviewing" | "empty" | "done"`. On mount, `fetch("/api/flashcards/due")`
→ if empty, `phase = "empty"`; else `phase = "reviewing"` at index 0. Per card: show `word`;
**Pokaż odpowiedź** reveals `translation` + `context`; render four rating buttons using `cosmic`
variants, each labelled with its preview interval from the card payload. On click, `POST
/api/flashcards/<id>/review` with the chosen rating, increment a reviewed counter, advance the
index; past the last card → `phase = "done"`. `empty`/`done` render an "all caught up" panel
(reviewed count when applicable) with links to `/generate` and `/collection`. Use `Skeleton`
while loading and a `{ error }`-driven error state, matching existing islands. No `ts-fsrs`
import — previews come from the API.

#### 2. Review page

**File**: `src/pages/review.astro` (new)

**Intent**: Host the island inside the authenticated layout.

**Contract**: `import AppLayout` + `ReviewSession`; render `<AppLayout title="Nauka">
<ReviewSession client:load /></AppLayout>`, mirroring `collection.astro`.

#### 3. Navigation entry

**File**: `src/components/Topbar.astro`

**Intent**: Add a **Nauka** link so the review page is reachable.

**Contract**: Add `<a href="/review" class:list={[linkClass("/review")]}>Nauka</a>` alongside the
existing Dashboard / Generate / Collection links (`Topbar.astro:30-44`), reusing the
`linkClass` active-state helper.

#### 4. Route protection

**File**: `src/middleware.ts`

**Intent**: Require auth for `/review`.

**Contract**: Add `"/review"` to `PROTECTED_ROUTES` (`middleware.ts:4`).

### Success Criteria:

#### Automated Verification:

- Type check passes: `npx astro check`
- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- **Nauka** appears in the nav on authenticated pages and is active on `/review`.
- Visiting `/review` while logged out redirects to `/auth/signin`.
- With due cards seeded, the session shows the foreign word, reveals translation + context on
  demand, shows four rating buttons with interval hints, advances through the full queue ordered
  by `due` asc, and persists state (reloading re-fetches the updated queue).
- Emptying the queue (grade everything, or a fresh account with nothing due) shows the
  "all caught up" panel with the reviewed count and working links.
- No visual regressions on existing pages from the nav change.

**Implementation Note**: Final phase — confirm the full manual walkthrough before archiving.

---

## Testing Strategy

The project has no automated test suite; verification is static checks + manual walkthrough
(consistent with prior slices).

### Static checks (every phase):

- `npx astro check`, `npm run lint`, `npm run build`.

### Migration check (Phase 1):

- `npx supabase db reset` applies both migrations cleanly; existing rows backfill correctly.

### Manual end-to-end (Phase 4):

1. Sign in; seed/generate a few flashcards.
2. Open **Nauka** → study the queue; reveal answers; grade with each of the four buttons.
3. Confirm `due`/`state`/`reps` change in Supabase Studio and the queue shrinks.
4. Reach the end → "all caught up" panel; follow the links.
5. Log out → `/review` redirects to sign-in.
6. Edge: empty queue shows the caught-up panel, not an error or blank screen.

## Performance Considerations

The due query is indexed by `idx_flashcards_due (user_id, due)`. `scheduler.repeat()` runs once
per due card to build previews — negligible for MVP deck sizes (flat-list MVP, ~hundreds of
cards). No per-session cap is applied; a very large backlog yields a long session, an accepted
MVP limitation.

## Migration Notes

Single additive migration; no data migration beyond column DEFAULTs, which backfill existing
rows to a "New" FSRS card (due now, state 0, zeroed numerics). Rollback = drop the added columns
and `idx_flashcards_due`. Verify the `ts-fsrs` `Card` interface against the installed version
before applying (Phase 1 manual step).

## References

- Internal research: `context/changes/srs-flow/research.md`
- External library selection: `context/changes/srs-flow/srs-flow-research.md`
- ts-fsrs API/schema reference: `context/changes/srs-flow/ts-fsrs-docs.md`
- Roadmap slice: `context/foundation/roadmap.md:139-152`
- Route template: `src/pages/api/flashcards/index.ts:6-79`
- Island template: `src/components/generate/GenerateView.tsx`
- Schema + RLS precedent: `supabase/migrations/20260527000000_flashcard_schema.sql:2-30`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Dependency, Schema Migration & Types

#### Automated

- [x] 1.1 Dependency installs and lockfile updates (`npm install ts-fsrs`)
- [x] 1.2 Migration applies cleanly against a fresh DB (`npx supabase db reset`)
- [x] 1.3 Type check passes (`npx astro check`)
- [x] 1.4 Lint passes (`npm run lint`)

#### Manual

- [x] 1.5 Installed `ts-fsrs` `Card` interface verified 1:1 against the nine columns; `createEmptyCard()` defaults match column DEFAULTs
- [x] 1.6 Existing `flashcards` rows show populated FSRS defaults in Supabase Studio

### Phase 2: SRS Service Layer

#### Automated

- [ ] 2.1 Type check passes (`npx astro check`)
- [ ] 2.2 Lint passes (`npm run lint`)
- [ ] 2.3 Build passes (`npm run build`)

#### Manual

- [ ] 2.4 `reviewCard` with each rating changes state sensibly; re-hydrated card feeds back into the scheduler without `Invalid Date`

### Phase 3: API Endpoints

#### Automated

- [ ] 3.1 Type check passes (`npx astro check`)
- [ ] 3.2 Lint passes (`npm run lint`)
- [ ] 3.3 Build passes (`npm run build`)

#### Manual

- [ ] 3.4 `GET /api/flashcards/due` returns due cards with four preview labels each; `[]` when nothing due
- [ ] 3.5 `POST /api/flashcards/<id>/review` updates the card (later `due`); 400 invalid rating, 404 unknown id, 401 unauthenticated

### Phase 4: Review UI, Page, Nav & Middleware

#### Automated

- [ ] 4.1 Type check passes (`npx astro check`)
- [ ] 4.2 Lint passes (`npm run lint`)
- [ ] 4.3 Build passes (`npm run build`)

#### Manual

- [ ] 4.4 **Nauka** nav link present and active on `/review`; logged-out `/review` redirects to sign-in
- [ ] 4.5 Session walkthrough: word → reveal → four hinted buttons → advances full queue (due asc) → state persists across reload
- [ ] 4.6 Empty/finished queue shows "all caught up" panel with reviewed count + working links
- [ ] 4.7 No visual regressions on existing pages from the nav change
