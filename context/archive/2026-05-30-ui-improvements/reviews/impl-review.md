<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: UI Consistency — Cosmic Theme for /collection & /generate

- **Plan**: context/changes/ui-improvements/plan.md
- **Scope**: All 4 phases
- **Date**: 2026-05-31
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Summary

Faithful, correctly-scoped cosmetic change. All three theming phases implement the planned cosmic dark theme exactly; zero logic/behavior/data/API changes. Scope guardrails fully respected — only the 5 planned React files changed (`button.tsx`, `CollectionView.tsx`, `FlashcardItem.tsx`, `GenerateView.tsx`, `CandidateCard.tsx`); no `.astro` files, no `:root`/`.dark` CSS token edits, no global dark mode, no theme toggle. New `cosmic`/`cosmic-outline`/`cosmic-ghost` cva variants are structurally sound with `VariantProps` inference intact and existing variants untouched. Glass/cosmic values match `dashboard.astro` and `global.css` references exactly (`bg-blue-500`/`hover:bg-blue-400` primary, `border-white/20 bg-white/10 hover:bg-white/20` glass, `#0f1529` dialog backdrop = cosmic gradient mid-stop). Automated criteria (lint, build, astro check) all pass.

## Findings

### F1 — cosmic-outline omits shadow-xs

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/ui/button.tsx:22
- **Detail**: `cosmic-outline` has no `shadow-xs`, while other bordered variants (cosmic, default, secondary, outline, destructive) carry it. This is faithful to the dashboard.astro glass button (also shadowless), so it is defensible as intentional.
- **Fix**: Leave as-is — matches the cosmic reference. Add `shadow-xs` only if visual parity with `outline` is desired.
- **Decision**: FIXED (added `shadow-xs` to `cosmic-outline` for parity with other bordered variants)

### F2 — CandidateCard edit fields use raw <input>, not shadcn <Input>

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/generate/CandidateCard.tsx:34-61
- **Detail**: Edit fields are raw `<input>` with a hand-rolled `editInputClass`, while CollectionView/FlashcardItem use the shadcn `<Input>` component. Predates this slice — the diff only restyled the existing raw inputs; it did not introduce the inconsistency.
- **Fix**: Optional future cleanup to switch to `<Input>`. Out of scope for this cosmetic slice.
- **Decision**: FIXED (swapped the 3 raw `<input>`s for shadcn `<Input>`, matching CollectionView/FlashcardItem)
