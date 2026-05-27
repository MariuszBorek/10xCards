# Collection Management — Plan Brief

> Full plan: `context/changes/collection-management/plan.md`

## What & Why

Adds a `/collection` page implementing S-02 from the roadmap: users can manually add flashcards, browse their full collection (from both manual add and AI generation), edit any card in-place, and delete with a confirmation dialog. Completes the basic lifecycle management that makes the AI generation flow useful long-term.

## Starting Point

The `flashcards` table is fully provisioned with per-operation RLS. A `POST /api/flashcards` endpoint exists. No GET, PATCH, or DELETE endpoints exist, and there is no collection page or navigation link.

## Desired End State

Authenticated users navigate to `/collection` via the Topbar, see all their flashcards newest-first, add new ones via an inline form at the top, edit inline (same UX as CandidateCard), and delete via a shadcn/ui Dialog confirmation. Unauthenticated access redirects to sign-in.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Delete strategy | Hard delete | Simpler queries (no `deleted_at` filter) and undo is a PRD Non-Goal | Plan |
| Add form placement | Inline at top, always visible | Zero extra clicks; matches single-panel generate page pattern | Plan |
| Edit UX | Inline, matching CandidateCard | Reuses proven component shape; no new modal state needed | Plan |
| Empty state | Message + link to /generate | Routes users to the primary value flow (AI generation) | Plan |
| Operation feedback | Inline errors, no toast | Zero new dependencies; matches generate/auth patterns | Plan |
| Navigation | Add "Collection" alongside "Dashboard" | Both pages stay accessible; Dashboard remains the intro hub | Plan |

## Scope

**In scope:** GET/PATCH/DELETE API endpoints, `FlashcardItem` + `CollectionView` React components, `collection.astro` page, route protection in middleware, Topbar nav link, install `Input` + `Dialog` from shadcn/ui.

**Out of scope:** Pagination, search/filter, soft delete, undo, toast notifications, edit modal.

## Architecture / Approach

Standard Astro SSR + React island pattern: minimal Astro shell wraps a React component that fetches on mount. API follows the existing auth + Zod + Supabase pattern in `POST /api/flashcards`. New `[id].ts` dynamic route handles `PATCH` and `DELETE`; existing `index.ts` gains a `GET`. RLS enforces ownership at the DB layer for all operations; implementer must check for null data after PATCH/DELETE to detect RLS-blocked requests.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. API layer | GET (list), PATCH (update), DELETE (remove) endpoints | PATCH/DELETE: Supabase returns null data on RLS block — must check explicitly and return 404 |
| 2. UI components | `FlashcardItem` (inline edit + delete dialog) + `CollectionView` (add form + list + empty state) | Two new shadcn/ui installs (Input, Dialog) needed before building; run lint immediately after |
| 3. Page + nav | `collection.astro`, route protection, Topbar link | Straight wiring of previous phases — low risk |

**Prerequisites:** F-01 (flashcard-schema) and S-01 (ai-generation-flow) both archived ✓  
**Estimated effort:** ~2 sessions across 3 phases

## Open Risks & Assumptions

- Input and Dialog installs may surface Tailwind 4 class warnings — run `npm run lint` immediately after install and fix before building components.
- Collection fetches all flashcards on mount with no pagination — acceptable at MVP scale per PRD, but performance degrades past ~200 cards.

## Success Criteria (Summary)

- User can add, browse, edit, and delete flashcards on `/collection`
- Flashcards saved via the AI generation flow appear in the collection
- Unauthenticated access to `/collection` redirects to sign-in
