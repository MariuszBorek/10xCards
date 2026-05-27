# AI Flashcard Generation Flow — Plan Brief

> Full plan: `context/changes/ai-generation-flow/plan.md`

## What & Why

S-01 is the core value-proposition slice: it proves that 10xCards actually works. A logged-in user pastes foreign-language text, clicks Generate, reviews AI-generated word↔translation candidates (accept / reject / edit in-place), and accepted cards land immediately in their Supabase collection. Without this working end-to-end, the rest of the roadmap has no point.

## Starting Point

F-01 is fully complete: the `flashcards` table with RLS exists, `Flashcard` and `FlashcardInsert` types are in `src/types.ts`, and Supabase auth is wired throughout. There are no flashcard API routes, no generate UI, and no OpenRouter integration yet.

## Desired End State

After S-01, a user can sign in, visit `/generate`, paste a sentence in any foreign language, receive 3–15 AI-generated flashcard candidates from OpenRouter (`openai/gpt-4o-mini`), accept or edit the ones they want, and find those cards persisted in Supabase immediately. The `/dashboard` page links to `/generate`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Page route | New `/generate` page | Dashboard is a placeholder; separate page keeps each route's responsibility clear | Plan |
| Save behavior | Accept immediately (per card) | No data loss risk — each accept is durable before the user moves on | Plan |
| Loading UX | Skeleton placeholder cards | Perceived speed is significantly higher than a spinner; matches shadcn Skeleton pattern | Plan |
| Input cap | Soft warning at >300 words | PRD Open Question #2 defers a hard cap; single-user deployment makes runaway cost unlikely | Plan |
| LLM model | `openai/gpt-4o-mini` via OpenRouter | Reliable structured JSON output, strong multilingual extraction, low cost | Plan |
| Language handling | Auto-detect from input | Zero UI friction; prompt instructs GPT-4o-mini to infer translation language | Plan |
| Edit fields | All three (word, translation, context) | FR-005 says "edit its content" without restriction; AI can hallucinate any field | Plan |
| Error recovery | Inline error + Retry (input preserved) | User doesn't lose pasted text on transient failures | Plan |
| Zero results | Empty state + "Try again" + "Add manually" | PRD US-01 acceptance criteria explicitly requires an explanatory message and a path forward | Plan |
| Dev mock | `OPENROUTER_MOCK=true` env flag | Allows full UI testing without burning API credits during component iteration | Plan |
| API shape | Two separate routes | `/generate` is transient (never persists input); `/api/flashcards` is durable — single-responsibility | Plan |

## Scope

**In scope:**
- `POST /api/flashcards/generate` — OpenRouter call + mock mode
- `POST /api/flashcards` — authenticated Zod-validated Supabase insert
- `GenerateView` React component with all four states (idle / loading / review / error)
- `CandidateCard` with accept / reject / edit-in-place (all 3 fields)
- `/generate` Astro page, route protection, dashboard link
- `FlashcardCandidate` type added to `src/types.ts`
- `OPENROUTER_API_KEY` + `OPENROUTER_MOCK` added to env schema

**Out of scope:**
- S-02 collection browse/edit/delete UI
- S-03 CSV export
- Streaming LLM responses
- Hard input length cap
- Deduplication against existing collection
- Language selector in the UI

## Architecture / Approach

The generate service (`src/lib/services/generate.ts`) encapsulates the OpenRouter HTTP call so the route handler stays thin. The `GenerateView` React island owns all state; it calls `/api/flashcards/generate` once to fetch candidates, then calls `/api/flashcards` once per accepted card. Each accept is an independent POST — no bulk transaction. Skeleton cards satisfy the NFR for visible progress without streaming complexity.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Environment & Generate Endpoint | Working `POST /api/flashcards/generate` with mock + real OpenRouter | Prompt quality — bad prompt = bad candidates = product fails |
| 2. Save Endpoint | Working `POST /api/flashcards` with Zod validation + Supabase insert | RLS misconfiguration (but F-01 already validated this) |
| 3. GenerateView Component | Full interactive UI: idle → loading → review with accept/reject/edit | Per-candidate saving state complexity; React key stability |
| 4. Page, Routing & Navigation | Navigable end-to-end flow: `/generate` protected + dashboard link | — |

**Prerequisites:** F-01 complete (done ✓); `npx supabase start` running locally; OpenRouter account + API key for real testing.

**Estimated effort:** ~3–4 dev sessions across 4 phases.

## Open Risks & Assumptions

- **Prompt quality is the product's core risk** — if `openai/gpt-4o-mini` with the current prompt consistently misidentifies trivial vs. non-trivial vocabulary, the plan calls for prompt iteration before declaring S-01 done (PRD success criterion: ≥75% acceptance rate).
- **`response_format: { type: "json_object" }` requires "json" in the prompt** — the system prompt satisfies this; removing "json" from the prompt causes a 400 from OpenRouter.
- **Cloudflare Workers: only Web API `fetch`** — the generate service must not import Node.js `http`/`https`; standard `fetch` works in Workers with `nodejs_compat`.
- Auto-detect language may occasionally infer the wrong translation language for ambiguous inputs (e.g. an English sentence — is the user Polish or German?); acceptable for MVP.

## Success Criteria (Summary)

- Pasting a foreign-language sentence returns plausible flashcard candidates from OpenRouter
- Accepting a candidate immediately creates a row in `flashcards` under the authenticated user's `user_id`
- Unauthenticated visit to `/generate` redirects to sign-in; full end-to-end flow works for a signed-in user
