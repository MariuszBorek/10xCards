<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Generation, persistence & output-safety integrity tests

- **Plan**: context/changes/testing-generation-integrity/plan.md
- **Scope**: Full plan — Phases 1–5 of 5
- **Date**: 2026-06-04
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Automated success criteria across phases verified green in the current tree: `npm test` (47 passing, 10 files), `npm run lint` (no errors), `npx astro check` (0 errors, 0 warnings). All manual Progress items confirmed by the implementer.

## Findings

### F1 — Leading-whitespace CSV formula-injection bypass

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/anki-export.ts:21
- **Detail**: `serializeAnkiField` neutralizes only when `value[0]` is a formula leader (`= + - @` tab). A field whose dangerous char is preceded by whitespace — e.g. `" =cmd|'/c calc'!A1"` (leading space), or content starting with CR/LF that collapses to a leading space — is returned verbatim. Many spreadsheet/Anki importers trim leading whitespace before evaluating, re-exposing the formula. This is the exact #7 risk this phase was chartered to close, and `test/output-safety/anki-export.test.ts` has no leading-whitespace case, so the gap ships green. The plan's contract itself says "first character," so this is a plan-level gap inherited by the implementation, not drift. The primary vector (bare leading `= + - @` tab) IS correctly covered.
- **Fix**: Check the first non-whitespace char of the collapsed string:
  ```ts
  const collapsed = value.replace(/[\t\n\r]/g, " ");
  if (collapsed.trimStart().length && FORMULA_LEADERS.has(collapsed.trimStart()[0])) return `'${collapsed}`;
  return collapsed;
  ```
  Then add a `" =cmd"` / leading-space case to `test/output-safety/anki-export.test.ts` (fails against current code, passes once fixed). Closes the CR/LF variant in the same move.
  - Strength: Aligns with OWASP CSV-injection guidance (neutralize on trimmed content); one pure-function edit + one test, no API/DB/route change.
  - Tradeoff: Slightly widens the plan's stated "first character" contract — worth a one-line note in §6.5 / the source comment so the broadened rule is documented.
  - Confidence: HIGH — bypass verified directly against the code; the function is pure and unit-tested.
  - Blind spot: Exact trim behavior varies per importer (Excel vs LibreOffice vs Anki); the trimmed-check is the safe superset regardless.
- **Decision**: ACCEPTED (2026-06-04) — risk accepted by the user. The primary leader vector (bare `= + - @` tab) is neutralized; the leading-whitespace variant is left open for now. Re-open if/when the export opens to untrusted multi-user content.

### F2 — Unplanned GenerateView.tsx error-surfacing change

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/generate/GenerateView.tsx
- **Detail**: A ~10-line hunk now reads the server's JSON `error` body on a non-ok response and surfaces it (with a generic fallback) instead of throwing a fixed `"Generation failed"`. Not listed in the plan's Changes Required. It is the client half that makes the new server-side oversized-input 400 message reach the user — directly serving Phase 2's manual criterion 2.7. It is NOT a "client-component refactor" (the excluded item): no React-internals restructuring, no test targets React. Faithful completion of stated intent rather than added scope — flagged only because it was undocumented.
- **Fix**: Add a one-line addendum under Phase 2 in plan.md noting the GenerateView error-body surfacing as the client counterpart of the server 400 message. (Or accept as-is — code is sound.)
- **Decision**: ACCEPTED (2026-06-04) — accepted as-is; code is sound and serves Phase 2 criterion 2.7.

### F3 — Export route authz/owner-scoping is unproven by tests

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/pages/api/flashcards/export.ts:12-24, 35
- **Detail**: Phase 4 covers the pure serializer unconditionally, but the export ROUTE's 401 + RLS owner-scoping path has no test in this change. The route self-gates correctly (getUser → 401) and RLS scopes the select, matching siblings — so this is coverage breadth, not a defect. It sits under the lessons.md "four RLS-sole endpoints" rule (export is one of them).
- **Fix**: Optional — a small export-route integration test (mirror flashcards-handler.test.ts: B's export excludes A's rows) would close it; reasonable to defer to the Phase 3 quality-gates rollout. No action needed now.
- **Decision**: DEFERRED (2026-06-04) — coverage breadth, not a defect; deferred to the Phase 3 quality-gates rollout.
