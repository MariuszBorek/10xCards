# SRS Review Flow (S-06) — Plan Brief

> Full plan: `context/changes/srs-flow/plan.md`
> Research: `context/changes/srs-flow/research.md`

## What & Why

Let a logged-in user study their flashcards in-app on a spaced-repetition schedule, with the
algorithm coming from the external `ts-fsrs` library (default FSRS weights) rather than a
custom scheduler. Delivers roadmap slice **S-06 (srs-flow)** — the app stores per-card review
state and surfaces the cards that are due.

## Starting Point

`flashcards` exists with per-operation RLS (F-01, done) but holds no scheduling state. The
codebase has a rigid API-route template, one phase-based React island (`GenerateView`) that
maps cleanly onto a review session, and a nav/middleware pattern for protected pages. No
`ts-fsrs` dependency yet; no JS `Date` ever crosses the DB boundary today.

## Desired End State

A **Nauka** nav link opens `/review`, showing one due card at a time: foreign word → reveal
translation + context → four rating buttons (Again/Hard/Good/Easy) each labelled with its
predicted next interval. Grading advances and persists the card's FSRS state; an empty or
finished queue shows an "all caught up" panel with the reviewed count and links onward.

## Key Decisions Made

| Decision                  | Choice                                              | Why (1 sentence)                                                              | Source   |
| ------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------- | -------- |
| Library / algorithm       | `ts-fsrs`, default weights, no optimizer            | Edge-safe pure-TS scheduler; WASM optimizer can't run on Workers              | Research |
| Schema location           | Extend `flashcards` (9 columns), no new table       | Inherits existing RLS, single-row review write, smallest migration            | Plan     |
| Review history            | None (no `review_logs` table)                       | Stats are a Non-Goal; avoids a second RLS-bearing table                       | Plan     |
| Study direction           | Foreign word → recall translation                   | Matches the core "learn pasted foreign vocab" use case                        | Plan     |
| Due queue                 | All cards `due <= now()`, ordered by `due` asc      | Simplest correct FSRS behavior; uses the new `idx_flashcards_due`             | Plan     |
| Rating buttons            | Four buttons with next-interval preview hints       | Standard FSRS UX; preview is already part of the `ts-fsrs` flow               | Plan     |
| `ts-fsrs` location        | Server-only (previews computed in the service)      | Keeps the scheduler out of the client bundle; one source of config           | Plan     |
| Date handling             | `Date ⇄ ISO-string` adapter isolated in the service | Columns are `timestamptz`; codebase convention is ISO strings, not epoch-ms   | Research |
| FSRS tuning settings      | Hardcoded MVP defaults (`fsrs()`)                   | No user-facing scheduler settings needed for MVP                              | Plan     |
| Verification              | Static checks + manual + migration round-trip       | Project has no automated test suite yet                                       | Plan     |

## Scope

**In scope:** FSRS state columns on `flashcards`; `ts-fsrs` dependency; SRS service (due query
with previews + apply-rating); `GET /api/flashcards/due` + `POST /api/flashcards/[id]/review`;
review island + `/review` page; **Nauka** nav link; `/review` route protection.

**Out of scope:** FSRS optimizer / weight training; review-history table; sibling SRS table;
user-facing FSRS settings; production-direction study or direction toggle; per-session cap;
new-card injection; automated test runner; due-count badge.

## Architecture / Approach

Bottom-up, server-centric: migration + types → a single service that owns all `ts-fsrs` usage
and the `Date ⇄ ISO` seam → two thin API routes over the service → a thin client island that
renders cards and posts ratings. The due endpoint returns each card already enriched with its
four next-interval previews, so the browser never imports the scheduler.

## Phases at a Glance

| Phase                              | What it delivers                                              | Key risk                                                        |
| ---------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| 1. Dependency, migration & types   | `ts-fsrs` installed; 9 FSRS columns + index; updated types   | `Card` interface mismatch vs migration columns (data-loss)     |
| 2. SRS service                     | `getDueCards` + `reviewCard` with `Date ⇄ ISO` adapter       | Date hydration bugs (`Invalid Date`) feeding the scheduler     |
| 3. API endpoints                   | due-list + submit-rating routes                              | Param/zod/status wiring deviating from the route template      |
| 4. Review UI, page, nav, middleware| Review island + `/review` + Nauka link + protection          | Session state/advance edge cases; nav visual regression        |

**Prerequisites:** F-01 (`flashcard-schema`) done; local Supabase running for migration test.
**Estimated effort:** ~2–3 sessions across the 4 phases.

## Open Risks & Assumptions

- The installed `ts-fsrs` `Card` field names/types must be verified 1:1 against the migration
  columns before applying it (recent versions added/renamed fields).
- Default-column backfill must reproduce a `createEmptyCard()` "New" card so existing rows are
  immediately schedulable.
- Large due backlogs produce long sessions (no cap) — an accepted MVP limitation.

## Success Criteria (Summary)

- A user can study all due cards in a session, grade them, and see the schedule persist across
  reloads.
- Existing cards become schedulable (backfilled to "New", due now) with no manual data fix.
- An empty/finished queue shows a guided "all caught up" panel, and `/review` is auth-protected.
