# Generation, persistence & output-safety integrity tests — Plan Brief

> Full plan: `context/changes/testing-generation-integrity/plan.md`
> Research: `context/changes/testing-generation-integrity/research.md`

## What & Why

Rollout Phase 2 of `test-plan.md`: defend the product's value path with unit + integration tests across four risks — transient pasted input (#3), silent data loss on accept (#4), AI-failure surfacing (#5), and untrusted-output neutralization (#7). Three risks are already defended in code, so those tests are regression guards; the work that actually changes behavior is closing #5's three latent gaps and fixing the one live vulnerability (#7 CSV formula injection).

## Starting Point

Phase 1 shipped the test spine (Vitest against local Supabase, the two-user helpers, the real-handler pattern, the reachability skip-gate). The generate path never persists/echoes input, the create handler returns 500 before 201 on a failed write, and the render sink is auto-escaped — all already correct. But the generate route has no oversized-input guard and no fetch timeout (a real hang vector), and `export.ts` writes CSV fields with a leading `= + - @` verbatim → spreadsheet formula injection.

## Desired End State

`npm test` runs a Phase-2 suite that guards transient-input absence, drives every generation failure branch through a stubbed fetch, round-trips accepted candidates through the real handlers, and proves a dangerous CSV cell is neutralized. The generate route rejects oversized input (400), the OpenRouter fetch has a deadline, and the Anki export apostrophe-prefixes formula-injection vectors. The cookbook §6.5 is filled and the rollout status advanced.

## Key Decisions Made

| Decision            | Choice                                                           | Why (1 sentence)                                                                                                        | Source          |
| ------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------- |
| #5 gap scope        | Close all three (oversized guard, fetch timeout, envelope parse) | The risk response requires _proving_ protection, which can't exist for a missing guard; timeout is the true hang vector | Plan            |
| #7 CSV fix shape    | Extract pure serializer + unit test                              | Cheapest durable seam; runs unconditionally with no DB                                                                  | Research / Plan |
| CSV neutralization  | Apostrophe-prefix dangerous leading chars                        | OWASP-standard CSV-injection defense; minimal, non-lossy, Anki-safe                                                     | Plan            |
| #4 forcing function | RLS `WITH CHECK` rejection at the data seam                      | Zod + fixed `user_id` make no DB constraint trippable through the handler; mock-free per strategy                       | Plan            |
| OpenRouter mocking  | `vi.stubGlobal('fetch')`                                         | Single hardcoded URL; no new dependency; mocks only the network edge                                                    | Research / Plan |
| Render-XSS test     | Defer, document why                                              | Sink is non-reachable (no raw-HTML path); adding DOM infra is disproportionate                                          | Research / Plan |

## Scope

**In scope:** transient-input absence guard (#3); generate service failure-branch + route HTTP-translation tests, plus closing the 3 #5 source gaps; create+list round-trip + RLS-rejection (#4); CSV serializer refactor + apostrophe-prefix fix + unit test (#7); POST-capable `makeApiContext`; cookbook §6.5 + status sync.

**Out of scope:** render-XSS DOM test and any jsdom/happy-dom dep; MSW; mocking the Supabase data layer; a new CHECK-constraint migration; generation-quality eval; rate-limit/abuse tests; e2e/CI gates (Phase 3 of the rollout); batch-accept or client refactors; RLS/risk redefinition.

## Architecture / Approach

Schedule the shared harness change first (POST-capable `makeApiContext`), then go risk-by-risk. Each phase pairs the cheapest seam research found with the minimal source change that lets the test assert _protected_ behavior: generate service/route tests use a stubbed global fetch (no new dep); persistence tests mirror the real-handler integration pattern; the CSV fix is a pure refactor + unconditional unit test. Every assertion targets behavior/outcome, never code shape.

## Phases at a Glance

| Phase                      | What it delivers                     | Key risk                                                    |
| -------------------------- | ------------------------------------ | ----------------------------------------------------------- |
| 1. Harness prerequisite    | POST-capable `makeApiContext`        | Breaking existing GET call sites                            |
| 2. Generation path (#3+#5) | 3 gaps closed; service + route tests | Mock-mode bypasses fetch; env override needed               |
| 3. Persistence (#4)        | Round-trip + RLS-rejection proof     | Forced-failure proven at data seam, not handler 500 branch  |
| 4. Output safety (#7)      | CSV serializer fix + pure unit test  | Neutralization must not corrupt benign fields/TSV structure |
| 5. Cookbook + status       | §6.5 filled, rollout status synced   | Drift between docs and shipped tests                        |

**Prerequisites:** Local Supabase up (`npx supabase start` + keys in `.env`) for the integration suites; Phase 1 spine already in place.
**Estimated effort:** ~2-3 sessions across 5 phases (Phases 1 & 4 small; 2 & 3 carry the integration weight).

## Open Risks & Assumptions

- `OPENROUTER_MOCK` short-circuits before fetch; failure-branch tests must run with it off (override per-test if `.env` sets it) or the stubbed fetch is never reached.
- The #4 forced-failure proves rejection at the DB layer; the handler's error→500 _translation_ rests on code inspection + the success round-trip, since no handler-reachable constraint exists.
- Worker-runtime log leakage (#3, research Open Q1) is not observable from the in-process Vitest seam — documented as out-of-band, not asserted.

## Success Criteria (Summary)

- A user pasting oversized text gets an explanatory server error; a hung OpenRouter call fails within a deadline instead of hanging.
- Accepting N candidates returns exactly those N on reload; a failed write never reports success.
- A flashcard whose field starts with `=`/`+`/`-`/`@` exports as inert literal text, safe to import into Anki/spreadsheets.
