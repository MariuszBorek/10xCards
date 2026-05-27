# Flashcard Schema — Plan Brief

> Full plan: `context/changes/flashcard-schema/plan.md`

## What & Why

Create the `flashcards` Supabase table with Row Level Security so every authenticated user reads and modifies only their own rows. This is F-01 from the roadmap — the foundation that unblocks all three product slices (S-01 AI generation, S-02 collection management, S-03 CSV export). Without it, no slice can be built.

## Starting Point

Supabase auth is fully wired (`src/lib/supabase.ts`, `src/middleware.ts`). There are no migration files yet — `supabase/migrations/` does not exist. `src/types.ts` also does not exist; no shared entity types are defined.

## Desired End State

One migration file applies cleanly via `npx supabase db reset`, producing a `flashcards` table with 7 columns and 4 per-operation RLS policies. `src/types.ts` exports `Flashcard` and `FlashcardInsert` as the canonical types for all three consuming slices.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| `context` field nullability | Nullable TEXT (NULL) | Distinguishes "not provided" from blank; standard Supabase pattern | Plan |
| TypeScript types scope | Create `src/types.ts` in this change | Prevents S-01/S-02/S-03 from independently defining incompatible shapes | Plan |
| Soft delete support | Add `deleted_at TIMESTAMPTZ NULL` now | Schema change is free today; avoids a future migration that touches all downstream queries | Plan |
| `user_id` index | Yes — `idx_flashcards_user_id` | Supabase evaluates every RLS policy via `user_id`; full scan without index | Plan |
| UPDATE RLS policy | Both `USING` + `WITH CHECK` clauses | `WITH CHECK` prevents a user from reassigning a row's `user_id` to another user | Plan |

## Scope

**In scope:**
- `supabase/migrations/20260527000000_flashcard_schema.sql` — table, RLS, index
- `src/types.ts` — `Flashcard` and `FlashcardInsert` interfaces

**Out of scope:**
- API routes (S-01/S-02/S-03)
- UI components
- Seed data
- Supabase CLI type generation
- Soft-delete query logic (column added; filtering is S-02's responsibility)

## Architecture / Approach

Single SQL migration + single TypeScript file. The migration is applied by `npx supabase db reset` (local) or `supabase db push` (cloud). Types are hand-written to match the schema — no code generation dependency in CI. All three downstream slices import from `src/types.ts`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. SQL Migration | `flashcards` table + RLS + index, applied via `supabase db reset` | RLS UPDATE policy missing `WITH CHECK` would allow user_id reassignment |
| 2. TypeScript Entity Types | `src/types.ts` with `Flashcard` + `FlashcardInsert` | Field mismatch between types and migration schema (caught by manual verification) |

**Prerequisites:** Local Supabase running (`npx supabase start`); Docker available.
**Estimated effort:** ~1 session, 2 phases (30–60 min total).

## Open Risks & Assumptions

- Soft-delete invariant: S-01/S-02/S-03 must include `WHERE deleted_at IS NULL` in every query — this is not enforced by the schema, only by convention. Documented in `plan.md § Critical Implementation Details`.
- `user_id` in `FlashcardInsert` is the caller's responsibility to set from `auth.getUser()` — not validated at the type level.

## Success Criteria (Summary)

- `npx supabase db reset` exits 0 and Studio shows the table, 4 RLS policies, and the index.
- `npm run lint` and `npx astro check` pass with `src/types.ts` in place.
- Manual Studio verification confirms RLS is active and per-user isolation holds.
