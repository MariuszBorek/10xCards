# UI Consistency — Cosmic Theme for /collection & /generate Implementation Plan

## Overview

`/collection` and `/generate` render their React views on the default **light shadcn theme** (white `bg-background`, near-black `--primary` buttons), while the rest of the app — landing (`Welcome.astro`), `dashboard.astro`, and all `auth/*` pages — uses the **cosmic dark theme** (`bg-cosmic` gradient, glass cards, blue/purple buttons). This plan brings the two divergent views up to the cosmic look, working **entirely inside the React components** so that the parallel slice S-05 (navigation) can own `Layout.astro`/`*.astro` pages without collision.

## Current State Analysis

Two visual worlds exist in the codebase:

- **Cosmic dark** (de-facto app look): `bg-cosmic` utility (`src/styles/global.css:113`) + glass surfaces (`border-white/10 bg-white/10 backdrop-blur-xl`) + white text + blue/purple gradient headings + bespoke literal-color buttons. Used by `Welcome.astro`, `dashboard.astro:8`, `auth/signin.astro`, `auth/signup.astro`, `confirm-email.astro`, and `Topbar.astro`.
- **Default light shadcn** (the two outliers): `CollectionView.tsx` and `GenerateView.tsx` render on the body's `bg-background` (white — `:root` tokens at `global.css:6-39`), using default shadcn `<Card>` (white), `<Button>` (near-black `--primary`), `<Input>`/`<Textarea>`, and a `<Dialog>`.

Key facts discovered:

- `Layout.astro:21` body applies `@apply bg-background text-foreground` (light). Cosmic pages apply `bg-cosmic` **locally** in their own wrapper `<div>` (e.g. `dashboard.astro:8`). The two views have no such wrapper → they inherit the light body background.
- The `.dark` token block (`global.css:41-73`) exists but `.dark` is **never applied** to `<html>` — dark mode is dormant. The cosmic pages do **not** rely on shadcn tokens; they use literal Tailwind colors (`bg-blue-500`, `bg-purple-600`, `border-white/10`, etc.), so they are unaffected by token changes.
- Button color is inconsistent even among cosmic pages: `dashboard.astro:20` primary action is `bg-blue-500 hover:bg-blue-400`; `Welcome.astro:43`/auth use `bg-purple-600 hover:bg-purple-500`; secondary/sign-out buttons are glass (`border-white/20 bg-white/10 hover:bg-white/20`). This plan picks one canonical mapping.
- `CandidateCard.tsx:21-32` has a green "accepted" state (`border-green-200 bg-green-50 text-green-800`) that will clash on a dark background and needs a dark-friendly success treatment.
- `FlashcardItem.tsx:145-168` renders a shadcn `<Dialog>` (delete confirmation) that uses light popover tokens and must be styled for dark.
- `CandidateCard.tsx:38-60` uses **raw `<input>`** elements (`rounded border px-2 py-1`), not shadcn `<Input>` — these need explicit dark styling too.

### S-05 coordination (from `s04-s05-parallel-assessment.md`)

The sibling assessment establishes a **file-ownership contract** so S-04 and S-05 stay genuinely parallel: S-05 owns navigation placement (`Layout.astro`, `Topbar.astro`); **S-04 owns theming inside the views**. This plan honors it — S-04 touches **only** the React components, never `Layout.astro`, `collection.astro`, `generate.astro`, or `Topbar.astro`.

## Desired End State

Visiting `/collection` and `/generate` shows the same cosmic dark theme as `/dashboard`: a `bg-cosmic` background, glass cards, white text, gradient headings, and blue/purple buttons — across **all** interaction states (add/edit forms, delete dialog, candidate accept/edit/reject, accepted-success, loading skeletons, empty states, error messages). The already-cosmic pages (landing, dashboard, auth) are visually unchanged. Verify by navigating every tab and confirming no light-on-dark fragments remain and no previously-correct page regressed.

### Key Discoveries:

- Cosmic background is applied per-page locally, not globally — mirror `dashboard.astro:8` (`bg-cosmic flex min-h-screen ... p-4`) inside each view's root `<div>`. Reference: `src/pages/dashboard.astro:8`, `src/components/Welcome.astro:5`.
- Glass card pattern to reuse: `rounded-2xl border border-white/10 bg-white/10 p-… text-white backdrop-blur-xl` (`dashboard.astro:9`).
- Gradient heading pattern: `bg-gradient-to-r from-blue-200 to-purple-200 bg-clip-text text-transparent` (`dashboard.astro:10`).
- Button source of truth is `src/components/ui/button.tsx:7-33` (`cva` variants) — the clean extension point for cosmic buttons.

## What We're NOT Doing

- **Not touching** `Layout.astro`, `collection.astro`, `generate.astro`, or `Topbar.astro` (S-05's territory — preserves the parallel contract).
- **Not** enabling global `.dark` mode or editing the `:root`/`.dark` CSS token blocks (avoids app-wide side effects on already-correct pages).
- **Not** restyling the already-cosmic pages (landing, dashboard, auth) — they are the reference, not the target.
- **Not** changing any behavior, data flow, API calls, or component logic — this is purely presentational.
- **Not** adding a navigation bar (that is S-05).
- **Not** introducing a theme-toggle or light/dark switch — the app is single-theme (cosmic dark).

## Implementation Approach

Build a small reusable button vocabulary first (Phase 1), then apply the cosmic shell + glass treatment view-by-view (Phases 2–3), consuming those button variants so colors stay consistent and centralized. Finish with a cross-tab visual sweep (Phase 4) that explicitly guards the headline risk: "don't regress the tabs that already looked right." Each view phase is independently testable in the browser.

## Critical Implementation Details

- **Cosmic background must fill the viewport.** Each view's root `<div>` carries `bg-cosmic` + `min-h-screen` (mirroring `dashboard.astro:8`) so the dark background covers the page even though `Layout.astro`'s body is still light `bg-background`. Without `min-h-screen` the white body shows through below short content.
- **Canonical button mapping** (resolve the existing blue-vs-purple inconsistency): primary/confirm actions → cosmic **blue** (matches `dashboard.astro:20`, the closest analog — an authenticated app page); secondary/cancel/outline → **glass** (`border-white/20 bg-white/10 hover:bg-white/20`); destructive (Delete) → keep a red treatment tuned for dark legibility. Apply this mapping uniformly across both views.
- **Green "accepted" state remap** (`CandidateCard.tsx:21-32`): replace `border-green-200 bg-green-50 text-green-800/600/500` with a dark-surface success treatment (e.g. emerald accents on the glass card) so the success card reads as success without breaking the dark theme.

## Phase 1: Cosmic Button Variants

### Overview

Add reusable cosmic button variants to the shared shadcn button component so the views have a single, named source of truth for blue/purple/glass buttons. No callsites change yet, so there is no visual change to any page after this phase.

### Changes Required:

#### 1. Button variants

**File**: `src/components/ui/button.tsx`

**Intent**: Add cosmic variants to the `buttonVariants` `cva` map so the divergent views can render dashboard-matching buttons via a named variant instead of scattered literal classes.

**Contract**: Extend the `variant` object in `buttonVariants` (`src/components/ui/button.tsx:11-20`) with new keys — `cosmic` (solid blue primary: blue-500 base, blue-400 hover, white text), `cosmic-outline` (glass: `border-white/20 bg-white/10 text-white hover:bg-white/20`), and `cosmic-ghost` (transparent → `hover:bg-white/10 text-white/80`) for low-emphasis actions (Reject/Cancel). Do not alter existing `default`/`outline`/`destructive`/`ghost` variants. The `VariantProps<typeof buttonVariants>` type updates automatically; no signature change.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run lint` (ESLint runs type-checked rules)
- Production build succeeds: `npm run build`
- Formatting clean: `npm run format`

#### Manual Verification:

- No visual change on any existing page (no component consumes the new variants yet)
- New variants render the intended colors when spot-checked (temporary usage or Storybook-style check optional)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 2: Theme the Collection View

### Overview

Apply the cosmic shell and glass treatment to `/collection`: the view wrapper, the "Add flashcard" panel, skeletons, error/empty states, and the `FlashcardItem` card including its edit mode and delete `Dialog`.

### Changes Required:

#### 1. Collection view shell and add-form

**File**: `src/components/collection/CollectionView.tsx`

**Intent**: Wrap the view in the cosmic background and restyle the heading, add-form panel, inputs, skeletons, error text, and empty-state to the dark glass theme; route buttons through the Phase 1 cosmic variants.

**Contract**: Root `<div>` (`CollectionView.tsx:113`) gains `bg-cosmic min-h-screen` plus a centered inner container that keeps the existing `max-w-2xl` content width. Heading (`:115`) → gradient/white text. "Add flashcard" panel (`:127`) → glass card classes. `<Input>`/`<Textarea>` → dark-legible styling (white text, translucent border/background; pass via `className`). Skeletons (`:165`) → translucent variant. Error `<p>` (`text-red-600`) → a dark-legible red (e.g. `text-red-300`). Empty-state panel (`:172-179`) → glass. "Export to Anki" → `cosmic-outline`; "Add" → `cosmic`; empty-state "Generate" link button → `cosmic-outline`.

#### 2. Flashcard item card + delete dialog

**File**: `src/components/collection/FlashcardItem.tsx`

**Intent**: Restyle the shadcn `<Card>`, its text, the edit-mode inputs, the action buttons, and the delete confirmation `<Dialog>` for the dark theme.

**Contract**: `<Card>` (`FlashcardItem.tsx:79`) → glass classes via `className`. Word/translation/context text → white / `text-white/70` instead of default + `text-muted-foreground`. Edit/Save/Cancel/Delete buttons → cosmic variants (Edit→`cosmic-outline`, Save→`cosmic`, Cancel→`cosmic-ghost`, Delete→`destructive`). Inline error `<p>` → dark-legible red. `<DialogContent>` (`:146`) and its title/description → dark glass surface with white/translucent text; dialog Cancel→`cosmic-outline`, Delete→`destructive`. Inputs in edit mode → dark-legible via `className`.

### Success Criteria:

#### Automated Verification:

- Lint + type check passes: `npm run lint`
- Production build succeeds: `npm run build`
- Astro check passes: `npx astro check`

#### Manual Verification:

- `/collection` background and buttons match `/dashboard` (cosmic dark, blue/glass)
- Add-form, list cards, and edit mode are all legible on the dark background (no white-on-white or dark-on-dark text)
- Delete dialog renders on a dark surface with legible text and correctly-colored buttons
- Loading skeletons, empty-state, and error messages all read correctly on dark
- No regression to component behavior (add / edit / delete / export still work)

**Implementation Note**: After automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Theme the Generate View

### Overview

Apply the cosmic shell and glass treatment to `/generate`: the view wrapper, textarea, word-count/error notices, skeletons, the empty "no candidates" state, and the `CandidateCard` across its pending / editing / accepted states.

### Changes Required:

#### 1. Generate view shell

**File**: `src/components/generate/GenerateView.tsx`

**Intent**: Wrap the view in the cosmic background and restyle the heading, textarea, notices, skeletons, empty-state, and buttons to the dark glass theme.

**Contract**: Root `<div>` (`GenerateView.tsx:88`) gains `bg-cosmic min-h-screen` + centered inner container preserving `max-w-2xl`. Heading (`:89`) → gradient/white. `<Textarea>` (`:92`) → dark-legible via `className`. Word-count notice (`text-amber-600`, `:104`) and error (`text-red-600`) → dark-legible amber/red. Skeletons (`:117`) → translucent. Empty-state panel (`:123`) → glass; "Try again" → `cosmic-outline`, "Add manually" stays disabled (`cosmic-ghost`). "Generate" → `cosmic`.

#### 2. Candidate card (all states)

**File**: `src/components/generate/CandidateCard.tsx`

**Intent**: Restyle the pending, editing, and accepted card states for dark, including remapping the green success treatment and the raw `<input>` edit fields.

**Contract**: Pending `<Card>` (`:88`) and editing `<Card>` (`:36`) → glass classes; text → white / `text-white/70`. Raw `<input>` fields (`:39,46,54`) → dark-legible (white text, translucent border/bg). Accepted state (`:21-32`) → replace `border-green-200 bg-green-50` + `text-green-800/600/500` with a dark-surface success treatment (emerald accents on glass) that still reads as "Saved". Buttons: Accept→`cosmic`, Edit→`cosmic-outline`, Reject→`cosmic-ghost`, Save→`cosmic`, edit-Cancel→`cosmic-ghost`.

### Success Criteria:

#### Automated Verification:

- Lint + type check passes: `npm run lint`
- Production build succeeds: `npm run build`
- Astro check passes: `npx astro check`

#### Manual Verification:

- `/generate` background and buttons match `/dashboard` and the themed `/collection`
- Idle (textarea + Generate), loading (skeletons), and review states all legible on dark
- Candidate pending, editing, and accepted-success states all read correctly on dark; "Saved" still clearly communicates success
- Word-count warning and error notices are legible on the dark background
- No regression to behavior (generate / accept / edit / reject still work)

**Implementation Note**: After automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 4: Cross-Tab Consistency Sweep

### Overview

Guard the headline risk: confirm the two themed views now match the rest of the app **and** that no previously-correct page regressed. Reconcile any residual button-color or spacing drift discovered during the side-by-side comparison.

### Changes Required:

#### 1. Consistency reconciliation (only if drift found)

**File**: `src/components/ui/button.tsx` and/or the four view/card components (as needed)

**Intent**: If the side-by-side comparison reveals drift (e.g. a button shade that doesn't match dashboard, inconsistent card radius/spacing, a missed light fragment), make the minimal adjustment to align. If nothing drifts, this phase is verification-only with no code change.

**Contract**: Adjust cosmic variant values in `button.tsx` or specific `className`s in the views. No new variants, no structural changes. Stay within S-04's owned files.

### Success Criteria:

#### Automated Verification:

- Lint + type check passes: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification:

- Side-by-side walkthrough of **all** tabs — landing (`/`), `/dashboard`, `/auth/signin`, `/auth/signup`, `/collection`, `/generate` — shows one coherent cosmic theme
- Previously-cosmic pages (landing, dashboard, auth) are visually unchanged from before the slice (no regression)
- Buttons use a consistent blue/glass/red vocabulary across `/collection`, `/generate`, and `/dashboard`
- No light-on-dark or dark-on-light fragments remain in any state of either themed view

**Implementation Note**: This is the final phase. After automated verification and the full manual sweep pass, the slice is ready to archive.

---

## Testing Strategy

### Unit Tests:

- None. The project has no automated test suite (per `CLAUDE.md`), and these are presentational-only changes with no logic to unit-test.

### Integration Tests:

- None automated. The closest proxy is `npm run build` + `npx astro check` (type/build correctness) plus the manual browser sweep.

### Manual Testing Steps:

1. Run `npm run dev` and sign in.
2. Visit `/dashboard` — note the reference cosmic look (background, card, button colors).
3. Visit `/collection`: confirm cosmic background; add a flashcard; edit it; open the delete dialog; trigger an error (e.g. empty word); view the empty-state (delete all) and loading skeletons. Every state must be legible on dark.
4. Visit `/generate`: paste text and generate; review candidates; edit one; accept one (check the success state); reject one; trigger the "no candidates" empty-state and the >300-word warning.
5. Walk landing (`/`), `/auth/signin`, `/auth/signup` — confirm they look exactly as before (no regression).
6. Confirm buttons across `/collection`, `/generate`, `/dashboard` share one consistent color vocabulary.

## Performance Considerations

Negligible. Changes are CSS-class-only; no new runtime work, network calls, or bundle growth beyond a few `cva` variant strings. The cosmic background is a CSS gradient (same as existing pages) with no images.

## Migration Notes

None — no data, schema, or API changes. Fully reversible via `git revert`. No deployment steps beyond the normal build.

## References

- Parallel-implementation assessment: `context/changes/s04-s05-parallel-assessment.md` (file-ownership contract with S-05)
- Roadmap slice S-04: `context/foundation/roadmap.md:110-122`
- Cosmic reference page: `src/pages/dashboard.astro:8-34`
- Cosmic background utility: `src/styles/global.css:113`
- Glass card pattern: `src/components/Welcome.astro:58`, `src/pages/dashboard.astro:9`
- Button variants source: `src/components/ui/button.tsx:7-33`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Cosmic Button Variants

#### Automated

- [x] 1.1 Type checking passes: `npm run lint` — e60fa8d
- [x] 1.2 Production build succeeds: `npm run build` — e60fa8d
- [x] 1.3 Formatting clean: `npm run format` — e60fa8d

#### Manual

- [x] 1.4 No visual change on any existing page (no consumer of new variants yet) — e60fa8d
- [x] 1.5 New variants render intended colors when spot-checked — e60fa8d

### Phase 2: Theme the Collection View

#### Automated

- [x] 2.1 Lint + type check passes: `npm run lint` — 5370772
- [x] 2.2 Production build succeeds: `npm run build` — 5370772
- [x] 2.3 Astro check passes: `npx astro check` — 5370772

#### Manual

- [x] 2.4 `/collection` background and buttons match `/dashboard` — 5370772
- [x] 2.5 Add-form, list cards, and edit mode legible on dark — 5370772
- [x] 2.6 Delete dialog renders dark with legible text and correct buttons — 5370772
- [x] 2.7 Skeletons, empty-state, and error messages read correctly on dark — 5370772
- [x] 2.8 No regression to add / edit / delete / export behavior — 5370772

### Phase 3: Theme the Generate View

#### Automated

- [x] 3.1 Lint + type check passes: `npm run lint`
- [x] 3.2 Production build succeeds: `npm run build`
- [x] 3.3 Astro check passes: `npx astro check`

#### Manual

- [x] 3.4 `/generate` background and buttons match `/dashboard` and themed `/collection`
- [x] 3.5 Idle, loading, and review states all legible on dark
- [x] 3.6 Candidate pending / editing / accepted-success states read correctly; "Saved" still communicates success
- [x] 3.7 Word-count warning and error notices legible on dark
- [x] 3.8 No regression to generate / accept / edit / reject behavior

### Phase 4: Cross-Tab Consistency Sweep

#### Automated

- [ ] 4.1 Lint + type check passes: `npm run lint`
- [ ] 4.2 Production build succeeds: `npm run build`

#### Manual

- [ ] 4.3 All tabs (`/`, `/dashboard`, `/auth/signin`, `/auth/signup`, `/collection`, `/generate`) show one coherent cosmic theme
- [ ] 4.4 Previously-cosmic pages visually unchanged (no regression)
- [ ] 4.5 Buttons use a consistent blue/glass/red vocabulary across the app
- [ ] 4.6 No light-on-dark or dark-on-light fragments remain in any state
