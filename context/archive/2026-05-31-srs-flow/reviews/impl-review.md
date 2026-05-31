<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: SRS Review Flow (S-06)

- **Plan**: context/changes/srs-flow/plan.md
- **Scope**: All 4 phases
- **Date**: 2026-05-31
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Due query does not exclude soft-deleted cards

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/srs.ts:74-79, 114-119
- **Detail**: getDueCards / reviewCard filter by user_id + due but not `deleted_at IS NULL`. Matches the rest of the codebase (index.ts GET also ignores deleted_at; DELETE is a hard delete), so deleted_at is vestigial everywhere — not a regression. Flag only so that if soft-delete is ever wired up, the review queue must be updated in lockstep.
- **Fix**: No action now. Revisit only when/if soft-delete is activated.
- **Decision**: FIXED — added `.is("deleted_at", null)` to getDueCards query and reviewCard load.

### F2 — idx_flashcards_due overlaps idx_flashcards_user_id

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: supabase/migrations/20260531000000_flashcard_srs_state.sql:19
- **Detail**: The new composite (user_id, due) index has user_id as its leading column, so it can also serve the plain user_id lookups that idx_flashcards_user_id covers — a minor redundancy. Keeping both is fine; dropping the older one would be a micro-optimization only.
- **Fix**: No action — both indexes are inexpensive at MVP scale.
- **Decision**: FIXED (Fix differently) — folded `DROP INDEX IF EXISTS idx_flashcards_user_id` into the srs migration; db reset verified only flashcards_pkey + idx_flashcards_due remain.

### F3 — reviewCard read-modify-write is not atomic

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/srs.ts:106-140
- **Detail**: reviewCard does SELECT current state → compute next → UPDATE in two non-atomic statements. Concurrent POSTs for the same card could lost-update. Negligible for a single-user SRS flow (client disables buttons via `submitting`). Acceptable for MVP per the plan's scale.
- **Fix**: No action for MVP. If multi-device concurrency matters, move the read-modify-write into a Postgres function / optimistic version check.
- **Decision**: FIXED + ACCEPTED-AS-RULE (lessons.md "Persisted read-modify-write state must guard against lost updates") — added an optimistic `reps` guard to the reviewCard UPDATE; PGRST116 → "Review conflict" mapped to HTTP 409 in the route.
