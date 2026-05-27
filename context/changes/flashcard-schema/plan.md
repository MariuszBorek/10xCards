# Flashcard Schema Implementation Plan

## Overview

Create the `flashcards` Supabase table with per-user data isolation enforced by Row Level Security, and define the shared TypeScript entity types that S-01, S-02, and S-03 will import.

## Current State Analysis

- `supabase/migrations/` directory does not exist — needs to be created.
- Supabase auth is fully operational: `auth.uid()` available in SQL policies via the existing `@supabase/ssr` setup.
- `src/types.ts` does not exist — no shared entity types defined yet.
- All three downstream slices (S-01, S-02, S-03) are blocked on this foundation.

## Desired End State

After this plan:
- `supabase/migrations/20260527000000_flashcard_schema.sql` exists and applies cleanly via `npx supabase db reset`.
- The `flashcards` table has 7 columns: `id`, `user_id`, `word`, `translation`, `context`, `deleted_at`, `created_at`.
- RLS is enabled with four per-operation policies (`SELECT`, `INSERT`, `UPDATE`, `DELETE`), each scoped to `auth.uid() = user_id`.
- An index on `user_id` exists for RLS query performance.
- `src/types.ts` exports `Flashcard` and `FlashcardInsert` types matching the schema exactly.

### Key Discoveries:

- `src/lib/supabase.ts:4` — env vars come from `astro:env/server` (`SUPABASE_URL`, `SUPABASE_KEY`), not `process.env`; no changes to env setup needed.
- `src/middleware.ts:10` — `auth.getUser()` already fires on every request; `auth.uid()` in SQL policies will resolve correctly.
- `supabase/config.toml:58` — `schema_paths = []`; this field controls schema introspection, not migration application. Migrations in `supabase/migrations/` are picked up automatically by `supabase db reset` — no config change needed.

## What We're NOT Doing

- No API routes — S-01/S-02/S-03 add those.
- No UI components.
- No seed data.
- No Supabase type generation (`supabase gen types`) — hand-written types are sufficient and avoid a CLI dependency in CI.
- No change to `supabase/config.toml`.
- No soft-delete logic — `deleted_at` column is added so the option is available, but no filtering or soft-delete behavior is implemented here.

## Implementation Approach

Single migration file + single types file. The migration is idempotent by default (Supabase applies each migration exactly once). TypeScript types are written by hand to match the schema column-for-column; no code generation required for MVP.

## Critical Implementation Details

**Soft delete invariant:** The `deleted_at` column is `NULL` for active rows. All queries in S-01, S-02, and S-03 must include `WHERE deleted_at IS NULL` (or `.is('deleted_at', null)` in the JS client) to exclude soft-deleted rows. Omitting this filter returns logically deleted flashcards.

**UPDATE policy requires both clauses:** Supabase RLS `FOR UPDATE` policies need both `USING` (which existing rows may be updated) and `WITH CHECK` (what the updated row must satisfy). Omitting `WITH CHECK` allows a user to update a row's `user_id` to point at another user — a privilege escalation vector.

---

## Phase 1: SQL Migration

### Overview

Create `supabase/migrations/20260527000000_flashcard_schema.sql` with the table definition, RLS enable, four per-operation policies, and the `user_id` index.

### Changes Required:

#### 1. Migration file

**File**: `supabase/migrations/20260527000000_flashcard_schema.sql`

**Intent**: Define the `flashcards` table and lock it down so each authenticated user can only read and write their own rows.

**Contract**:

```sql
-- Table
CREATE TABLE flashcards (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  word        TEXT        NOT NULL,
  translation TEXT        NOT NULL,
  context     TEXT,
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-user isolation
ALTER TABLE flashcards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own" ON flashcards
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "insert_own" ON flashcards
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "update_own" ON flashcards
  FOR UPDATE
  USING     (auth.uid() = user_id)
  WITH CHECK(auth.uid() = user_id);

CREATE POLICY "delete_own" ON flashcards
  FOR DELETE USING (auth.uid() = user_id);

-- Performance index for RLS filter
CREATE INDEX idx_flashcards_user_id ON flashcards(user_id);
```

The SQL is the contract — the snippet above is authoritative for S-01/S-02/S-03.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset` exits 0 with no errors printed.

#### Manual Verification:

- Supabase Studio at `http://localhost:54323` → Table Editor shows `flashcards` table with 7 columns (`id`, `user_id`, `word`, `translation`, `context`, `deleted_at`, `created_at`).
- Studio → Authentication → Policies shows RLS enabled and 4 policies (`select_own`, `insert_own`, `update_own`, `delete_own`) on `flashcards`.
- Studio → Database → Indexes shows `idx_flashcards_user_id` on `flashcards(user_id)`.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to Phase 2.

---

## Phase 2: TypeScript Entity Types

### Overview

Create `src/types.ts` with `Flashcard` and `FlashcardInsert` types that mirror the migration schema exactly. These are the canonical shapes S-01, S-02, and S-03 import.

### Changes Required:

#### 1. Shared entity types

**File**: `src/types.ts`

**Intent**: Establish the single source of truth for the flashcard entity shape so all three consuming slices type-check against the same definition.

**Contract**:

```typescript
export interface Flashcard {
  id: string;
  user_id: string;
  word: string;
  translation: string;
  context: string | null;
  deleted_at: string | null;
  created_at: string;
}

export interface FlashcardInsert {
  user_id: string;
  word: string;
  translation: string;
  context?: string | null;
}
```

`FlashcardInsert` omits `id`, `created_at`, `deleted_at` (all server-generated defaults). `context` is optional on insert. `user_id` is included — callers set it to `supabase.auth.getUser()` uid before inserting.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes with no errors on `src/types.ts`.
- `npx astro check` passes (no type errors introduced).

#### Manual Verification:

- `src/types.ts` opens cleanly in the IDE with no type errors highlighted.
- `Flashcard` field names and types match the migration columns column-for-column.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Manual Testing Steps:

1. Run `npx supabase start` (if not already running), then `npx supabase db reset`.
2. Open Studio at `http://localhost:54323`, navigate to the `flashcards` table and verify schema.
3. In Studio → SQL Editor, run: `SELECT * FROM flashcards;` — should return 0 rows without error.
4. Verify RLS is active: as an anonymous caller (no JWT), `SELECT * FROM flashcards` should return 0 rows or a permission error depending on Studio context.
5. Confirm 4 policies are listed under Authentication → Policies → flashcards.

## Migration Notes

`npx supabase db reset` drops and re-creates the local DB, then replays all migrations in `supabase/migrations/` in filename order. This is destructive to local dev data — expected behavior during initial schema setup.

## References

- Roadmap item: `context/foundation/roadmap.md` — F-01 (flashcard-schema)
- Supabase RLS docs: https://supabase.com/docs/guides/auth/row-level-security
- Auth setup: `src/lib/supabase.ts`, `src/middleware.ts`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: SQL Migration

#### Automated

- [x] 1.1 `npx supabase db reset` exits 0 with no errors

#### Manual

- [x] 1.2 Studio shows `flashcards` table with 7 columns
- [x] 1.3 Studio shows RLS enabled with 4 policies on `flashcards`
- [x] 1.4 Studio shows `idx_flashcards_user_id` index

### Phase 2: TypeScript Entity Types

#### Automated

- [ ] 2.1 `npm run lint` passes on `src/types.ts`
- [ ] 2.2 `npx astro check` passes

#### Manual

- [ ] 2.3 `src/types.ts` fields match migration columns column-for-column
