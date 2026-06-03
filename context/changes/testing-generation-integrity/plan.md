# Generation, persistence & output-safety integrity tests — Implementation Plan

## Overview

Rollout Phase 2 of `context/foundation/test-plan.md`. Defend the product's value path with unit + integration tests across four risks, and close the one real vulnerability plus three latent hardening gaps the tests would otherwise document rather than prevent:

- **#3** transient pasted input never persists or echoes — regression guard.
- **#4** accept never silently loses rows; a failed write returns non-2xx — regression guard + round-trip.
- **#5** AI generation failure/empty/zero-candidate surfaces cleanly — regression guard **+ close 3 source gaps** (oversized-input server guard, fetch timeout, envelope-parse robustness).
- **#7** untrusted model/candidate output neutralized at the CSV sink — **fix the live formula-injection vulnerability** + pure-unit coverage. Render sink is already safe (no raw-HTML path); its DOM test is deferred with a documented rationale.

The phase builds directly on the Phase 1 spine (`test/helpers/supabase.ts`, `test/helpers/handler.ts`, the `describe.skipIf(!reachable)` gate, the real-handler pattern in `test/authz/flashcards-handler.test.ts`). No new dependencies: OpenRouter failure branches are stubbed with Vitest's built-in `vi.stubGlobal('fetch', …)`; no DOM env is added.

## Current State Analysis

From `context/changes/testing-generation-integrity/research.md` (read fully) and direct code reading:

- **#3 — upheld.** `src/lib/services/generate.ts` and `src/pages/api/flashcards/generate.ts` contain zero `.insert/.update`. The generate response is `JSON.stringify({ candidates })` only (`generate.ts:35`); error bodies are generic (`"Generation failed"`, no input interpolation). No `console.*` in `src/`. Protection is _by absence of a write_, not a deliberate scrub.
- **#4 — upheld.** `src/pages/api/flashcards/index.ts:69-83` — `.insert(…).select().single()`, `if (error) return 500` **before** the 201. A failed write cannot return 2xx. Both clients gate only on `res.ok`, so the entire guard rests on the handler's honest status.
- **#5 — mostly upheld, 3 gaps.** `generate.ts` service: mock short-circuit at `:26` (returns a fixed non-empty list, bypassing fetch — so failure branches need a real fetch stub); fetch at `:30` has **no `AbortSignal.timeout`** (the genuine hang vector); envelope `await response.json()` at `:51` is **unguarded**; inner content parse at `:54-59` is guarded → `[]`. The generate route (`generate.ts:28-31`) validates input ad-hoc (`trim()` + non-empty, **no zod, no max-length**) — a convention drift vs `index.ts` and the missing oversized-input guard.
- **#7 — render safe, CSV vulnerable.** Tree-wide search: zero `dangerouslySetInnerHTML` / `set:html` / `innerHTML` — every field render is escaped JSX text. `src/pages/api/flashcards/export.ts:7-9` — `escapeField` collapses tab/CR/LF only; a leading `= + - @` passes through verbatim into the first tab token → spreadsheet formula injection. Served as `.txt`, but the Anki/spreadsheet import target makes it a real risk.
- **Test infra.** `vitest.config.ts` pins `environment: "node"`, `globals: true`, includes `test/**/*.test.ts` + `src/**/*.test.ts`. `npm test` = `vitest run`. No MSW/jsdom/happy-dom installed; `vitest` + `@vitest/coverage-v8` only. `test/helpers/handler.ts` `makeApiContext` builds a **GET-only** `Request` (no method/body) — the concrete prerequisite for every POST seam.
- **#4 forcing-function wrinkle.** `supabase/migrations/20260527000000_flashcard_schema.sql`: `word/translation TEXT NOT NULL`, no length/CHECK constraints; RLS `insert_own WITH CHECK (auth.uid() = user_id)`. The POST handler runs zod (`word/translation min(1)`) and always sets `user_id: user.id`, so **no DB constraint is cleanly trippable through the real handler**. The failure→error path is proven at the data seam instead (see Phase 3).

### Key Discoveries:

- `src/lib/services/generate.ts:26` — `OPENROUTER_MOCK==="true"` returns `MOCK_CANDIDATES` _before_ fetch; failure-branch tests must stub `globalThis.fetch`, never internal modules (test-plan §6.4).
- `src/pages/api/flashcards/generate.ts:28-31` — ad-hoc input validation; the natural home for both the zod `.max()` oversized guard and the convention-drift fix.
- `src/pages/api/flashcards/index.ts:75` — the `if (error) return 500` branch is the entire #4 server-side guard; `.select().single()` read-back-confirms the row.
- `src/pages/api/flashcards/export.ts:7-9,34-37` — `escapeField` + inline row build; the refactor target for a pure serializer.
- `test/helpers/handler.ts:28-40` — `makeApiContext` is GET-only; extending it is Phase 1.
- `test/helpers/supabase.ts:38-40` — `AbortSignal.timeout(2000)` is an in-repo precedent for the fetch-timeout gap.
- `test/authz/flashcards-handler.test.ts` — canonical real-handler integration shape to mirror for Phases 2-3.

## Desired End State

`npm test` runs (and, where Supabase is reachable, exercises) a Phase-2 suite that:

1. Asserts the generate service returns only `{word, translation, context}` items and never echoes the pasted input (#3).
2. Drives the generate service through every failure branch with a stubbed fetch, and the generate route through every HTTP-status translation including the **new** oversized-input 400 (#5).
3. Round-trips N accepted candidates through the real create+list handlers and proves a forced write rejection surfaces as an error, not 2xx (#4).
4. Proves a CSV/TSV field beginning with `= + - @` or tab is neutralized by a pure serializer, while benign fields round-trip (#7).

Source changes that make the #5 tests assert _protected_ behavior: a zod `.max()` oversized-input guard + `AbortSignal.timeout` on the OpenRouter fetch + a guarded envelope parse. The CSV vulnerability is fixed via an extracted, apostrophe-prefixing serializer. `test-plan.md §6.5` (generation-path cookbook) is filled; §6.6 carries a Phase-2 note; the rollout table marks Phase 2 done; `change.md` is updated.

Verify: `npm test` green; `npm run lint` + `npx astro check` clean; with local Supabase up, the integration suites run rather than skip.

## What We're NOT Doing

- **No render-XSS DOM test** and **no jsdom/happy-dom/RTL dependency.** The render sink is non-reachable (no raw-HTML path anywhere); a DOM test waits until DOM infra exists for another reason. Documented in Phase 4 + cookbook §6.5.
- **No MSW.** A single hardcoded OpenRouter URL is stubbed with `vi.stubGlobal('fetch')` — no new dependency.
- **No mocking of the Supabase data layer** (test-plan §6.4) — the #4 forced-failure runs against the real DB.
- **No new CHECK-constraint migration** to enable the #4 test — the forcing function is the RLS `WITH CHECK` rejection (Phase 3).
- **No generation-quality / LLM-as-judge eval** (test-plan §7) and **no rate-limit/abuse test** (§7).
- **No e2e / CI gate wiring** — that is Phase 3 of the rollout (`Quality-gates wiring`).
- **No batch accept endpoint** and **no client-component refactors** — accept stays one-POST-per-candidate; tests target handlers/services, not React internals.
- **No change to RLS policies or risk definitions** — Phase 2 consumes them, does not redefine them.

## Implementation Approach

Schedule the shared test-harness change first (Phase 1), because both the generate-route tests (Phase 2) and the create round-trip (Phase 3) need a POST-capable `makeApiContext`. Then proceed risk-by-risk, each phase pairing the cheapest seam research identified with the minimal source change (if any) that lets the test assert _protected_ behavior rather than document a gap:

- **#5 + #3** share the generate service/route seam → one phase. Source gaps closed first, then service tests (`vi.stubGlobal('fetch')`) and route tests.
- **#4** is a real-handler integration phase mirroring `flashcards-handler.test.ts`, extended to POST.
- **#7** is a pure refactor-then-unit phase (the only one that needs no DB and runs unconditionally), plus the render-XSS deferral note.
- A final docs phase fills the cookbook and syncs status.

Every test asserts **behavior/outcome**, never implementation shape (lessons.md: "assert the cross-account outcome, never the query shape" generalizes — assert "no input in body", "non-2xx on failure", "inert CSV cell", not the code path).

## Critical Implementation Details

- **Mock-mode bypass (#5).** `OPENROUTER_MOCK==="true"` returns before fetch, so failure-branch service tests must run with that env _unset/false_ and stub `globalThis.fetch`. `vitest.config.ts` injects `.env` via `test.env`; if `.env` sets `OPENROUTER_MOCK=true`, the failure tests must override it per-test (e.g. `vi.stubEnv`) or the stubbed fetch is never reached. Confirm the effective value during implementation.
- **Timeout value (#5).** Use `AbortSignal.timeout(<ms>)` on the OpenRouter fetch with a value sized for an LLM call (≈30 000 ms), not the 2 000 ms health-probe value. A timeout rejects the fetch → existing route catch → 500, so the UI's `loading→idle` reset already covers it; the test asserts the service rejects/aborts within bound rather than hangs.
- **Forced-failure is at the data seam, not the handler (#4).** Because zod + fixed `user_id` close every handler-reachable constraint, the "failed write → error" proof attempts an `insert` with a **mismatched `user_id`** through a signed-in client and asserts RLS `WITH CHECK` returns an error. The handler's error→500 _translation_ is covered by code inspection plus the success round-trip; do not fabricate a 500 by stubbing the client.
- **Apostrophe-prefix scheme (#7).** Neutralize a field whose first character is `=`, `+`, `-`, `@`, or a tab by prepending a single `'`. Benign fields are returned unchanged. Internal tab/CR/LF must still be collapsed to preserve TSV structure (preserve the existing behavior; the bug is _only_ the missing leading-char neutralization).

## Phase 1: Test-harness prerequisite — POST-capable API context

### Overview

Extend `makeApiContext` so route-handler tests can issue POST requests with a JSON body. Shared prerequisite for Phases 2 and 3.

### Changes Required:

#### 1. POST-capable `makeApiContext`

**File**: `test/helpers/handler.ts`

**Intent**: Let the helper build a `Request` with a caller-chosen `method` and JSON `body`, keeping the current GET-only call sites working unchanged. The generate-route and create round-trip tests need to POST an authenticated JSON request to a real handler.

**Contract**: Widen the `opts` parameter to `{ cookieHeader?: string; url?: string; method?: string; body?: unknown }`. When `method`/`body` are present, construct the `Request` with that method, a JSON-serialized body, and `Content-Type: application/json` (merged with the existing `Cookie` header). Default remains GET with no body. No change to `makeCookieStub` or the returned `APIContext` shape.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npx astro check`
- Lint passes: `npm run lint`
- Existing handler tests still pass (GET call sites unaffected): `npm test`

#### Manual Verification:

- A throwaway POST through `makeApiContext({ cookieHeader, method: "POST", body: {...} })` reaches a handler and the body is readable via `await context.request.json()`.

**Implementation Note**: After automated verification passes, pause for human confirmation before Phase 2.

---

## Phase 2: Generation path integrity (#3 transient input + #5 failure surfacing)

### Overview

Close the three #5 source gaps so failure surfacing is real, then cover the generate service (failure branches, mock mode, transient-input absence) and the generate route (HTTP-status translation, including the new oversized-input 400).

### Changes Required:

#### 1. Oversized-input guard + zod on the generate route

**File**: `src/pages/api/flashcards/generate.ts`

**Intent**: Replace the ad-hoc `trim()`/non-empty check with a zod schema that requires a non-empty `input` and enforces a maximum length, returning 400 on violation. Closes the #5 oversized-input gap and the zod convention drift in one edit.

**Contract**: A zod object `{ input: z.string().trim().min(1).max(<N>) }` (`safeParse`, mirroring `index.ts:34-65`). Non-JSON body → 400 (existing). Empty/whitespace → 400 `"Input is required"`. Over-max → 400 with an explanatory message. The `<N>` cap is sized to the generation use case (e.g. a few thousand characters); choose a concrete value during implementation and reuse it in the route test.

#### 2. Fetch timeout on the OpenRouter call

**File**: `src/lib/services/generate.ts`

**Intent**: Add an application-level deadline to the OpenRouter `fetch` so a hung upstream fails cleanly instead of leaving the UI in `loading` forever (the one genuine hang vector).

**Contract**: Add `signal: AbortSignal.timeout(<ms≈30000>)` to the `fetch` options at `:30`. A timeout rejects the fetch → existing route catch → 500. No change to the non-200 throw or the success shape.

#### 3. Guarded envelope parse

**File**: `src/lib/services/generate.ts`

**Intent**: Make the outer `await response.json()` robust so a 200-with-non-JSON envelope degrades to a clean failure rather than an unhandled throw.

**Contract**: Wrap the envelope parse (`:51`) so a non-JSON 200 body is handled deterministically — either treated as zero candidates (`[]`) or surfaced as the same error class the route translates to 500. Pick one and assert it; keep the inner content-parse `[]` fallback unchanged.

#### 4. Generate-service failure-branch tests

**File**: `test/generation/generate-service.test.ts` (new)

**Intent**: Drive `generateFlashcardCandidates` through every failure and edge branch using a stubbed global fetch, asserting clean degradation with no hang and no input leakage.

**Contract**: Use `vi.stubGlobal('fetch', …)` (restore in `afterEach`). Cases: non-200 response → throws; network reject → propagates; malformed model JSON → `[]`; zero / non-array `candidates` → `[]`; malformed envelope (200, non-JSON) → the chosen deterministic outcome from change #3; mock mode (`OPENROUTER_MOCK` true) → returns the fixed list without calling fetch (assert fetch not invoked). Ensure mock mode is _off_ for the fetch-stub cases (override env per-test if `.env` sets it). No Supabase, no Astro context.

#### 5. Transient-input absence guard (#3)

**File**: `test/generation/generate-service.test.ts` (same file as #4, or a sibling)

**Intent**: Prove the service result carries only `{word, translation, context}` and that a distinctive pasted-input marker never appears in the serialized result — protection by absence, the cheapest #3 signal.

**Contract**: Call the service (mock mode, or a stubbed fetch returning fixed candidates) with an input containing a unique sentinel string; assert each returned item has exactly the candidate keys and `JSON.stringify(result)` does not contain the sentinel. Document in a comment that persistence is proven by absence (no reachable insert in the generate path), not a DB scan.

#### 6. Generate-route HTTP-translation tests

**File**: `test/generation/generate-route.test.ts` (new)

**Intent**: Pin the route's status translation end-to-end through the real `POST` handler with an authenticated context.

**Contract**: Mirror `test/authz/flashcards-handler.test.ts`; gate on `isSupabaseReachable()` (the handler calls `getUser()`); use the Phase-1 POST-capable `makeApiContext`. Cases: empty input → 400; non-JSON body → 400; **oversized input (> the cap) → 400**; service throw (stub fetch to reject / non-200) → 500; valid input (mock mode) → 200 `{candidates}`. Unauthenticated (no cookie) → 401.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npx astro check`
- Lint passes: `npm run lint`
- Service + route tests pass: `npm test`
- Oversized input returns 400 (asserted in the route test)
- Fetch-stub failure branches return clean outcomes with no hang (asserted in the service test)

#### Manual Verification:

- With local Supabase up, the generate-route suite runs (not skipped) and is green.
- A manual oversized paste in the UI now yields an explanatory error from the server, not a silent full-length OpenRouter call.

**Implementation Note**: After automated verification passes, pause for human confirmation before Phase 3.

---

## Phase 3: Persistence integrity (#4 silent data loss)

### Overview

Prove accepting candidates never silently loses rows: a round-trip through the real create+list handlers returns exactly what was written, scoped to the owner; and a forced write rejection surfaces as an error, never 2xx.

### Changes Required:

#### 1. Create + list round-trip test

**File**: `test/persistence/flashcards-roundtrip.test.ts` (new)

**Intent**: POST N distinct candidates through the real `POST /api/flashcards`, then GET through the real `GET /api/flashcards`, asserting exactly those N rows come back for the caller and none for the other user.

**Contract**: Mirror `test/authz/flashcards-handler.test.ts`; seed two users (A, B); use the Phase-1 POST-capable `makeApiContext` with B's `signedInCookieHeader`. Assert each POST → 201 `{flashcard}`; GET → 200 `{flashcards}` containing exactly the N created (length + membership by word/id), every row `user_id === B.id`, none belonging to A. Gate on `isSupabaseReachable()`; `deleteUser` in `afterAll` (CASCADE).

#### 2. Forced write-rejection proof

**File**: `test/persistence/flashcards-roundtrip.test.ts` (same file)

**Intent**: Prove the data layer rejects an illegitimate write (the failure the handler's `if (error) return 500` translates), without mocking the client or adding a constraint.

**Contract**: Through a signed-in client for B, attempt `insert({ user_id: <A.id or random uuid>, word, translation })` and assert it returns an `error` (RLS `WITH CHECK` rejection), i.e. the write does **not** succeed silently. Add a comment recording why this is the chosen forcing function: zod + fixed `user_id` make a handler-reachable constraint violation impossible, so the handler's error→500 translation is covered by code inspection + the success round-trip, and the _rejection itself_ is proven here at the real DB.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npx astro check`
- Lint passes: `npm run lint`
- Round-trip + rejection tests pass: `npm test`
- Round-trip asserts exactly-N membership and owner scoping (not mere non-emptiness)

#### Manual Verification:

- With local Supabase up, the persistence suite runs (not skipped) and is green.
- Temporarily breaking the handler's `if (error)` branch (local experiment) makes the rejection intent observable; revert after.

**Implementation Note**: After automated verification passes, pause for human confirmation before Phase 4.

---

## Phase 4: Output safety — CSV formula-injection neutralization (#7)

### Overview

Fix the live CSV formula-injection vulnerability by extracting a pure serializer that apostrophe-prefixes dangerous leading characters, cover it with a fast pure unit test, and wire `export.ts` to it. Document the render-XSS deferral.

### Changes Required:

#### 1. Pure Anki serializer

**File**: `src/lib/services/anki-export.ts` (new) — or a co-located helper module; name finalized in implementation.

**Intent**: Move field/row serialization out of the route into a pure, exported, testable function that neutralizes formula-injection vectors and preserves TSV structure.

**Contract**: Export `serializeAnkiField(value: string): string` — if the first character is `=`, `+`, `-`, `@`, or a tab, prepend a single `'`; collapse internal tab/CR/LF to spaces (preserve existing structural escaping); benign fields returned unchanged. Export `buildAnkiTsv(rows: {word; translation; context: string | null}[]): string` — builds the `#separator:tab` document using `serializeAnkiField`. No DB, no env, no I/O.

#### 2. Wire the export route to the serializer

**File**: `src/pages/api/flashcards/export.ts`

**Intent**: Replace the inline `escapeField` + row build with the new helper, leaving auth, query, headers, and filename untouched.

**Contract**: Import and call `buildAnkiTsv(data)`; delete the local `escapeField`. Response shape, `Content-Type`, `Content-Disposition`, and 401/500 paths unchanged.

#### 3. CSV neutralization unit test

**File**: `test/output-safety/anki-export.test.ts` (new)

**Intent**: Assert formula-injection neutralization and benign round-trip at the pure-function layer — no DB, runs unconditionally.

**Contract**: For each of `= + - @` and a leading tab, assert `serializeAnkiField` output begins with `'`. Assert benign fields (e.g. `"hund"`, a word containing an internal `-`) are unchanged except internal-control-char collapsing. Assert `buildAnkiTsv` emits `#separator:tab` first and one tab-delimited line per row with neutralized fields. Include an adversarial fixture (`=cmd|'/c calc'!A1`) asserting it is rendered inert.

#### 4. Render-XSS deferral note

**File**: `src/pages/api/flashcards/export.ts` (or the new helper) — short comment; full rationale lands in Phase 5 cookbook.

**Intent**: Record that the render sink is intentionally untested this phase because it is non-reachable (no raw-HTML path), and a DOM test waits until DOM infra exists.

**Contract**: A one-line code comment pointing to test-plan §6.5; the substantive note is written in Phase 5.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npx astro check`
- Lint passes: `npm run lint`
- CSV unit test passes unconditionally (no Supabase gate): `npm test`
- A field beginning with `=`/`+`/`-`/`@`/tab is asserted neutralized; benign fields round-trip

#### Manual Verification:

- `GET /api/flashcards/export` for a flashcard whose `word` starts with `=` produces a file whose cell opens as literal text (not a formula) in a spreadsheet/Anki import.
- No regression in the normal export (benign rows unchanged, `#separator:tab` intact).

**Implementation Note**: After automated verification passes, pause for human confirmation before Phase 5.

---

## Phase 5: Cookbook + status sync

### Overview

Capture the generation-path cookbook so future test authors reuse the seams, and sync rollout status.

### Changes Required:

#### 1. Fill cookbook §6.5 (generation path)

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the §6.5 "TBD" with the concrete patterns this phase established.

**Contract**: Document: service-layer failure-branch testing via `vi.stubGlobal('fetch')` (and the `OPENROUTER_MOCK` mock-mode bypass caveat); the POST-capable `makeApiContext` for route tests; the transient-input absence assertion; the #4 round-trip + RLS-rejection forcing function (and _why_ a handler-reachable constraint isn't available); and the render-XSS deferral rationale. Keep it concise and reference the new test files.

#### 2. §6.6 Phase-2 note + status sync

**File**: `context/foundation/test-plan.md`

**Intent**: Append a 2-3 line §6.6 note on anything surprising (the mock-mode-bypasses-fetch gotcha; the no-trippable-constraint finding), and advance the Phase 2 rollout-table Status.

**Contract**: §3 rollout table row 2 Status → the appropriate terminal value (`complete`); §6.6 bullet added; header "Last updated" line refreshed.

#### 3. Change identity update

**File**: `context/changes/testing-generation-integrity/change.md`

**Intent**: Reflect completion.

**Contract**: `status: complete` (or `implementing` until the final phase lands), `updated: <today>`.

### Success Criteria:

#### Automated Verification:

- Full suite green: `npm test`
- Lint + typecheck clean: `npm run lint` && `npx astro check`
- `test-plan.md §6.5` no longer reads "TBD"; §3 row 2 Status updated

#### Manual Verification:

- A future contributor can follow §6.5 to add a generation-path test without re-deriving the seams.

**Implementation Note**: Final phase — after verification, the change is ready to archive via `/10x-archive`.

---

## Testing Strategy

### Unit Tests:

- Generate service failure branches (non-200, reject, malformed JSON, zero/non-array, malformed envelope, mock mode) via stubbed global fetch.
- Transient-input absence (sentinel not present in serialized result; only candidate keys).
- CSV serializer: formula-injection neutralization for `= + - @`/tab; benign round-trip; `buildAnkiTsv` structure.

### Integration Tests:

- Generate route HTTP translation (400 empty/non-JSON/oversized, 500 service-throw, 200 success, 401 unauth) through the real handler.
- Create+list round-trip (exactly-N, owner-scoped) + RLS `WITH CHECK` write rejection.

### Manual Testing Steps:

1. Paste an oversized text in the UI → explanatory server error, not a silent full call.
2. Export a flashcard whose `word` starts with `=` → cell opens as literal text in a spreadsheet.
3. Normal export still produces a valid `#separator:tab` Anki file.

## Performance Considerations

Adding `AbortSignal.timeout(≈30s)` bounds the worst-case generate latency (previously unbounded). The CSV serializer is O(n) over rows — no change. Integration suites stay fast by seeding 1-2 rows/user and skipping when Supabase is unreachable.

## Migration Notes

No schema migration. The #4 forced-failure deliberately avoids a new CHECK constraint; the forcing function is the existing RLS `WITH CHECK` policy.

## References

- Research: `context/changes/testing-generation-integrity/research.md`
- Risk map + response guidance: `context/foundation/test-plan.md` §2, §6.4, §6.5
- Canonical real-handler pattern: `test/authz/flashcards-handler.test.ts`
- Two-user spine: `test/helpers/supabase.ts`
- Lessons: `context/foundation/lessons.md` (assert outcome, not query shape)
- Source under test: `src/lib/services/generate.ts`, `src/pages/api/flashcards/{generate,index,export}.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Test-harness prerequisite — POST-capable API context

#### Automated

- [x] 1.1 Typecheck passes: `npx astro check`
- [x] 1.2 Lint passes: `npm run lint`
- [x] 1.3 Existing handler tests still pass (GET call sites unaffected): `npm test`

#### Manual

- [x] 1.4 A POST through the extended `makeApiContext` reaches a handler and the body is readable

### Phase 2: Generation path integrity (#3 + #5)

#### Automated

- [ ] 2.1 Typecheck passes: `npx astro check`
- [ ] 2.2 Lint passes: `npm run lint`
- [ ] 2.3 Service + route tests pass: `npm test`
- [ ] 2.4 Oversized input returns 400 (route test)
- [ ] 2.5 Fetch-stub failure branches return clean outcomes with no hang (service test)

#### Manual

- [ ] 2.6 With local Supabase up, the generate-route suite runs (not skipped) and is green
- [ ] 2.7 Manual oversized paste yields an explanatory server error

### Phase 3: Persistence integrity (#4)

#### Automated

- [ ] 3.1 Typecheck passes: `npx astro check`
- [ ] 3.2 Lint passes: `npm run lint`
- [ ] 3.3 Round-trip + rejection tests pass: `npm test`
- [ ] 3.4 Round-trip asserts exactly-N membership and owner scoping

#### Manual

- [ ] 3.5 With local Supabase up, the persistence suite runs (not skipped) and is green
- [ ] 3.6 Breaking the handler's error branch (local experiment) makes the rejection intent observable; reverted

### Phase 4: Output safety — CSV (#7)

#### Automated

- [ ] 4.1 Typecheck passes: `npx astro check`
- [ ] 4.2 Lint passes: `npm run lint`
- [ ] 4.3 CSV unit test passes unconditionally: `npm test`
- [ ] 4.4 Leading `=`/`+`/`-`/`@`/tab asserted neutralized; benign fields round-trip

#### Manual

- [ ] 4.5 Export of a `=`-leading word opens as literal text in a spreadsheet/Anki import
- [ ] 4.6 Benign export unchanged (`#separator:tab` intact)

### Phase 5: Cookbook + status sync

#### Automated

- [ ] 5.1 Full suite green: `npm test`
- [ ] 5.2 Lint + typecheck clean: `npm run lint` && `npx astro check`
- [ ] 5.3 §6.5 no longer reads "TBD"; §3 row 2 Status updated

#### Manual

- [ ] 5.4 A contributor can follow §6.5 to add a generation-path test without re-deriving the seams
