# AI Flashcard Generation Flow — Implementation Plan

## Overview

Build the end-to-end flow that lets a logged-in user paste foreign-language text, receive AI-generated flashcard candidates via OpenRouter, review each candidate (accept / reject / edit in-place), and immediately persist accepted cards to their Supabase collection. This is S-01 — the core value-proposition slice of 10xCards.

## Current State Analysis

- `flashcards` table with RLS is live (`supabase/migrations/20260527000000_flashcard_schema.sql`). The `Flashcard` and `FlashcardInsert` types are in `src/types.ts`. F-01 is complete.
- Auth is fully wired: `createClient(context.request.headers, context.cookies)` + `supabase.auth.getUser()` is the pattern for API routes; `Astro.locals.user` is set by middleware on every request.
- Existing API routes (`src/pages/api/auth/`) use `export const POST: APIRoute` — new routes follow the same shape. CLAUDE.md hard rule: every API route must also export `const prerender = false`.
- Only one shadcn component is installed (`button.tsx`). `Textarea`, `Card`, and `Skeleton` need to be added via `npx shadcn@latest add` before building the UI.
- `zod` is not in `package.json` and must be installed before the save endpoint can use it for input validation.
- `OPENROUTER_API_KEY` and `OPENROUTER_MOCK` do not yet exist in `astro.config.mjs` env schema or `.dev.vars`.

### Key Discoveries

- `src/lib/supabase.ts:1–24` — `createClient` creates a cookie-backed SSR client; env vars come from `astro:env/server`, not `process.env`.
- `src/middleware.ts:4` — `PROTECTED_ROUTES = ["/dashboard"]`; adding `/generate` here is the only change needed to protect the new page.
- `astro.config.mjs:19–22` — env schema uses `envField.string({ context: "server", access: "secret", optional: true })` for secrets. New OpenRouter vars follow this shape.
- `src/types.ts:1–17` — `Flashcard` and `FlashcardInsert` exist; `FlashcardCandidate` (the transient review type) must be added.
- Cloudflare Workers runtime: HTTP calls in server code must use the Web API `fetch`, not Node.js `http`/`https` modules. The generate service must use `fetch` for the OpenRouter request.

## Desired End State

After this plan:
- `POST /api/flashcards/generate` accepts `{ input: string }`, calls `openai/gpt-4o-mini` on OpenRouter (or returns mock data when `OPENROUTER_MOCK=true`), and returns `{ candidates: FlashcardCandidate[] }`.
- `POST /api/flashcards` validates a `{ word, translation, context? }` body with Zod, inserts the row into the `flashcards` table under the authenticated user's `user_id`, and returns `{ flashcard: Flashcard }`.
- The `/generate` page (protected) mounts `<GenerateView client:load />`, which manages the full flow: idle text-area form → skeleton loading → per-candidate review with accept / reject / edit-in-place → immediate persist on accept.
- Empty input shows a validation message. Zero-candidate result shows an empty state with "Try again" and "Add manually" CTAs. OpenRouter failure shows an inline error with a Retry button (input preserved). Inputs above ~300 words show a soft-cap warning but remain submittable.
- The dashboard page links to `/generate`.

## What We're NOT Doing

- No bulk-save button — accept is immediate and per-card (PRD: no data loss on tab close).
- No streaming from OpenRouter — non-streaming JSON response + skeleton cards satisfy the NFR for visible progress without SSE complexity.
- No hard input length cap — soft warning at ~300 words; actual cap decision deferred to PRD Open Question #2.
- No deduplication check — PRD explicitly excludes this from MVP.
- No language-pair selector in the UI — prompt auto-detects source and infers translation language.
- No S-02 collection view on this page — the generate page focuses solely on the generation flow.

## Implementation Approach

Four sequential phases, each leaving the app in a runnable state:

1. Add env vars + build the stateless `POST /api/flashcards/generate` endpoint first so it can be tested independently before any UI exists.
2. Add the `POST /api/flashcards` save endpoint so the persistence path is verified against Supabase before it's wired to the UI.
3. Build the React component (`GenerateView`) against the two working endpoints.
4. Wire the page, protect the route, link from dashboard — completing the navigable flow.

## Critical Implementation Details

**`export const prerender = false` on every API route** — CLAUDE.md hard rule; both `src/pages/api/flashcards/generate.ts` and `src/pages/api/flashcards/index.ts` must include this export or the route silently becomes a static file at build time.

**`response_format: { type: "json_object" }` requires "json" in the prompt** — OpenRouter/OpenAI enforces that the prompt mentions "json" at least once when this response format is used. The system prompt below satisfies this. Removing the word "json" from the prompt causes a 400 error.

**Cloudflare Workers: use `fetch`, not Node.js HTTP modules** — the generate service runs inside a Worker; `node:http` / `node:https` are not available for outbound HTTP. The standard Web API `fetch` works correctly in Cloudflare's `nodejs_compat` mode.

---

## Phase 1: Environment & Generate Endpoint

### Overview

Extend the environment configuration for OpenRouter secrets, add the `FlashcardCandidate` type, build the service that calls OpenRouter (with a mock bypass), and expose it as a POST route.

### Changes Required

#### 1. Env schema — new OpenRouter variables

**File**: `astro.config.mjs`

**Intent**: Declare `OPENROUTER_API_KEY` and `OPENROUTER_MOCK` as server-only secrets so they're accessible via `astro:env/server` in both the Astro dev server and Cloudflare Workers.

**Contract**: Add two fields to the existing `env.schema` block:
- `OPENROUTER_API_KEY`: `envField.string({ context: "server", access: "secret", optional: true })`
- `OPENROUTER_MOCK`: `envField.string({ context: "server", access: "secret", optional: true })`

#### 2. Local env file

**File**: `.dev.vars`

**Intent**: Provide the two new vars to `wrangler dev` so the API route works locally. Also update `.env.example` so future contributors know these vars exist.

**Contract**: Add `OPENROUTER_API_KEY=<real key>` and `OPENROUTER_MOCK=true` (for local development without burning credits).

#### 3. FlashcardCandidate type

**File**: `src/types.ts`

**Intent**: Define the transient candidate shape that the generate endpoint returns and the review component consumes. `FlashcardCandidate` is never persisted as-is — it becomes a `Flashcard` row only after the user accepts it.

**Contract**:
```typescript
export interface FlashcardCandidate {
  word: string;
  translation: string;
  context: string | null;
}
```

#### 4. Generate service

**File**: `src/lib/services/generate.ts`

**Intent**: Encapsulate the OpenRouter API call (and the mock bypass) so the route handler stays thin. Returns a parsed `FlashcardCandidate[]` or throws on unrecoverable errors.

**Contract**: Exports one function:
```typescript
export async function generateFlashcardCandidates(input: string): Promise<FlashcardCandidate[]>
```

When `OPENROUTER_MOCK === "true"`, return a hardcoded array of 3 candidates immediately.

Otherwise, POST to `https://openrouter.ai/api/v1/chat/completions` with:
```typescript
{
  model: "openai/gpt-4o-mini",
  messages: [{ role: "user", content: SYSTEM_PROMPT + input }],
  temperature: 0.3,
  response_format: { type: "json_object" }
}
```

Parse `choices[0].message.content` as JSON and return `parsed.candidates` (an array). If the array is missing or malformed, return `[]`. Use `OPENROUTER_API_KEY` from `astro:env/server` for the `Authorization: Bearer` header.

The system prompt (verbatim — this is load-bearing):
```
You are a vocabulary extraction engine for language flashcard generation.

Given a text in a foreign language, extract vocabulary worth memorizing and return it as flashcard candidates.

Rules:
1. Detect the source language. Infer the learner's native language (the language they likely want translations in). Default to English translations if the target language is ambiguous.
2. Extract 3–15 vocabulary items: non-trivial words, useful phrases, or idioms. Skip function words (articles, prepositions, conjunctions) and vocabulary so common it would already be known.
3. For each item: provide the word or phrase in its base form ("word"), its translation ("translation"), and optionally a short usage example of ≤10 words ("context", may be null).
4. Return ONLY a valid JSON object — no markdown, no explanation:
   {"candidates":[{"word":"...","translation":"...","context":"..."}]}
5. If nothing is worth extracting, return: {"candidates":[]}

Text:
```

#### 5. Generate API route

**File**: `src/pages/api/flashcards/generate.ts`

**Intent**: Authenticate the request, validate that the input is a non-empty string, delegate to the generate service, and return the candidates as JSON. Transient input — never stored.

**Contract**:
- `export const prerender = false` (CLAUDE.md hard rule)
- `export const POST: APIRoute`
- Reads JSON body `{ input: string }`
- Returns `401` if `supabase.auth.getUser()` yields no user
- Returns `400 { error: "Input is required" }` if `input` is missing or blank
- Returns `200 { candidates: FlashcardCandidate[] }` on success
- Returns `500 { error: "Generation failed" }` if the service throws

### Success Criteria

#### Automated Verification

- `npm run lint` passes with no errors on new files
- `npx astro check` passes (no type errors)
- `npm run build` completes without errors

#### Manual Verification

- `OPENROUTER_MOCK=true` in `.dev.vars`: `POST /api/flashcards/generate` with `{ "input": "test" }` returns `{ candidates: [...3 mock items] }`
- With a real `OPENROUTER_API_KEY` and `OPENROUTER_MOCK` unset: submitting a short foreign-language sentence returns plausible `FlashcardCandidate[]`
- Empty or blank `input` returns HTTP 400
- Unauthenticated request (no session cookie) returns HTTP 401

**Implementation Note**: After this phase passes automated checks and manual API testing, pause for human confirmation before starting Phase 2.

---

## Phase 2: Flashcard Save Endpoint

### Overview

Install Zod and expose `POST /api/flashcards` — the durable persistence endpoint that accepts one candidate at a time and inserts it into the `flashcards` table.

### Changes Required

#### 1. Install zod

**File**: `package.json` (via `npm install zod`)

**Intent**: Satisfy the CLAUDE.md convention of validating API route input with Zod.

#### 2. Save API route

**File**: `src/pages/api/flashcards/index.ts`

**Intent**: Accept a single accepted flashcard from the review UI, authenticate the request, validate the body, and insert the row with `user_id = authenticated user's uid`. Returns the created `Flashcard` row.

**Contract**:
- `export const prerender = false`
- `export const POST: APIRoute`
- JSON body validated with Zod: `word` (non-empty string, required), `translation` (non-empty string, required), `context` (string or null, optional)
- Returns `401` if unauthenticated
- Returns `400 { error: string }` on Zod validation failure
- Inserts `{ user_id: user.id, word, translation, context }` — `id`, `created_at`, `deleted_at` are server-generated defaults
- Returns `201 { flashcard: Flashcard }` on success
- Returns `500 { error: "Failed to save flashcard" }` on Supabase error

### Success Criteria

#### Automated Verification

- `npm run lint` passes
- `npx astro check` passes

#### Manual Verification

- Authenticated `POST /api/flashcards` with `{ "word": "ephemeral", "translation": "krótkotrwały", "context": null }` returns `201` and the created flashcard object
- Same request without a valid session returns `401`
- Request missing `word` or `translation` returns `400`
- Row appears in Supabase Studio → Table Editor → `flashcards` with the correct `user_id`

**Implementation Note**: After this phase passes manual verification, pause for human confirmation before starting Phase 3.

---

## Phase 3: GenerateView React Component

### Overview

Install the required shadcn UI components, then build the full interactive review flow as a client-side React component. The component is the heart of S-01 — it manages all four states (idle, loading, review, error) and calls the two API endpoints from Phases 1 and 2.

### Changes Required

#### 1. Install shadcn components

**Command**: `npx shadcn@latest add textarea card skeleton`

**Intent**: Add the three UI primitives needed by the generate flow. Installing via the CLI ensures they land in `src/components/ui/` with the correct "new-york" style variant already configured.

#### 2. CandidateCard component

**File**: `src/components/generate/CandidateCard.tsx`

**Intent**: Render a single flashcard candidate with three mutually exclusive display modes: review mode (Accept / Reject / Edit buttons), edit mode (three inline inputs for word, translation, and context with a Save button that auto-accepts), and accepted mode (read-only confirmation state after saving). Receives the candidate data and callbacks (`onAccept`, `onReject`, `onSave`) as props — all network calls happen in the parent.

**Contract**: Props interface:
```typescript
interface CandidateCardProps {
  candidate: FlashcardCandidate;
  status: 'pending' | 'accepted' | 'rejected';
  saving: boolean;
  onAccept: () => void;
  onReject: () => void;
  onSave: (updated: FlashcardCandidate) => void;
}
```
`saving` is `true` while the parent's POST is in-flight — used to disable buttons and show a spinner on the card. "Save" in edit mode calls `onSave(updated)`, which triggers accept in the parent.

#### 3. GenerateView component

**File**: `src/components/generate/GenerateView.tsx`

**Intent**: Orchestrate the full four-state flow. Manages the textarea input, triggers generation, owns the candidates array with per-item status tracking, calls `POST /api/flashcards/generate` to generate and `POST /api/flashcards` to persist each accepted card.

**Contract**: Local state shape:
```typescript
type ViewPhase = 'idle' | 'loading' | 'review';

interface CandidateItem extends FlashcardCandidate {
  clientId: string;          // crypto.randomUUID() — stable React key
  status: 'pending' | 'accepted' | 'rejected';
  saving: boolean;           // true while POST /api/flashcards is in-flight for this item
}
```

State and behavior per phase:
- **idle**: Textarea bound to `inputText`; word count computed from `inputText.split(/\s+/)`; soft-cap warning shown when word count > 300; Generate button calls `POST /api/flashcards/generate`, transitions to `loading`
- **loading**: 4 `Skeleton` card shapes shown; Generate button disabled; on response, parse candidates into `CandidateItem[]` and transition to `review`; on fetch error, stay in `idle`, set `error` state
- **review**: Render a `CandidateCard` per `CandidateItem` where `status !== 'rejected'`; "Accept" handler sets `saving: true`, calls `POST /api/flashcards`, on success sets `status: 'accepted'`; "Reject" sets `status: 'rejected'`; "Save" from edit mode calls the same accept handler with the edited payload
- **Zero candidates**: When the API returns `candidates: []`, stay in `review` phase but show an empty-state block: explanatory message + "Try again" button (resets to idle, preserves input) + "Add manually" button (links or opens a future manual form)
- **Error state**: On a failed generation call, show an inline error message with a "Retry" button that re-submits the current `inputText` without clearing the textarea

### Success Criteria

#### Automated Verification

- `npm run lint` passes on all files in `src/components/generate/`
- `npx astro check` passes

#### Manual Verification

- Idle state: textarea is focusable, generate button is visible
- Pasting text > 300 words shows the soft-cap warning inline (not blocking)
- Submitting empty textarea shows a validation error, does not call the API
- After submit: 4 skeleton cards appear, then are replaced by real candidates (or mock candidates with `OPENROUTER_MOCK=true`)
- Accept button on a candidate fires a POST, card transitions to accepted/confirmed state
- Reject button removes the card from view
- Edit button shows all three fields (word, translation, context) inline; Save auto-accepts and persists
- After accepting a card, verify the row in Supabase Studio with correct `user_id`
- Zero-candidate response: empty state message appears with "Try again" + "Add manually"
- Simulated API error (wrong API key or kill network): error message + Retry button appear; textarea still contains the original input

**Implementation Note**: Pause for human confirmation after manual testing before starting Phase 4.

---

## Phase 4: Page, Route Protection & Navigation

### Overview

Wire the React component to an Astro page, protect the route via middleware, and link to it from the dashboard — completing the navigable end-to-end flow.

### Changes Required

#### 1. Generate page

**File**: `src/pages/generate.astro`

**Intent**: Serve the `/generate` route as a server-rendered Astro page that mounts `GenerateView` as a React island. Astro owns the page shell (layout, title); React owns all interactivity.

**Contract**: Import `Layout` and `GenerateView`; mount `<GenerateView client:load />` inside the layout. No props need to be passed — the component calls the API endpoints directly.

#### 2. Route protection

**File**: `src/middleware.ts`

**Intent**: Ensure unauthenticated users who visit `/generate` are redirected to the sign-in page, consistent with the existing `/dashboard` protection.

**Contract**: Add `"/generate"` to the `PROTECTED_ROUTES` array at line 4.

#### 3. Dashboard link

**File**: `src/pages/dashboard.astro`

**Intent**: Give logged-in users a visible path to the generate flow from the dashboard. The dashboard is currently a placeholder; this link makes it useful.

**Contract**: Add an anchor `<a href="/generate">Generate flashcards</a>` (or a shadcn Button styled as a link) inside the existing card content, below the welcome message.

### Success Criteria

#### Automated Verification

- `npm run lint` passes
- `npx astro check` passes
- `npm run build` exits 0

#### Manual Verification

- Visiting `/generate` while unauthenticated redirects to `/auth/signin`
- After signing in, `/generate` loads and shows the `GenerateView` component
- Dashboard shows a working link to `/generate`
- Full end-to-end flow: sign in → click Generate flashcards → paste text → generate → accept a card → verify card in Supabase Studio under the correct `user_id`

**Implementation Note**: Pause for human confirmation after full end-to-end manual testing.

---

## Testing Strategy

### Manual Testing Steps (full end-to-end)

1. Start local Supabase: `npx supabase start`
2. Start dev server: `npm run dev`
3. Register a new test account at `/auth/signup`
4. Navigate to `/generate` (should load without redirect)
5. Set `OPENROUTER_MOCK=true` in `.dev.vars` and restart dev server
6. Paste any text and click Generate — verify 3 mock candidates appear
7. Accept one, reject one, edit and save the third — verify all three behave correctly
8. Open Supabase Studio at `http://localhost:54323` — verify 2 accepted rows (one accepted directly, one via edit+save) appear under the test user's `user_id`
9. Unset `OPENROUTER_MOCK`, set real `OPENROUTER_API_KEY`, restart — verify real candidates return for a short French or German sentence
10. Test empty input: submit empty textarea — verify error message, no network call
11. Test > 300 words: paste a long passage — verify soft-cap warning appears, generation still proceeds
12. Test zero candidates: use input known to produce no output (e.g. `"the"`) — verify empty state message and CTAs appear
13. Verify unauthenticated access: sign out, visit `/generate` — verify redirect to `/auth/signin`

## References

- Roadmap: `context/foundation/roadmap.md` — S-01 (ai-generation-flow)
- PRD: `context/foundation/prd.md` — FR-004, FR-005, FR-006, US-01
- Foundation plan (F-01): `context/archive/2026-05-27-flashcard-schema/plan.md`
- Auth pattern: `src/pages/api/auth/signin.ts`, `src/middleware.ts`
- Types: `src/types.ts`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Environment & Generate Endpoint

#### Automated

- [x] 1.1 `npm run lint` passes on new files — a23dcad
- [x] 1.2 `npx astro check` passes — a23dcad
- [x] 1.3 `npm run build` completes without errors — a23dcad

#### Manual

- [x] 1.4 `OPENROUTER_MOCK=true`: POST /api/flashcards/generate returns 3 mock candidates — a23dcad
- [ ] 1.5 Real API key: POST /api/flashcards/generate returns plausible candidates for a foreign-language sentence
- [ ] 1.6 Blank input returns HTTP 400
- [ ] 1.7 Unauthenticated request returns HTTP 401

### Phase 2: Flashcard Save Endpoint

#### Automated

- [x] 2.1 `npm run lint` passes — d872c94
- [x] 2.2 `npx astro check` passes — d872c94

#### Manual

- [x] 2.3 Authenticated POST /api/flashcards with valid body returns 201 + flashcard object — d872c94
- [x] 2.4 Unauthenticated request returns 401 — d872c94
- [x] 2.5 Missing required field returns 400 — d872c94
- [x] 2.6 Row appears in Supabase Studio with correct user_id — d872c94

### Phase 3: GenerateView React Component

#### Automated

- [x] 3.1 `npm run lint` passes on src/components/generate/ — cf80896
- [x] 3.2 `npx astro check` passes — cf80896

#### Manual

- [x] 3.3 Idle state renders textarea and Generate button
- [x] 3.4 > 300 words shows soft-cap warning (does not block submit)
- [x] 3.5 Empty submit shows validation error, no API call fired
- [x] 3.6 Submit shows 4 skeleton cards then real candidates
- [x] 3.7 Accept persists card immediately; Supabase Studio shows the row
- [x] 3.8 Reject removes candidate from view
- [x] 3.9 Edit shows all 3 fields; Save auto-accepts and persists
- [x] 3.10 Zero-candidate response shows empty state with Try again + Add manually
- [x] 3.11 API failure shows error message + Retry (input preserved)

### Phase 4: Page, Route Protection & Navigation

#### Automated

- [x] 4.1 `npm run lint` passes
- [x] 4.2 `npx astro check` passes
- [x] 4.3 `npm run build` exits 0

#### Manual

- [x] 4.4 Unauthenticated visit to /generate redirects to /auth/signin
- [x] 4.5 Authenticated visit to /generate loads GenerateView
- [x] 4.6 Dashboard shows working link to /generate
- [x] 4.7 Full end-to-end flow: sign in → generate → accept → verify row in Supabase Studio
