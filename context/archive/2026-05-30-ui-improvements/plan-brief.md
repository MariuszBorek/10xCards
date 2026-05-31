# UI Consistency — Cosmic Theme for /collection & /generate — Plan Brief

> Full plan: `context/changes/ui-improvements/plan.md`
> Assessment input: `context/changes/s04-s05-parallel-assessment.md`

## What & Why

`/collection` and `/generate` render on the default **light** shadcn theme (white background, near-black buttons), while every other page in the app — landing, dashboard, and all auth pages — uses the **cosmic dark** theme (dark gradient, glass cards, blue/purple buttons). This slice (roadmap S-04) brings the two outliers up to the cosmic look so the app feels like one product.

## Starting Point

The app has two visual worlds. Cosmic pages apply `bg-cosmic` (`global.css:113`) locally in their wrappers with literal Tailwind colors; the two React views (`CollectionView.tsx`, `GenerateView.tsx`) have no such wrapper and inherit the light `bg-background` body, using stock shadcn `Card`/`Button`/`Dialog`. A dormant `.dark` token block exists but is never applied.

## Desired End State

Visiting `/collection` and `/generate` looks identical in theme to `/dashboard`: cosmic background, glass cards, white text, gradient headings, blue/purple buttons — across every state (forms, edit mode, delete dialog, candidate accept/edit/reject, accepted-success, skeletons, empty/error states). The already-cosmic pages are untouched.

## Key Decisions Made

| Decision      | Choice                                           | Why (1 sentence)                                                                   | Source            |
| ------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------- | ----------------- |
| Direction     | Cosmic dark everywhere                           | Most of the app is already cosmic; aligning the 2 outliers avoids wide regression. | Plan              |
| Scope         | Both `/collection` **and** `/generate`           | Identical problem + near-identical components; avoids a near-duplicate follow-up.  | Plan              |
| Mechanism     | Point-fix inside the React views only            | Keeps S-04 out of `Layout.astro`/pages → zero file overlap with S-05 (nav).        | Assessment + Plan |
| Buttons       | Add reusable `cosmic` Button variants            | One named source of truth matching dashboard; avoids scattered literal colors.     | Plan              |
| Restyle depth | Full glass restyle incl. dialog + accepted-state | Prevents jarring light fragments (white card / green flash) on a dark page.        | Plan              |

## Scope

**In scope:** `ui/button.tsx` (new cosmic variants); `CollectionView.tsx`, `FlashcardItem.tsx`, `GenerateView.tsx`, `CandidateCard.tsx` (cosmic shell, glass cards, dark inputs, recolored buttons, dialog + accepted-state remap).

**Out of scope:** `Layout.astro`, `collection.astro`, `generate.astro`, `Topbar.astro` (S-05's files); global `.dark` mode / CSS token edits; the already-cosmic pages; any behavior/logic/API change; a nav bar (S-05); a theme toggle.

## Architecture / Approach

Each view owns its full-bleed cosmic shell: the root `<div>` gets `bg-cosmic min-h-screen` (mirroring `dashboard.astro:8`) since the Layout body stays light. Cards adopt the glass pattern (`border-white/10 bg-white/10 backdrop-blur-xl`); buttons route through new `cosmic` / `cosmic-outline` / `cosmic-ghost` variants. Canonical button mapping: primary → cosmic blue (matches dashboard), secondary/cancel → glass, destructive → dark-tuned red. The green "Saved" candidate state is remapped to emerald-on-glass.

## Phases at a Glance

| Phase                          | What it delivers                                         | Key risk                                               |
| ------------------------------ | -------------------------------------------------------- | ------------------------------------------------------ |
| 1. Cosmic Button variants      | `cosmic`/`cosmic-outline`/`cosmic-ghost` in `button.tsx` | Variant colors must match dashboard's existing buttons |
| 2. Theme Collection view       | `/collection` + `FlashcardItem` (incl. delete dialog)    | Dialog / inputs / edit mode missed → light fragments   |
| 3. Theme Generate view         | `/generate` + `CandidateCard` (incl. accepted-state)     | Green success state clashing on dark; raw `<input>`s   |
| 4. Cross-tab consistency sweep | Verified coherence; reconcile any drift                  | Regressing an already-correct page; residual mismatch  |

**Prerequisites:** F-01 (done); app runnable via `npm run dev` with auth working.
**Estimated effort:** ~1–2 sessions across 4 phases; cosmetic, low-risk, fully reversible.

## Open Risks & Assumptions

- **Assumption:** the cosmic dark theme is the intended app direction (confirmed during planning) — not a transitional look soon to be replaced.
- **Risk:** missing a single state (a dialog, a disabled button, an error notice) leaves a light fragment on dark; mitigated by the explicit per-state manual checklist and the Phase 4 sweep.
- **Risk (low):** button-color drift between blue (dashboard) and purple (auth/landing) conventions; mitigated by the canonical mapping (blue = primary) and Phase 4 reconciliation.
- **Coordination:** stays inside S-04's owned files so S-05 (nav) can run in parallel; if that contract is dropped, sequence S-05 first.

## Success Criteria (Summary)

- `/collection` and `/generate` are visually indistinguishable in theme from `/dashboard` across all states.
- Landing, dashboard, and auth pages look exactly as before — no regression.
- Buttons share one consistent blue/glass/red vocabulary app-wide; no light-on-dark fragments remain.
