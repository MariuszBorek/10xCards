---
project: "10xCards"
created: 2026-05-26
source: roadmap.md (v1)
linear_project: "10xCards"
linear_project_url: "https://linear.app/mariusz-borek/project/10xcards-828a97d92704"
---

# Linear Backlog — 10xCards

> Generated from `context/foundation/roadmap.md` on 2026-05-26.
> All issues live in the **10xCards** project, team **Mariusz Borek**.
> Update this file when issue statuses change or new issues are added.

## Workspace

| Field | Value |
|---|---|
| Linear workspace | mariusz-borek |
| Team | Mariusz Borek (key: MAR) |
| Project | 10xCards |
| Project URL | https://linear.app/mariusz-borek/project/10xcards-828a97d92704 |

## Issues

### MAR-5 — [DECISION] Wybór dostawcy LLM

| Field | Value |
|---|---|
| URL | https://linear.app/mariusz-borek/issue/MAR-5/decision-wybor-dostawcy-llm |
| Status | Todo |
| Priority | Urgent |
| Blocks | MAR-7 (S-01) |
| Roadmap ref | Open Roadmap Question Q1 |
| Owner | user |

**Why it exists:** S-01 (AI generation flow) cannot be planned or coded until the LLM provider is chosen. The decision determines the API integration, prompt format, API key management, and per-request costs.

**Options to evaluate:**
- OpenAI
- Anthropic
- OpenRouter
- Other

**Evaluation criteria:**
- Output quality for word ↔ translation pairs (core value proposition)
- Cost per request (MVP = small deployment)
- SDK availability for Cloudflare Workers edge runtime
- Ease of prompt iteration

**Done when:** Owner picks a provider, records the decision in `context/foundation/roadmap.md` (Q1), and moves this issue to Done — which unblocks MAR-7.

---

### MAR-6 — [F-01] Schema: tabela flashcards z migracją Supabase i politykami RLS

| Field | Value |
|---|---|
| URL | https://linear.app/mariusz-borek/issue/MAR-6/f-01-schema-tabela-flashcards-z-migracja-supabase-i-politykami-rls |
| Status | Todo |
| Priority | Urgent |
| Blocked by | — |
| Blocks | MAR-7 (S-01), MAR-8 (S-02), MAR-9 (S-03) |
| Roadmap ref | F-01 / `flashcard-schema` |
| PRD refs | FR-001, FR-002, FR-003 |

**Outcome:** Supabase migration creates the `flashcards` table with fields `id`, `user_id`, `word`, `translation`, `context`, `created_at`. Per-operation RLS policies (SELECT / INSERT / UPDATE / DELETE) ensure each authenticated user can only read and modify their own rows.

**Prerequisites:** Auth layer already present (`src/lib/supabase.ts`, middleware, auth pages).

**Implementation notes:**
- Create migration: `npx supabase migration new flashcard_schema`
- File lands in: `supabase/migrations/YYYYMMDDHHmmss_flashcard_schema.sql`
- RLS must be granular per-operation — not a single global policy
- Schema must include all required fields from day one; changing it later means a new migration

**Hard rules (CLAUDE.md):**
- RLS is mandatory on every new Supabase table
- Add granular per-operation, per-role policies in `supabase/migrations/`

**Risk:** Schema must be complete and RLS correct on the first migration. Retrofitting fields or policies after S-01/S-02/S-03 work has started costs extra migrations and potential data issues.

**Next step:** Run `/10x-plan flashcard-schema` to generate the implementation plan.

---

### MAR-7 — [S-01] Feature: AI generation flow (wklej → kandydaci → kolekcja)

| Field | Value |
|---|---|
| URL | https://linear.app/mariusz-borek/issue/MAR-7/s-01-feature-ai-generation-flow-wklej-kandydaci-kolekcja |
| Status | Backlog |
| Priority | High |
| Blocked by | MAR-6 (F-01), MAR-5 (DECISION) |
| Roadmap ref | S-01 / `ai-generation-flow` |
| PRD refs | FR-004, FR-005, FR-006, US-01 |

**Outcome:** Logged-in user pastes foreign-language text (one word to a short paragraph), triggers AI generation, reviews candidates (each with accept / reject / edit-in-place actions), and accepted flashcards immediately appear in their collection. Empty input and zero-candidate results show an explanatory message.

**North Star:** This is the slice that proves the product works. It validates the key hypothesis: does AI generate good enough flashcards to replace manual transcription?

**Unknowns:**
- **[BLOCKING]** LLM provider choice — Owner: user → resolve in MAR-5
- Prompt engineering for different input lengths — Owner: impl, non-blocking
- Input length limit and overflow strategy — Owner: impl, non-blocking
- Criteria for "worthy / trivial flashcard" — Owner: impl, non-blocking

**Risk:** AI candidate quality is the heart of the value proposition. If the prompt consistently yields poor results, the entire MVP loses its reason to exist. Provider choice must be resolved before any integration code is written.

---

### MAR-8 — [S-02] Feature: zarządzanie kolekcją (manual add + browse + edit + del)

| Field | Value |
|---|---|
| URL | https://linear.app/mariusz-borek/issue/MAR-8/s-02-feature-zarzadzanie-kolekcja-manual-add-browse-edit-del |
| Status | Backlog |
| Priority | Medium |
| Blocked by | MAR-6 (F-01) |
| Parallel with | MAR-7 (S-01), MAR-9 (S-03) |
| Roadmap ref | S-02 / `collection-management` |
| PRD refs | FR-007, FR-008, FR-009, FR-010 |

**Outcome:** Logged-in user can manually add a flashcard (word + translation + optional context), browse their full list of flashcards, edit any flashcard in-place, and delete any flashcard (with a confirmation dialog).

**Unknowns:**
- Soft delete vs hard delete for FR-010 — Owner: impl, non-blocking

**Risk:** Flat list without pagination is a deliberate MVP decision (PRD §FR-008 Socrates). Becomes write-only above ~200 flashcards, but that is a known limitation. Search/filter is a Non-Goal.

---

### MAR-9 — [S-03] Feature: eksport CSV do Anki

| Field | Value |
|---|---|
| URL | https://linear.app/mariusz-borek/issue/MAR-9/s-03-feature-eksport-csv-do-anki |
| Status | Backlog |
| Priority | Medium |
| Blocked by | MAR-6 (F-01) |
| Parallel with | MAR-7 (S-01), MAR-8 (S-02) |
| Roadmap ref | S-03 / `anki-csv-export` |
| PRD refs | FR-011, US-02 |

**Outcome:** Logged-in user can download a CSV file containing all their flashcards in Anki basic format (word front / translation back / optional context). Special characters (diacritics, quotes, commas) survive the round-trip to Anki correctly. Empty collection shows a message instead of an empty file.

**Unknowns:**
- Exact CSV columns and escape rules for diacritics/quotes/commas (PRD Q7) — Owner: impl, non-blocking

**Risk:** Anki CSV format is simple, but separator and escape corner-cases (e.g. a word containing a comma or quote) can surprise. A manual round-trip test in Anki is required before marking this slice done.

---

## Dependency graph

```
MAR-5 (DECISION: LLM provider)
    └── blocks MAR-7

MAR-6 (F-01: flashcard schema)
    ├── blocks MAR-7 (S-01)
    ├── blocks MAR-8 (S-02)
    └── blocks MAR-9 (S-03)

MAR-7, MAR-8, MAR-9 — parallel after prerequisites resolved
```

## Status mapping used

| Roadmap status | Linear status | Reason |
|---|---|---|
| `ready` | Todo | Ready to start immediately |
| `blocked` | Backlog | External decision required before any code |
| `proposed` | Backlog | Depends on F-01, not yet actionable |

## What to do next

1. **Now (user action):** Decide on LLM provider → resolve MAR-5 → unblocks MAR-7
2. **Now (dev action):** Run `/10x-plan flashcard-schema` → implement MAR-6 → unblocks MAR-7, MAR-8, MAR-9
3. **After F-01 done:** MAR-7, MAR-8, MAR-9 can be worked in parallel (MAR-7 additionally needs MAR-5 resolved)
