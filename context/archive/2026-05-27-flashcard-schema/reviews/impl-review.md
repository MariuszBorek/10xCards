<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Flashcard Schema Implementation Plan

- **Plan**: context/changes/flashcard-schema/plan.md
- **Scope**: Phase 1–2 of 2 (full plan)
- **Date**: 2026-05-28
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 1 warning, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Verification evidence

- DB schema (live query): 7 columns, exact names/types/nullability as planned.
- RLS enabled: `pg_class.relrowsecurity = t`.
- Policies: 4 present (`select_own`, `insert_own`, `update_own`, `delete_own`); UPDATE has both `USING` and `WITH CHECK`.
- Index: `idx_flashcards_user_id` present.
- `npm run lint`: 0 errors.
- `npx astro check`: 0 errors, 0 warnings.
- `src/types.ts`: `Flashcard`/`FlashcardInsert` match columns 1:1. The extra `FlashcardCandidate` interface was added by a later change (`ai-generation-flow`, commit a23dcad) — out of this plan's scope, not flagged.

## Findings

### F1 — RLS policies omit the `TO authenticated` role clause

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260527000000_flashcard_schema.sql:15-27
- **Detail**: All four policies are defined without a `TO` clause, so they apply to PUBLIC — every role including `anon`. Verified in the live DB: `polroles = {-}` (public) on all four. The plan's contract (plan.md:81-93) also omitted the role, so the implementation faithfully matched a flawed plan. Functionally the data is still isolated: for the `anon` role `auth.uid()` is NULL and `NULL = user_id` is never true, so anon sees zero rows — this is not active data leakage. BUT it deviates from this project's HARD RULE in CLAUDE.md ("always add granular per-operation, PER-ROLE policies"): the policies are per-operation but not per-role. Supabase's own RLS guidance also recommends `TO authenticated` so the policy isn't evaluated against `anon` at all (defense-in-depth + avoids a needless per-query check for anonymous traffic).
- **Fix A ⭐ Recommended**: Amend the existing migration to add `TO authenticated` to all four policies, then `npx supabase db reset`.
  - Strength: Unreleased foundation — no production data; db reset is the documented workflow (plan.md:174). Keeps history to one clean migration; downstream slices still see a single schema file.
  - Tradeoff: Rewrites an already-committed migration; anyone who pulled and reset before this must reset again.
  - Confidence: HIGH — local-only, destructive reset is expected per the plan's Migration Notes.
  - Blind spot: If the migration ever reached a shared/remote env, in-place editing would drift. Not confirmed local-only beyond the running stack.
- **Fix B**: Add a new follow-up migration that DROPs and re-CREATEs the four policies with `TO authenticated`.
  - Strength: Additive — never rewrites applied history; safe if the original reached a shared environment.
  - Tradeoff: Two migration files for one logical schema; the "SQL is the contract" snippet S-01/02/03 reference (plan.md:99) now spans two files.
  - Confidence: MED — correct, but adds ceremony for a pre-release schema.
  - Blind spot: None significant.
- **Decision**: PENDING
