---
date: 2026-06-03T22:59:53+0200
researcher: mariuszborek
git_commit: f5df5ed16c6ebeb72ec08229d05446a6591ac062
branch: main
repository: MariuszBorek/10xCards
topic: "Generation, persistence & output-safety integrity (test rollout Phase 2 — risks #3/#4/#5/#7)"
tags: [research, codebase, generation, persistence, output-safety, xss, csv-injection, openrouter]
status: complete
last_updated: 2026-06-03
last_updated_by: mariuszborek
---

# Research: Generation, persistence & output-safety integrity (test rollout Phase 2)

**Date**: 2026-06-03T22:59:53+0200
**Researcher**: mariuszborek
**Git Commit**: f5df5ed16c6ebeb72ec08229d05446a6591ac062
**Branch**: main
**Repository**: MariuszBorek/10xCards

## Research Question

Ground rollout Phase 2 of `context/foundation/test-plan.md` ("Generation, persistence & output-safety integrity") in live code. For each of risks **#3** (transient pasted input persists), **#4** (silent data loss on accept), **#5** (AI generation failure not surfaced cleanly), and **#7** (untrusted model/candidate output → stored XSS / CSV formula injection): locate _where the failure lives_, establish _what protection exists today_, and identify _the cheapest test seam and assertion_.

## Summary

Three of the four risks are **already defended** by the current code — Phase 2 tests for them are **regression guards**, not gap-closers. One risk (#7, CSV half) is a **confirmed, currently-unmitigated vulnerability**.

| Risk                        | Current state                                                                                                                                                                                                                                                                    | Phase-2 test role                                                             | Load-bearing finding                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **#3** transient input      | **Upheld.** Input is never persisted (no DB write in the generate path) and never echoed (response is `{candidates}` only); no `console.*` in `src/`.                                                                                                                            | Regression guard                                                              | `generate.ts` / `generate.ts` service have zero `.insert/.update`; response body carries no `input` field. |
| **#4** silent data loss     | **Upheld.** Handler checks the Supabase `error`, returns **500** on write failure, and uses `.select().single()` to confirm the row. No 2xx-on-failure path.                                                                                                                     | Regression guard (+ round-trip)                                               | `index.ts:75-80` — error branch returns before the 201.                                                    |
| **#5** AI failure surfacing | **Mostly upheld**, with **3 real gaps**: no oversized-input guard, no app-level fetch timeout (the one true hang vector), and the envelope `response.json()` is unguarded (throws vs. degrades). Empty-input, non-200, malformed model JSON, and zero-candidate are all handled. | Regression guard **+ gap spec** (tests for the 3 gaps fail today)             | `generate.ts` service `:30` (no timeout), `:51` (unguarded parse); route `:28-31` (no max-length).         |
| **#7** output safety        | **Render sink already safe** (React auto-escaping, **no** raw-HTML path anywhere). **CSV sink is vulnerable** — `escapeField` collapses tab/CR/LF only; leading `= + - @` pass through verbatim → spreadsheet formula injection.                                                 | XSS = optional/low-value; **CSV = the place to spend the test** (fails today) | `export.ts:7-9, 34-37`.                                                                                    |

**Where to spend Phase-2 effort, in priority order:** (1) CSV formula-injection neutralization (#7 — real vuln, cheap unit seam after a tiny serializer extraction); (2) the three #5 gaps (oversized input, fetch timeout, parse robustness) — these are _specifications_ the tests will drive into existence; (3) round-trip + forced-failure regression guards for #4; (4) transient-input regression guard for #3; (5) XSS render guard only if a DOM test env is later added.

## Detailed Findings

### Risk #3 — Transient pasted input lifecycle (VERDICT: upheld)

**Lifecycle.** Input enters at [`generate.ts:21-31`](https://github.com/MariuszBorek/10xCards/blob/f5df5ed16c6ebeb72ec08229d05446a6591ac062/src/pages/api/flashcards/generate.ts#L21-L31) as `body.input` — validated only by `(body.input ?? "").trim()` + non-empty check (no zod here; deviates from the project "validate with zod" convention — a note, not a leak). It flows to [`generateFlashcardCandidates(input)`](https://github.com/MariuszBorek/10xCards/blob/f5df5ed16c6ebeb72ec08229d05446a6591ac062/src/lib/services/generate.ts#L25) where it is concatenated into the prompt (`SYSTEM_PROMPT + input`, [`generate.ts:38`](https://github.com/MariuszBorek/10xCards/blob/f5df5ed16c6ebeb72ec08229d05446a6591ac062/src/lib/services/generate.ts#L38)) and POSTed to OpenRouter. It exits at [`generate.ts:35`](https://github.com/MariuszBorek/10xCards/blob/f5df5ed16c6ebeb72ec08229d05446a6591ac062/src/pages/api/flashcards/generate.ts#L35) as `JSON.stringify({ candidates })` only.

- **Persisted? NO.** The generate endpoint and service contain **zero** `.insert/.update/.upsert`. The only writes in `src/` are `index.ts:71` (accepted candidate fields), `[id].ts:50` (edit), and `srs.ts:135` (FSRS state) — none touch the raw input blob.
- **In response body? NO.** Success shape is `{ candidates: [{ word, translation, context }] }` ([`src/types.ts:37-41`](https://github.com/MariuszBorek/10xCards/blob/f5df5ed16c6ebeb72ec08229d05446a6591ac062/src/types.ts#L37-L41)); error bodies are `{ error: "..." }` with no input interpolation. The catch at `:40` returns a generic `"Generation failed"` — even an OpenRouter error string (which carries only a status code, service `:45`) cannot leak input.
- **Logged? NONE found.** No `console.*` anywhere in `src/`. The only off-box egress is the intended OpenRouter `fetch` — outside the "operator-accessible row/response" guardrail.

**Test seam.** Cheapest = service-layer with `OPENROUTER_MOCK=true`: call `generateFlashcardCandidates(input)`, assert returned items carry only `{word, translation, context}` and the stringified result does not contain the pasted input. Persistence is best proven _by absence_ (no reachable insert in the path) rather than a DB scan, since there is no write to catch.

### Risk #4 — Silent data loss on accept (VERDICT: upheld; regression guard)

**Persist path.** Accept fires **one POST per candidate** (no batch endpoint): [`GenerateView.tsx:61-79`](https://github.com/MariuszBorek/10xCards/blob/f5df5ed16c6ebeb72ec08229d05446a6591ac062/src/components/generate/GenerateView.tsx#L61-L79) → `POST /api/flashcards` with `{ word, translation, context }`. Edit→Save reuses the same `handleAccept` ([`:157`](https://github.com/MariuszBorek/10xCards/blob/f5df5ed16c6ebeb72ec08229d05446a6591ac062/src/components/generate/GenerateView.tsx#L157)). The **manual-add** path ([`CollectionView.tsx:39-71`](https://github.com/MariuszBorek/10xCards/blob/f5df5ed16c6ebeb72ec08229d05446a6591ac062/src/components/collection/CollectionView.tsx#L39-L71)) POSTs to the _same_ endpoint — one handler test covers both.

**Error translation (the critical question).** [`index.ts:69-80`](https://github.com/MariuszBorek/10xCards/blob/f5df5ed16c6ebeb72ec08229d05446a6591ac062/src/pages/api/flashcards/index.ts#L69-L80):

```ts
const { data, error } = await supabase.from("flashcards")
  .insert({ user_id: user.id, word, translation, context: ctx ?? null })
  .select().single<Flashcard>();
if (error) {
  return new Response(JSON.stringify({ error: "Failed to save flashcard" }), { status: 500 });
}
return new Response(JSON.stringify({ flashcard: data }), { status: 201, ... });
```

The handler **checks `error` and returns 500** before the 201 is reachable — **a failed write cannot return 2xx.** `.select().single()` read-back-confirms the row in the same round trip, structurally closing the "success reported, row absent" gap. Success body is `{ flashcard: <row> }` @ **201**; GET returns `{ flashcards: Flashcard[] }` @ **200**, `created_at` desc.

**Client trust.** Both clients gate **only on `res.ok`** ([`GenerateView.tsx:71`](https://github.com/MariuszBorek/10xCards/blob/f5df5ed16c6ebeb72ec08229d05446a6591ac062/src/components/generate/GenerateView.tsx#L71), [`CollectionView.tsx:60`](https://github.com/MariuszBorek/10xCards/blob/f5df5ed16c6ebeb72ec08229d05446a6591ac062/src/components/collection/CollectionView.tsx#L60)), never a body field. So the entire silent-loss protection rests on the handler's honest status — exactly what the test pins. (Note: manual-add optimistically prepends the row rather than re-fetching — a client-side concern, not a server data-loss vector.)

**Test seam.** Route-handler test importing **both** `POST` and `GET` (mirror [`test/authz/flashcards-handler.test.ts`](https://github.com/MariuszBorek/10xCards/blob/f5df5ed16c6ebeb72ec08229d05446a6591ac062/test/authz/flashcards-handler.test.ts)). Assert (1) **round-trip**: POST N distinct rows → each 201 → GET returns exactly those N (length + membership, scoped to `user.id`); (2) **forced failure → non-2xx**: trip a DB constraint (NOT-NULL / length / check from the migrations) so the insert errors, assert `status === 500` / `!res.ok`. Prefer a real constraint violation over a mock — the suite deliberately uses the real Supabase client.

### Risk #5 — AI generation failure surfacing (VERDICT: mostly upheld; 3 gaps)

**OpenRouter boundary.** [`generate.ts:30-42`](https://github.com/MariuszBorek/10xCards/blob/f5df5ed16c6ebeb72ec08229d05446a6591ac062/src/lib/services/generate.ts#L30-L42): `POST https://openrouter.ai/api/v1/chat/completions` (hardcoded literal — clean MSW/fetch-mock target), model `openai/gpt-4o-mini`, `response_format: { type: "json_object" }`. Mock short-circuit at [`:26-28`](https://github.com/MariuszBorek/10xCards/blob/f5df5ed16c6ebeb72ec08229d05446a6591ac062/src/lib/services/generate.ts#L26-L28) (`OPENROUTER_MOCK === "true"` → static `MOCK_CANDIDATES`, never calls fetch — bypasses error/empty/malformed branches, so use a real fetch mock for those).

**Parse step.** [`:54-59`](https://github.com/MariuszBorek/10xCards/blob/f5df5ed16c6ebeb72ec08229d05446a6591ac062/src/lib/services/generate.ts#L54-L59): the **inner** model-content `JSON.parse` is in a try/catch → malformed model JSON or non-array `candidates` degrades to `[]` (no crash). The **outer** envelope `await response.json()` at [`:51`](https://github.com/MariuszBorek/10xCards/blob/f5df5ed16c6ebeb72ec08229d05446a6591ac062/src/lib/services/generate.ts#L51) is **unguarded** — a 200-with-non-JSON-body throws, caught only by the route's outer catch → 500. Per-candidate object shape is **not** validated.

**Branch-by-branch (today):**

| Branch                             | Behavior today                                                                                                                                                                                                                                                                                                                                                                                            | Location                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty / whitespace input           | Client blocks pre-fetch (`inputError`); route defense-in-depth → **400** `Input is required`                                                                                                                                                                                                                                                                                                              | route [`:28-31`](https://github.com/MariuszBorek/10xCards/blob/f5df5ed16c6ebeb72ec08229d05446a6591ac062/src/pages/api/flashcards/generate.ts#L28-L31); [`GenerateView.tsx:26-29`](https://github.com/MariuszBorek/10xCards/blob/f5df5ed16c6ebeb72ec08229d05446a6591ac062/src/components/generate/GenerateView.tsx#L26-L29) |
| Non-JSON request body              | **400** `Input is required`                                                                                                                                                                                                                                                                                                                                                                               | route [`:22-26`](https://github.com/MariuszBorek/10xCards/blob/f5df5ed16c6ebeb72ec08229d05446a6591ac062/src/pages/api/flashcards/generate.ts#L22-L26)                                                                                                                                                                      |
| **Oversized input**                | **GAP — no server guard.** Only a cosmetic `wordCount > 300` advisory client-side ([`GenerateView.tsx:106-110`](https://github.com/MariuszBorek/10xCards/blob/f5df5ed16c6ebeb72ec08229d05446a6591ac062/src/components/generate/GenerateView.tsx#L106-L110)); full input sent to OpenRouter regardless.                                                                                                    | —                                                                                                                                                                                                                                                                                                                          |
| OpenRouter non-200                 | Service throws → route catch → **500** `Generation failed`; client clears loading → `idle` + error. No hang.                                                                                                                                                                                                                                                                                              | service [`:44-46`](https://github.com/MariuszBorek/10xCards/blob/f5df5ed16c6ebeb72ec08229d05446a6591ac062/src/lib/services/generate.ts#L44-L46)                                                                                                                                                                            |
| **Network error / timeout**        | **GAP — no `AbortSignal.timeout`** on the fetch ([`:30`](https://github.com/MariuszBorek/10xCards/blob/f5df5ed16c6ebeb72ec08229d05446a6591ac062/src/lib/services/generate.ts#L30)). A _rejected_ fetch surfaces cleanly (500); a _hung_ upstream has no app deadline → screen stays in `loading`. The genuine hang vector. (Project already uses `AbortSignal.timeout` in `test/helpers/supabase.ts:40`.) | —                                                                                                                                                                                                                                                                                                                          |
| Malformed model JSON               | Caught → `[]` → 200 `{candidates:[]}` → empty state (indistinguishable from a real zero-result)                                                                                                                                                                                                                                                                                                           | service [`:54-59`](https://github.com/MariuszBorek/10xCards/blob/f5df5ed16c6ebeb72ec08229d05446a6591ac062/src/lib/services/generate.ts#L54-L59)                                                                                                                                                                            |
| Malformed envelope (200, non-JSON) | `response.json()` throws → route catch → **500**                                                                                                                                                                                                                                                                                                                                                          | service [`:51`](https://github.com/MariuszBorek/10xCards/blob/f5df5ed16c6ebeb72ec08229d05446a6591ac062/src/lib/services/generate.ts#L51)                                                                                                                                                                                   |
| Zero candidates                    | Service `[]` → 200 → explicit empty-state card ("No flashcard candidates found…")                                                                                                                                                                                                                                                                                                                         | [`GenerateView.tsx:125-143`](https://github.com/MariuszBorek/10xCards/blob/f5df5ed16c6ebeb72ec08229d05446a6591ac062/src/components/generate/GenerateView.tsx#L125-L143)                                                                                                                                                    |

**Hang analysis.** `phase="loading"` ([`:32`](https://github.com/MariuszBorek/10xCards/blob/f5df5ed16c6ebeb72ec08229d05446a6591ac062/src/components/generate/GenerateView.tsx#L32)) is cleared on success (`review`, `:54`) and in the catch (`idle`, `:57`); every awaited path is covered by the catch, so any _settled_ error resets the UI. The only hang is a fetch that never settles — i.e. the missing-timeout gap above.

**Test seam.** Cheapest = **service layer with `fetch` mocked at the OpenRouter URL** (no Supabase, no Astro context): cover non-200 (throws), network reject (propagates), malformed model JSON (→ `[]`), zero/non-array candidates (→ `[]`), malformed envelope (documents the `:51` throw), and mock mode. Add a **route-layer** test for HTTP translation (400 empty, 400 non-JSON, 500 service throw, 200 success). The 3 gaps (oversized → expect 400; timeout → expect bounded failure; envelope robustness) are **specs that fail today** — the plan decides whether Phase 2 closes them or files them.

### Risk #7 — Output-safety sinks (VERDICT: render safe; CSV vulnerable)

**Render sink — already safe, NOT reachable.** Tree-wide search for `dangerouslySetInnerHTML`, `set:html`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` → **zero hits**. Every field render is plain JSX text interpolation (React auto-escapes): [`CandidateCard.tsx:26-28`](https://github.com/MariuszBorek/10xCards/blob/f5df5ed16c6ebeb72ec08229d05446a6591ac062/src/components/generate/CandidateCard.tsx#L26-L28), [`FlashcardItem.tsx:84-86`](https://github.com/MariuszBorek/10xCards/blob/f5df5ed16c6ebeb72ec08229d05446a6591ac062/src/components/collection/FlashcardItem.tsx#L84-L86), `ReviewSession.tsx:88-93`. Adversarial content (`<img onerror=…>`) renders as inert text today. A guard test would need a DOM env (no jsdom/happy-dom/RTL; `vitest.config.ts` pins `environment: "node"`) — disproportionate for a non-reachable risk. **Recommend: optional, only if DOM infra is added later.**

**CSV sink — confirmed vulnerability.** [`export.ts:7-9`](https://github.com/MariuszBorek/10xCards/blob/f5df5ed16c6ebeb72ec08229d05446a6591ac062/src/pages/api/flashcards/export.ts#L7-L9), [`:34-37`](https://github.com/MariuszBorek/10xCards/blob/f5df5ed16c6ebeb72ec08229d05446a6591ac062/src/pages/api/flashcards/export.ts#L34-L37):

```ts
function escapeField(value: string): string {
  return value.replace(/[\t\n\r]/g, " "); // collapses tab/CR/LF only
}
const rows = data.map((f) => `${escapeField(f.word)}\t${escapeField(f.translation)}\t${escapeField(f.context ?? "")}`);
const csv = ["#separator:tab", ...rows].join("\n");
```

`escapeField` does **no** formula-injection neutralization, no quoting, no RFC-4180. A field `=cmd|'/c calc'!A1` is written verbatim as the first tab token → opened in Excel/Sheets/LibreOffice it is interpreted as a formula. Leading `=`, `+`, `-`, `@` all pass through unchanged; a _leading literal tab_ is incidentally blunted to a space by the existing replace, but that is not deliberate dangerous-char neutralization. Served as `text/plain; charset=utf-8`, `attachment; filename="anki-export-YYYY-MM-DD.txt"` ([`:39-46`](https://github.com/MariuszBorek/10xCards/blob/f5df5ed16c6ebeb72ec08229d05446a6591ac062/src/pages/api/flashcards/export.ts#L39-L46)) — the `.txt` framing mitigates but does not remove the risk (users import into spreadsheets; Anki is the target).

**Test seam.** Preferred = **extract field serialization into a pure exported helper** (e.g. `serializeAnkiField`/`buildAnkiCsv`), then a **pure unit test** (no DB/env) asserting a leading `= + - @`/tab is made inert (leading `'` or `\t` prefix per chosen scheme) while benign fields round-trip and internal tab/CR/LF still don't break structure. This depends on a small refactor the plan must call for. Fallback = route-handler integration test on `export.ts` `GET` (supported now: `node` env + existing helpers): seed a flashcard whose `word` starts with `=`, `GET`, `await res.text()`, assert neutralized.

## Code References

- `src/pages/api/flashcards/generate.ts:21-41` — generate endpoint: auth gate, non-empty input check (no zod, no max-length), service call, 200 `{candidates}` / 400 / 500 translation.
- `src/lib/services/generate.ts:25-60` — OpenRouter boundary; mock short-circuit (`:26`), fetch (`:30`, **no timeout**), non-200 throw (`:44`), unguarded envelope parse (`:51`), guarded content parse → `[]` (`:54-59`).
- `src/pages/api/flashcards/index.ts:40-83` — create (POST): `error` check → 500 (`:75`), `.select().single()` confirm, 201 `{flashcard}` (`:79-80`); list (GET) → 200 `{flashcards}`.
- `src/pages/api/flashcards/export.ts:7-9, 34-37` — `escapeField` (tab/CR/LF only) + inline tab-delimited row build. **No formula-injection neutralization.**
- `src/components/generate/GenerateView.tsx:26-79, 106-143` — empty-input block, loading/error/zero-candidate states, one-POST-per-candidate accept gating on `res.ok`.
- `src/components/collection/CollectionView.tsx:39-71` — manual-add POSTs same endpoint; optimistic prepend.
- `src/components/{generate/CandidateCard,collection/FlashcardItem}.tsx` + `src/components/review/ReviewSession.tsx` — all field renders are escaped JSX text; no raw-HTML sink.
- `src/types.ts:1-20, 37-41` — `Flashcard`, `FlashcardCandidate`.
- `test/helpers/handler.ts:10-40` — `makeApiContext` / `makeCookieStub`; **GET-only request, no method/body** (must be extended or bypassed for POST tests).
- `test/helpers/supabase.ts:21-147` — `hasTestEnv`/`isSupabaseReachable` (skip gate), `seedUser`, `signedInClient`, `signedInCookieHeader`, `deleteUser` (CASCADE), `adminClient`; `AbortSignal.timeout` example at `:40`.
- `test/authz/flashcards-handler.test.ts` — the canonical real-handler integration pattern to mirror.

## Architecture Insights

- **Three of four risks are already defended** — Phase 2 is largely _regression-guarding_ code that already does the right thing (transient input, silent-loss, most generation-failure paths). The one true vulnerability is **CSV formula injection**; the three #5 gaps (oversized input, fetch timeout, envelope-parse robustness) are _latent_ hardening opportunities, not active failures, but a test for each fails today.
- **Network-edge mockability is good**: OpenRouter is a single hardcoded URL and `OPENROUTER_MOCK` already exists — but mock mode returns a fixed non-empty list, so failure-branch coverage needs a real `fetch` stub at the URL (never mock internal modules — consistent with test-plan §6.4 and §4 API-mocking guidance).
- **`.select().single()` after insert** is a deliberate, load-bearing pattern: it turns "write reported but row missing" into a caught PostgREST error — worth preserving and pinning.
- **Test helper gap**: `makeApiContext` builds a GET-only `Request`. Every Phase-2 POST seam (generate, create round-trip) needs the helper extended to accept `method` + JSON `body`, or to construct the `Request` inline. This is a concrete prerequisite the plan should schedule first.
- **DOM test infra is absent** (`environment: "node"`). The render-XSS guard is the only Phase-2 candidate that would require new infra; given the sink is non-reachable, deferring it is consistent with test-plan §1 cost × signal.
- **Convention drift noted**: the generate endpoint validates input ad-hoc (`trim()` + non-empty) rather than via zod, unlike `index.ts`. Not a security gap on its own, but the oversized-input guard (#5) would naturally land as a zod `.max()` here.

## Historical Context (from prior changes)

- `context/changes/testing-runner-bootstrap-authz/` — **Phase 1** (complete): stood up the Vitest runner against local Supabase and shipped authz/RLS/auth-gating coverage (risks #1/#2/#6). It produced the entire test spine Phase 2 reuses: `test/helpers/supabase.ts`, `test/helpers/handler.ts`, the `describe.skipIf(!reachable)` gate, and the real-handler pattern in `test/authz/flashcards-handler.test.ts`. Phase 2 builds directly on these.
- `context/foundation/test-plan.md` §6.1/§6.2/§6.4 — cookbook patterns filled by Phase 1 (unit, integration, new-API-endpoint). §6.5 ("generation path") is the **TBD this phase fills**.
- `context/foundation/lessons.md` — two standing lessons: (1) read-modify-write lost updates on SRS state (not in this phase's scope — see test-plan §7); (2) four flashcard endpoints rely on RLS alone — relevant background but an authz concern (Phase 1), not a #3/#4/#5/#7 vector. The lesson's "assert the cross-account _outcome_, never the query shape" principle generalizes here: Phase-2 tests should assert _behavior_ (no input in body, non-2xx on failure, inert CSV cell), never mirror the implementation.

## Related Research

- None prior under `context/changes/**/research.md` for this topic. Phase 1's change folder (`context/changes/testing-runner-bootstrap-authz/`) holds the precedent artifacts.

## Open Questions

1. **Worker-runtime log leakage (#3)**: there is no app-level logging in `src/`, but Cloudflare Workers `console`/`wrangler tail` could surface request data. This is **not observable from the in-process Vitest seam** — recommend documenting it as out-of-band rather than asserting it. Does the team want any runtime-log policy note, or is "no `console.*` in `src/`" sufficient?
2. **#5 gap scope**: should Phase 2 _close_ the three gaps (add oversized-input zod `.max()`, add `AbortSignal.timeout` to the OpenRouter fetch, guard the envelope parse), or only _write failing/now-passing tests_ and file the fixes separately? The test-plan frames Phase 2 as test work; the gaps imply small source changes.
3. **#7 CSV refactor**: extracting a pure `serializeAnkiField`/`buildAnkiCsv` helper enables the cheapest unit seam — is a small refactor of `export.ts` in scope for this phase, or should the test run as a route-handler integration test against the un-refactored handler?
4. **Forced-write-failure mechanism (#4)**: which concrete DB constraint in the migrations is cheapest to trip from the real handler (NOT-NULL / length / check)? Needs a quick look at `supabase/migrations/20260527000000_flashcard_schema.sql` during planning to pick the forcing function (vs. a stubbed client, which the suite avoids).
