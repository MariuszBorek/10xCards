<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: AI Flashcard Generation Flow

- **Plan**: context/changes/ai-generation-flow/plan.md
- **Scope**: All 4 phases (full plan)
- **Date**: 2026-05-29
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Notes

- System prompt in `src/lib/services/generate.ts:4-17` is verbatim per plan lines 129-142.
- `prerender = false` present on both new API routes (CLAUDE.md hard rule).
- Auth enforced (401 before any work) at both API boundaries; OpenRouter key never imported into any client component (server-only `astro:env/server`).
- RLS policies (`select_own`/`insert_own`/`update_own`/`delete_own`) confirmed in the flashcard migration — the insert is properly backed.
- The unbounded `GET select("*")` in `flashcards/index.ts` was flagged by a sub-agent but is OUT OF SCOPE: at this change's commit `d872c94` the file had only `POST`; the `GET` was added by the later `collection-management` change.
- Automated success criteria verified now: `npm run lint` exit 0; `npx astro check` 0 errors / 0 warnings. `npm run build` passed at commit `0f5e621`; no source changed since.
- Manual checks 1.5-1.7 (real OpenRouter key) remain pending — require live credentials.

## Findings

### F1 — Per-card save failure is silent

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/components/generate/GenerateView.tsx:76-78
- **Detail**: When POST /api/flashcards fails, the catch resets `saving: false` but leaves `status: "pending"` and surfaces no message. The card silently reverts from its spinner to the normal Accept button — the user gets zero feedback that the save failed and may believe the card was persisted. The card does not hang, but a silent failure on the core "accept persists immediately" promise is the real risk. The plan specified error UX for the generation call but said nothing about the save path — a genuine gap, not a deviation.
- **Fix**: Add a per-card error flag to `CandidateItem`; set it in the catch and render an inline "Save failed — retry" message on the card (mirrors the generation-level error pattern at lines 56/108).
- **Decision**: PENDING

### F2 — No server-side input length guard

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Performance/Cost)
- **Location**: src/pages/api/flashcards/generate.ts (input validation) + src/lib/services/generate.ts:38
- **Detail**: The 300-word soft cap is client-only (GenerateView.tsx:103). The API route validates only non-empty input — an arbitrarily large body flows straight into the LLM prompt (cost + latency). The plan's "What We're NOT Doing" explicitly defers a hard input cap to PRD Open Question #2, so this is consistent with planned scope — flagged only so the deferred abuse/cost guard isn't forgotten once the cap decision lands.
- **Fix**: When the cap is decided, reject oversized input server-side before calling the LLM (a generous char limit, returning 400).
- **Decision**: PENDING

### F3 — OpenRouter call lacks timeout; opaque error on missing key

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/lib/services/generate.ts:30-46
- **Detail**: Two minor hardening gaps on the external boundary: (a) the `fetch` to OpenRouter has no timeout/AbortController, so a hung upstream can burn the Worker's wall/CPU budget; (b) `Bearer ${OPENROUTER_API_KEY ?? ""}` sends an empty token when the key is unset (mock off), producing a 401 → generic 500 "Generation failed" that hides the real cause.
- **Fix**: Pass `signal: AbortSignal.timeout(30000)` to the fetch, and throw an explicit "OPENROUTER_API_KEY not configured" error when the key is absent and mock is off.
- **Decision**: PENDING
