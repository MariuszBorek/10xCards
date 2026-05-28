# Anki CSV Export — Plan Brief

> Full plan: `context/changes/anki-csv-export/plan.md`

## What & Why

Users need to move their 10xCards flashcards into Anki for spaced-repetition practice. S-03 delivers a one-click export: the user clicks "Export to Anki" and receives a tab-separated file they can import into Anki without any manual editing of the file itself.

## Starting Point

The flashcard schema, CRUD API, and `CollectionView` component are fully in place (F-01, S-01, S-02 archived). `GET /api/flashcards` already returns all of a user's cards with the exact fields the export needs (`word`, `translation`, `context`). There is no download endpoint and no export button.

## Desired End State

A logged-in user on `/collection` sees an "Export to Anki" button in the page header. One click downloads `anki-export.txt`. The file has a `#separator:tab` first line followed by one tab-separated row per flashcard (word, translation, context). Importing the file into Anki produces cards with word on the front and translation on the back. The button is disabled — with a tooltip — when the collection is empty.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| CSV separator | Tab | Anki's default import separator; avoids quoting complexity for commas/quotes common in translations | Plan |
| Field columns | 3: word, translation, context | Preserves context as a distinct Anki field; blank third column for cards without context | Plan |
| Anki directive | `#separator:tab` header only | Encoding note-type directives would couple the file to a specific Anki version | Plan |
| Empty collection | Button disabled + native tooltip | Client already has flashcard count; no round-trip needed; satisfies PRD acceptance criteria | Plan |
| Download mechanism | fetch → Blob → hidden `<a download>` | Allows loading indicator; handles auth errors as UI toasts rather than raw browser pages | Plan |
| Button placement | Flex row with `<h1>` in CollectionView header | Visible without scrolling; semantically correct as a collection-level action | Plan |

## Scope

**In scope:**
- `GET /api/flashcards/export` — new API route
- Export button + `handleExport` in `CollectionView.tsx`
- Disabled state with tooltip when collection is empty
- Tab/newline escaping in field values
- Inline error message on export failure

**Out of scope:**
- Anki note-type or deck directives in the file header
- Per-row quoting (tab separator makes it unnecessary)
- Database schema changes or new migrations
- Anki round-trip automated test

## Architecture / Approach

Single new API endpoint (`src/pages/api/flashcards/export.ts`) mirrors the existing `index.ts` GET handler exactly up to the response: same `createClient` → `getUser` → Supabase query pattern, then builds a tab-separated string and returns it with `Content-Disposition: attachment`. The React component adds two state variables (`exporting`, `exportError`), one async function (`handleExport`), and wraps the existing `<h1>` in a flex row to place the button.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. API endpoint | Authenticated download of tab-separated flashcard file | Incorrect escaping of tabs/newlines in field values breaks Anki import |
| 2. UI integration | Export button with loading/disabled/error states in CollectionView | Button enabled before initial fetch completes — guard with `loading` state |

**Prerequisites:** F-01 (schema + RLS), S-02 (collection CRUD) — both archived and complete.  
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- Anki Basic note type maps 3 columns to Front / Back / (ignored or Extra depending on configuration). Users with a customised note type that has an Extra field get full context in Anki; others see context only in the downloaded file.
- `Content-Disposition: attachment` is respected by Cloudflare Workers — this is standard HTTP header handling with no known Workers edge case.

## Success Criteria (Summary)

- Clicking the button on a non-empty collection downloads a `.txt` file that imports into Anki without errors
- Special characters (diacritics, commas, quotes) survive the export and appear correctly in Anki
- Empty collection keeps the button visible but disabled with an explanatory tooltip
