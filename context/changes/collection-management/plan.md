# Collection Management Implementation Plan

## Overview

Add a `/collection` page where authenticated users can manually add flashcards, browse their full collection (cards from both manual add and AI generation), edit cards in-place, and delete with confirmation. Implements S-02 from the roadmap (FR-007, FR-008, FR-009, FR-010).

## Current State Analysis

The `flashcards` table is fully provisioned with per-operation RLS policies. `POST /api/flashcards` exists and handles card creation. No GET, PATCH, or DELETE endpoint exists yet. No collection page or navigation entry exists. The generate flow already writes to the same table, so all user flashcards — from any source — will appear in the collection.

## Desired End State

Authenticated user can navigate to `/collection` via the top navigation bar, see all their flashcards in a flat list ordered newest-first, add a new flashcard via an inline form at the top, edit any flashcard in-place with Save/Cancel, and delete any flashcard via a confirmation dialog. Unauthenticated users are redirected to `/auth/signin`.

### Key Discoveries:

- `flashcards` table: `id` (uuid), `user_id` (uuid), `word` (text), `translation` (text), `context` (text|null), `deleted_at` (timestamptz), `created_at` (timestamptz). Per-operation RLS on SELECT/INSERT/UPDATE/DELETE — `auth.uid() = user_id` enforced at DB layer.
- `src/types.ts` already exports `Flashcard` and `FlashcardInsert` — no new types needed.
- The existing `POST /api/flashcards/index.ts` defines the exact auth + Zod + Supabase pattern for new endpoints to follow.
- `CandidateCard.tsx` (inline edit pattern): `useState<"view"|"editing">` + local field state + Save/Cancel — use as the shape for `FlashcardItem`.
- `shadcn/ui` `Input` and `Dialog` are not yet installed; both are needed.
- `PROTECTED_ROUTES` in `src/middleware.ts`: `["/dashboard", "/generate"]` — `/collection` must be added.

## What We're NOT Doing

- Pagination or search (PRD Non-Goal — flat list is the MVP shape)
- Soft delete (`deleted_at` column is left unused; hard delete via RLS DELETE policy)
- Undo / undelete (roadmap Parked)
- Edit modal or dedicated edit page (decided: inline pattern matching CandidateCard)
- Toast notifications (decided: inline errors, list state changes are the success signal)

## Implementation Approach

Three phases in dependency order: API layer first (no UI deps), then React island (depends on API contracts), then Astro shell + navigation (depends on the component). Each phase has automated and manual gates before proceeding.

---

## Phase 1: API Layer

### Overview

Add a `GET` export to the existing flashcards index route, and create a new `[id].ts` dynamic route with `PATCH` and `DELETE` handlers. All three follow the exact auth + Zod + Supabase pattern in the existing `POST` handler.

### Changes Required:

#### 1. GET handler — list all user flashcards

**File:** `src/pages/api/flashcards/index.ts`

**Intent:** Add a `GET` export alongside the existing `POST`. Returns all flashcards for the authenticated user, ordered newest-first.

**Contract:** Same auth guard as `POST`. Queries all rows matching `user_id = auth.uid()` ordered by `created_at DESC`. Response: `{ flashcards: Flashcard[] }` with status 200. Returns an empty array for a user with no flashcards (not a 404).

#### 2. PATCH + DELETE handlers — single-flashcard mutation and removal

**File:** `src/pages/api/flashcards/[id].ts` (new file)

**Intent:** Handle per-record update (PATCH) and removal (DELETE) by flashcard ID. Both enforce `export const prerender = false`.

**Contract:**

`PATCH` — Zod body schema: `{ word: string (min 1), translation: string (min 1), context: string | null (optional) }`. Updates the matching row; calls `.select().single()` after the update. If `data` is null or `error` is set (row not found, or RLS blocks because the caller is not the owner), return 404. On success return `{ flashcard: Flashcard }` status 200. Access route param via `context.params.id`.

`DELETE` — No request body. Deletes the row; if the DELETE returned 0 affected rows (row not found or not owned), return 404. On success return 204 No Content.

### Success Criteria:

#### Automated Verification:
- Type check passes: `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification:
- `GET /api/flashcards` returns `{ flashcards: [] }` for a user with no flashcards
- `GET /api/flashcards` returns all flashcards for an authenticated user (ordered newest-first)
- `GET /api/flashcards` returns 401 for an unauthenticated request
- `PATCH /api/flashcards/:id` updates a flashcard and returns the updated object
- `PATCH /api/flashcards/:id` returns 404 when ID not found or not owned by user
- `DELETE /api/flashcards/:id` removes the flashcard and returns 204
- `DELETE /api/flashcards/:id` returns 404 when ID not found or not owned by user

**Implementation Note:** After automated verification passes, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Collection UI Components

### Overview

Install two missing shadcn/ui components (Input, Dialog), then build `FlashcardItem` (single-row with inline edit + delete confirmation dialog) and `CollectionView` (add form + list + empty state). Both components call the Phase 1 endpoints.

### Changes Required:

#### 1. Install shadcn/ui Input and Dialog

**File:** creates `src/components/ui/input.tsx` and `src/components/ui/dialog.tsx` via CLI

**Intent:** Install the Input component for word/translation fields in the add and edit forms, and Dialog for the delete confirmation. Both follow the "new-york" shadcn/ui style already in `components.json`.

**Contract:** Run `npx shadcn@latest add input dialog`. Verify both files exist in `src/components/ui/`. Run `npm run lint` immediately after — fix any Tailwind 4 class warnings before proceeding.

#### 2. FlashcardItem component

**File:** `src/components/collection/FlashcardItem.tsx` (new file)

**Intent:** Render a single flashcard row with view mode, inline-edit mode, and a delete confirmation dialog — mirroring the CandidateCard pattern.

**Contract:** Props: `flashcard: Flashcard`, `onUpdate: (id: string, patch: { word: string; translation: string; context: string | null }) => Promise<void>`, `onDelete: (id: string) => Promise<void>`. Local state: `mode: "view" | "editing"`, `deleteOpen: boolean`, `saving: boolean`, `error: string | null`. View mode exposes "Edit" and "Delete" buttons. Edit mode shows `Input` fields for word/translation and `Textarea` for context, with Save/Cancel. Delete uses the shadcn/ui `Dialog` with a Cancel/Delete button pair. Errors render as inline red text below the card (same pattern as GenerateView's `error` state).

#### 3. CollectionView component

**File:** `src/components/collection/CollectionView.tsx` (new file)

**Intent:** Main collection island — fetches all flashcards on mount, renders the inline add form at the top, the list of `FlashcardItem` rows, and the empty state.

**Contract:** State: `flashcards: Flashcard[]`, `loading: boolean`, `fetchError: string | null`, add-form fields (`word`, `translation`, `context`), `addError: string | null`, `adding: boolean`. On mount: `GET /api/flashcards` — set `flashcards`. Loading renders 3 `Skeleton` placeholders. Add form: validates word + translation non-empty, POSTs to `/api/flashcards`, prepends returned flashcard to `flashcards`. Empty state (loading done, 0 items): descriptive text + a Button/link to `/generate`. Passes `handleUpdate` and `handleDelete` callbacks to each `FlashcardItem`; callbacks call PATCH/DELETE and update `flashcards` state (optimistic remove on delete, replace-by-id on update).

### Success Criteria:

#### Automated Verification:
- Input and Dialog files exist: `ls src/components/ui/input.tsx src/components/ui/dialog.tsx`
- Type check passes: `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification:
- Collection list renders loading skeletons, then populates from the API
- Empty state displays with a "Generate flashcards" link to `/generate`
- Add form shows inline validation error when word or translation is blank
- Submitting the add form saves a flashcard and it appears at the top of the list
- Edit button switches a row to inline edit mode with pre-filled fields
- Save persists changes (row reflects new values without page reload)
- Cancel returns to view mode without changes
- Delete button opens the confirmation dialog
- Cancelling dialog does nothing; confirming removes the row from the list

**Implementation Note:** After automated verification passes, pause for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Page, Navigation, and Route Protection

### Overview

Create the minimal Astro shell for `/collection`, add it to the protected routes, and add a "Collection" link to the Topbar's authenticated nav.

### Changes Required:

#### 1. Collection page

**File:** `src/pages/collection.astro` (new file)

**Intent:** Minimal Astro shell following the same pattern as `generate.astro` — Layout wrapper with the React island loaded client-side.

**Contract:** Imports `Layout` from `@/layouts/Layout.astro` and `CollectionView` from `@/components/collection/CollectionView`. Renders `<Layout title="Collection"><CollectionView client:load /></Layout>`. No server-side data fetching.

#### 2. Route protection

**File:** `src/middleware.ts`

**Intent:** Add `/collection` to protected routes so unauthenticated users are redirected to sign-in.

**Contract:** Extend `PROTECTED_ROUTES` to `["/dashboard", "/generate", "/collection"]`.

#### 3. Navigation link

**File:** `src/components/Topbar.astro`

**Intent:** Surface the collection page from the top navigation for authenticated users.

**Contract:** In the authenticated nav block, add a link to `/collection` with the text "Collection" — positioned after the existing "Dashboard" link and before the sign-out form.

### Success Criteria:

#### Automated Verification:
- Type check passes: `npx astro check`
- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification:
- Visiting `/collection` without auth redirects to `/auth/signin`
- Authenticated user accesses `/collection` without redirect
- Topbar shows Dashboard | Collection | Sign out when logged in
- End-to-end: add a flashcard → it appears in the list → edit it inline and save → verify changes persist after reload → delete it → row is gone

---

## Testing Strategy

### Manual Testing Steps:
1. Sign in, navigate to `/collection` — verify empty state with "Generate flashcards" link
2. Use the add form to add a flashcard — verify it appears at the top of the list
3. Generate flashcards via `/generate` and accept some — verify they appear in `/collection`
4. Edit an existing flashcard inline — verify changes are persisted after page reload
5. Delete a flashcard — confirm the dialog appears, confirm deletion, verify row is gone
6. Sign out and visit `/collection` directly — verify redirect to sign-in

## Migration Notes

No schema migration needed. The `flashcards` table and all RLS policies were provisioned in the `flashcard-schema` change. All flashcards — from any source — share the same table and will appear in the collection automatically.

## References

- Roadmap: `context/foundation/roadmap.md` (S-02, FR-007–FR-010)
- Flashcard schema: `supabase/migrations/20260527000000_flashcard_schema.sql`
- Inline-edit pattern: `src/components/generate/CandidateCard.tsx`
- API auth + Zod pattern: `src/pages/api/flashcards/index.ts`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: API Layer

#### Automated

- [x] 1.1 Type check passes: `npx astro check`
- [x] 1.2 Linting passes: `npm run lint`

#### Manual

- [x] 1.3 GET /api/flashcards returns empty array for user with no flashcards
- [x] 1.4 GET /api/flashcards returns flashcards for authenticated user (newest-first)
- [x] 1.5 GET /api/flashcards returns 401 for unauthenticated request
- [x] 1.6 PATCH /api/flashcards/:id updates and returns updated flashcard
- [x] 1.7 PATCH /api/flashcards/:id returns 404 for unknown/unowned ID
- [x] 1.8 DELETE /api/flashcards/:id returns 204 and removes the row
- [x] 1.9 DELETE /api/flashcards/:id returns 404 for unknown/unowned ID

### Phase 2: Collection UI Components

#### Automated

- [ ] 2.1 Input and Dialog components installed: `ls src/components/ui/input.tsx src/components/ui/dialog.tsx`
- [ ] 2.2 Type check passes: `npx astro check`
- [ ] 2.3 Linting passes: `npm run lint`

#### Manual

- [ ] 2.4 Loading skeletons appear, then list populates from API
- [ ] 2.5 Empty state shows "Generate flashcards" link to /generate
- [ ] 2.6 Add form validates: inline error for blank word or translation
- [ ] 2.7 Add form saves new flashcard; it appears at top of list
- [ ] 2.8 Edit mode shows pre-filled fields; Save persists changes
- [ ] 2.9 Cancel returns to view mode without changes
- [ ] 2.10 Delete button opens confirmation dialog
- [ ] 2.11 Confirm removes the row; Cancel does nothing

### Phase 3: Page, Navigation, and Route Protection

#### Automated

- [ ] 3.1 Type check passes: `npx astro check`
- [ ] 3.2 Linting passes: `npm run lint`
- [ ] 3.3 Production build succeeds: `npm run build`

#### Manual

- [ ] 3.4 /collection redirects to /auth/signin when unauthenticated
- [ ] 3.5 Authenticated user accesses /collection without redirect
- [ ] 3.6 Topbar shows Dashboard | Collection | Sign out when logged in
- [ ] 3.7 End-to-end: add → edit inline → delete flow works correctly
