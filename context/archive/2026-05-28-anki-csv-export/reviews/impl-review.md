<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Anki CSV Export

- **Plan**: context/changes/anki-csv-export/plan.md
- **Scope**: Phases 1–2 of 2
- **Date**: 2026-05-29
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation

> Note: `change.md` is marked `status: archived`. The plan still lives under
> `context/changes/` (not `context/archive/`), so this review was permitted.
> `change.md` status was intentionally left as `archived` (not flipped to
> `impl_reviewed`).

## Automated verification (re-run live during review)

- `npm run lint` → 0 errors (only benign astro-eslint parser-option warnings)
- `npx astro check` → 0 errors, 0 warnings, 4 hints (all in eslint.config.js, unrelated), 45 files

Manual success criteria (2.3–2.9, 1.3–1.6) remain unchecked in the plan's
`## Progress` — honestly pending (need a running server + Anki import), not
rubber-stamped.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Download filename drifts from plan and server header

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/collection/CollectionView.tsx:94
- **Detail**: Plan §Phase 2 contract specifies `download="anki-export.txt"`, and the endpoint sets `Content-Disposition: filename="anki-export.txt"` (export.ts:43). The implementation instead uses ``download={`anki-export-${new Date().toISOString().slice(0,10)}.txt`}`` → a dated name like `anki-export-2026-05-29.txt`. For blob URLs the anchor's `download` attribute wins, so the server header is silently overridden and the two disagree. Plan manual checks 1.3 / 2.5 / 2.6 all assert the name `anki-export.txt`. The dated name is arguably better UX but is undocumented drift from the contract.
- **Fix A ⭐ Recommended**: Keep the dated filename; update the plan contract + manual-check wording to match (`anki-export-<date>.txt`), and optionally update export.ts:43's Content-Disposition to the same for server/client consistency.
  - Strength: Dated names are genuinely better — repeated exports don't overwrite; aligns plan with shipped behavior.
  - Tradeoff: Server Content-Disposition still says the static name unless also updated.
  - Confidence: HIGH — one-line doc edit; behavior already verified.
  - Blind spot: None significant.
- **Fix B**: Revert to the literal plan contract — `download="anki-export.txt"`.
  - Strength: Restores exact plan/server agreement with zero ambiguity.
  - Tradeoff: Loses the dated-filename improvement; repeated exports overwrite the same file.
  - Confidence: HIGH — trivial revert.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — server Content-Disposition now emits the dated filename (export.ts:39,45); plan contract + manual checks 1.3 / 2.5 updated to `anki-export-<YYYY-MM-DD>.txt`.

### F2 — "CSV" nomenclature vs. tab-separated output

- **Severity**: 🔎 OBSERVATION
- **Impact**: 🏃 LOW — informational
- **Dimension**: Pattern Consistency
- **Location**: context/changes/anki-csv-export/change.md:3
- **Detail**: `change.md` title and commit messages say "CSV", but the artifact is tab-separated text (`#separator:tab`, `.txt`, `text/plain`) — Anki's native import format, not literal CSV. The plan body is internally consistent ("tab-separated text file"); only the title/commit label is loose. No code change needed — flagged so future readers aren't misled.
- **Decision**: PENDING
