<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Collection Management

- **Plan**: context/changes/collection-management/plan.md
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-05-29
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations
- **Commits reviewed**: 6bba87b (p1), 64bcef4 (p2), 343a15b (p3). CollectionView.tsx reviewed at 343a15b (export button from later anki-csv-export change excluded from scope).

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

All 8 planned changes implemented faithfully — no MISSING items, no scope creep. Automated gates re-run during review: `npm run lint` clean, `npx astro check` 0 errors (build verified at commit 343a15b).

## Findings

### F1 — PATCH maps genuine DB errors to 404

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/flashcards/[id].ts:55-57
- **Detail**: PATCH uses `.select().single()` and returns 404 on ANY error. That is what the plan contract said ("If data is null or error is set … return 404"), and it works for not-found/not-owned rows. But a real DB failure (connection drop, constraint) also surfaces as `error` and is reported as 404 "Flashcard not found" — masking a 500-class failure. The sibling POST handler in index.ts:75-77 correctly distinguishes and returns 500 on insert error. DELETE in the same file is fine (it uses count semantics). The plan contract itself was slightly imprecise here.
- **Fix**: Distinguish "no rows" (404) from a true DB error (500) — check `error.code === "PGRST116"` (no rows) for the 404 path and return 500 otherwise, matching the POST handler's error shape.
- **Decision**: PENDING

### F2 — Authorization relies solely on RLS (no explicit user_id filter)

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/flashcards/[id].ts:48,84 ; src/pages/api/flashcards/index.ts:22
- **Detail**: GET/PATCH/DELETE carry no `.eq("user_id", user.id)` — cross-user access is blocked entirely by the table's RLS policies (select_own, update_own, delete_own). This is correct and consistent with the plan's "RLS enforced at DB layer" discovery, and RLS is a hard project rule. Noted only as defense-in-depth: an explicit user_id filter would keep authz from depending on a single migration staying intact (POST already sets user_id explicitly).
- **Fix**: Optional — add `.eq("user_id", user.id)` to the three queries.
- **Decision**: PENDING

### F3 — `deleted_at` is now dead schema / dead type field

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/types.ts:7 ; supabase/migrations/20260527000000_flashcard_schema.sql:8
- **Detail**: The plan deliberately chose hard delete and documented "deleted_at column is left unused" under "What We're NOT Doing" — so this is NOT drift. Flagged only so it's on record: the `deleted_at` column and its `Flashcard.deleted_at` type field are now unused. Fine to leave for a future soft-delete/undo feature (roadmap Parked), but it's dead surface until then.
- **Fix**: None now — intentional. Revisit if undo/undelete is picked up.
- **Decision**: PENDING

### F4 — In-component heading "My Collection" vs page title "Collection"

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/collection/CollectionView.tsx (h1)
- **Detail**: Page title is "Collection" (collection.astro), the in-island `<h1>` reads "My Collection". Cosmetic label mismatch, no functional impact.
- **Fix**: Align the two strings if consistent naming is desired.
- **Decision**: PENDING
