# Anki CSV Export Implementation Plan

## Overview

Add a "Export to Anki" button to the collection page that downloads the user's flashcards as a tab-separated text file compatible with Anki's import wizard. The endpoint generates the file server-side; the client triggers the download via fetch → Blob → hidden anchor click.

## Current State Analysis

- `GET /api/flashcards` (index.ts:8) already returns all flashcards for the authenticated user ordered by `created_at DESC`. The export query mirrors this exactly.
- `Flashcard` type (`src/types.ts`) has `word`, `translation`, `context` — the three fields needed.
- `CollectionView.tsx` manages its own `flashcards` state — the export button can derive its disabled state from `flashcards.length === 0`.
- All API routes follow the same auth + Supabase pattern: `createClient` → `getUser` → `401` if no user; no framework deviation needed.
- No prior CSV generation or download utilities exist; everything is net-new.

## Desired End State

A logged-in user with at least one flashcard can click "Export to Anki" in the collection header and receive a downloaded `.txt` file. When that file is imported into Anki (File → Import), cards appear with the correct word on the front, translation on the back, and context in the Extra field (for note types that carry it). The button is disabled — with a tooltip — when the collection is empty.

### Key Discoveries

- `src/pages/api/flashcards/index.ts:22` — the GET query selects `*`; the export can select only `word, translation, context` to keep the payload minimal.
- `CollectionView.tsx:88-89` — the `<h1>My Collection</h1>` is the topmost element; wrapping it in a flex row gives a natural home for the export button.
- `CollectionView.tsx:11-12` — `loading` state is already tracked; the button should also be disabled while the initial fetch is in progress (flashcards count is unknown until then).
- All API routes export `const prerender = false` (CLAUDE.md hard rule).

## What We're NOT Doing

- No Anki-specific `#notetype:` or `#deck:` directive beyond `#separator:tab` — adding note-type directives would encode Anki version assumptions.
- No server-side streaming — collections are small (MVP scope: flat list, no pagination), so buffering the full CSV in memory before responding is fine.
- No new migration — this slice touches no database schema.
- No ZIP or multi-file export — single `.txt` file only.
- No per-field quoting logic — tab separator makes quoting unnecessary; tabs and newlines inside field values are collapsed to a single space.

## Implementation Approach

Two files change: a new API endpoint generates the CSV response; the existing `CollectionView` component gets an export button wired to a `handleExport` function. The endpoint follows the existing `index.ts` auth pattern exactly. The download mechanism uses `fetch → res.blob() → URL.createObjectURL → hidden <a download> → click → revokeObjectURL`.

## Critical Implementation Details

**Tab/newline escaping in field values**: field values may contain `\t`, `\n`, or `\r\n` (context sentences often do). Replace every tab and newline character with a single space before inserting the value into the row. Failure to do so silently splits a row or adds a phantom column.

**Disabled button and loading**: The button must be disabled both while `loading === true` (flashcards not yet fetched) and while `flashcards.length === 0`. Checking only `flashcards.length === 0` would leave the button active on initial render before the first fetch completes.

---

## Phase 1: API endpoint — GET /api/flashcards/export

### Overview

Create `src/pages/api/flashcards/export.ts` that authenticates the caller, queries their flashcards, serialises them as tab-separated values, and returns the file with download headers.

### Changes Required

#### 1. New API route

**File**: `src/pages/api/flashcards/export.ts`

**Intent**: Authenticate the user, query their flashcards (word, translation, context), build a `#separator:tab` prefixed TSV string with one row per card, and return it as a downloadable `.txt` file.

**Contract**:
- Exports `const prerender = false`.
- Exports `GET: APIRoute`.
- Auth guard: `createClient` + `getUser` → `401` if no user (same pattern as `index.ts:8-20`).
- Supabase query: `supabase.from("flashcards").select("word, translation, context").order("created_at", { ascending: false })`.
- Inline escape helper (not exported): replaces `\t`, `\n`, `\r` in a string with a space.
- CSV body: first line is `#separator:tab`; each subsequent line is `escape(word)\t escape(translation)\t escape(context ?? "")`.
- Response headers: `Content-Type: text/plain; charset=utf-8`, `Content-Disposition: attachment; filename="anki-export-<YYYY-MM-DD>.txt"` (dated with the current UTC date).
- On Supabase error: `500` with JSON error body (same pattern as `index.ts:24-26`).

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint`
- Type check passes: `npx astro check`

#### Manual Verification

- `curl -b <session-cookie> http://localhost:4321/api/flashcards/export` returns `200` with `Content-Disposition: attachment; filename="anki-export-<YYYY-MM-DD>.txt"` and `Content-Type: text/plain`.
- Response body first line is `#separator:tab`.
- Each subsequent line contains exactly two tab characters (three columns).
- A field value that contains a tab or newline is collapsed to a space (test with a manually inserted row in local Supabase).
- Unauthenticated request returns `401`.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: UI integration — CollectionView export button

### Overview

Add `handleExport` to `CollectionView.tsx` and render an "Export to Anki" button in the collection header. The button is disabled while loading or when no flashcards exist.

### Changes Required

#### 1. State additions

**File**: `src/components/collection/CollectionView.tsx`

**Intent**: Track whether an export is in progress and whether it errored, so the button can reflect loading state and surface failures.

**Contract**: Add two state variables alongside the existing ones (after line 18): `exporting: boolean` (default `false`) and `exportError: string | null` (default `null`).

#### 2. `handleExport` function

**File**: `src/components/collection/CollectionView.tsx`

**Intent**: Fetch `/api/flashcards/export`, convert the response to a Blob URL, inject a hidden `<a download>` element, click it, then clean up. Show an inline error message if the fetch fails.

**Contract**: Async function (no parameters). Sets `exporting = true` / clears `exportError` on entry. On success: `res.blob()` → `URL.createObjectURL` → create `<a>` with `href` and `download="anki-export-<YYYY-MM-DD>.txt"` (dated with the current UTC date, matching the server's Content-Disposition) → append to `document.body` → `.click()` → remove from DOM → `URL.revokeObjectURL`. On any error: `setExportError("Export failed. Please try again.")`. Sets `exporting = false` in `finally`.

#### 3. Header layout and export button

**File**: `src/components/collection/CollectionView.tsx`

**Intent**: Replace the plain `<h1>` at line 89 with a flex row containing both the heading and the export button, so the export affordance is visible without scrolling.

**Contract**: Wrap the existing `<h1 className="text-2xl font-bold">My Collection</h1>` in `<div className="flex items-center justify-between">` with the export button as the second child. Button props: `variant="outline"`, `onClick={() => void handleExport()}`, `disabled={loading || flashcards.length === 0 || exporting}`, `title={flashcards.length === 0 ? "No flashcards to export" : undefined}`. Button label: `exporting ? "Exporting…" : "Export to Anki"`.

#### 4. Export error display

**File**: `src/components/collection/CollectionView.tsx`

**Intent**: Show `exportError` inline below the header row if the export fetch fails, so the user sees a clear message without a modal.

**Contract**: Render `{exportError && <p className="text-sm text-red-600">{exportError}</p>}` immediately after the header `<div>` (below the flex row, above the add-flashcard card). Mirror the existing `addError` pattern at line 120.

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint`
- Type check passes: `npx astro check`

#### Manual Verification

- Export button is visible in the collection header on page load.
- Button is disabled (grayed out) while flashcards are loading.
- Button is disabled when collection is empty; hovering shows the native tooltip "No flashcards to export".
- Button shows "Exporting…" while the fetch is in progress.
- Clicking the button on a non-empty collection triggers a file download named `anki-export-<YYYY-MM-DD>.txt` (e.g. `anki-export-2026-05-29.txt`).
- Opening the downloaded file in a text editor shows: first line `#separator:tab`, subsequent lines with three tab-separated columns.
- A flashcard with diacritics (e.g., `café`, `über`), commas, or quotes exports without corruption.
- On simulated export failure (temporary server error), an error message appears below the header; button returns to active state.
- Existing CRUD operations (add, edit, delete) are unaffected.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before marking the change done.

---

## Testing Strategy

### Manual Testing Steps

1. Sign in and navigate to `/collection`.
2. Verify export button is disabled with tooltip when collection is empty.
3. Add a flashcard with diacritics in the word and a comma in the translation.
4. Verify export button becomes active.
5. Click "Export to Anki" — confirm download starts and button shows "Exporting…".
6. Open the downloaded file; verify first line is `#separator:tab` and each data line has exactly two tabs.
7. Import the file into Anki (File → Import) without any modification — confirm cards appear with correct front/back.
8. Add a flashcard whose context field contains a newline or tab; export and confirm the character was collapsed to a space in the downloaded file.

## References

- Existing GET route (pattern to mirror): `src/pages/api/flashcards/index.ts:8-31`
- CollectionView header (insertion point): `src/components/collection/CollectionView.tsx:88-89`
- Flashcard type: `src/types.ts`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: API endpoint — GET /api/flashcards/export

#### Automated

- [x] 1.1 Lint passes: `npm run lint` — 48ff6a0
- [x] 1.2 Type check passes: `npx astro check` — 48ff6a0

#### Manual

- [ ] 1.3 GET returns 200 with correct Content-Type and Content-Disposition headers
- [ ] 1.4 Response body starts with `#separator:tab` and rows have exactly two tab characters
- [ ] 1.5 Tab/newline characters in field values are collapsed to a space
- [ ] 1.6 Unauthenticated request returns 401

### Phase 2: UI integration — CollectionView export button

#### Automated

- [x] 2.1 Lint passes: `npm run lint` — 266dc60
- [x] 2.2 Type check passes: `npx astro check` — 266dc60

#### Manual

- [ ] 2.3 Export button visible in collection header
- [ ] 2.4 Button disabled while loading and when collection is empty; tooltip present on empty state
- [ ] 2.5 Button shows "Exporting…" during fetch; file download triggered on success
- [ ] 2.6 Downloaded file has correct tab-separated format with `#separator:tab` header
- [ ] 2.7 Diacritics, commas, and quotes survive the export round-trip
- [ ] 2.8 Export failure shows inline error message
- [ ] 2.9 Existing CRUD operations unaffected
