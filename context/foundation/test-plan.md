# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-01 (Phase 1 change opened; Risk #7 — AI output-safety — added)

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in <area>"
   carry the same weight as PRD lines or hot-spot data. The top risk here
   (cross-account data leak) is both a PRD catastrophe-tier guardrail and a
   lived incident the author was burned by in a prior project.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/` (excluding
`node_modules`, `dist`, `.astro`, build output). 25 commits in the last
30 days — sufficient signal.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|--------------------------|--------|------------|--------------------------------|
| 1 | A flashcard API endpoint returns or mutates another user's flashcard — ownership is not enforced on that operation, so user B reaches user A's data or pasted text | High | High | PRD Guardrails §Izolacja danych; interview Q1, Q3; hot-spot dir `src/pages/api` (12 commits/30d) |
| 2 | An RLS policy on the flashcards table is missing or too permissive for one operation (SELECT/INSERT/UPDATE/DELETE) after a migration, leaking rows at the database layer | High | High | PRD Guardrails §Izolacja danych; interview Q2 (lived RLS-leak incident); CLAUDE.md hard rule "RLS mandatory"; `supabase/migrations` (2 migrations) |
| 3 | Text pasted for AI generation persists somewhere operator-accessible (a stored row, the response body) after the request that consumed it — violates the transient-input guardrail | High | Medium | PRD NFR §transient input + Guardrails; hot-spot dir `src/lib/services` (3/30d, generation path) |
| 4 | A user accepts AI candidates (or adds one manually), receives success, but the rows never land — or a failed write returns 2xx — and the collection shows empty (silent data loss) | High | Medium | PRD Guardrails §brak utraty fiszek; US-01 acceptance criteria; hot-spot dirs `src/components/generate` (6/30d) + `src/components/collection` (6/30d) |
| 5 | AI generation failure is not surfaced cleanly: an OpenRouter error/timeout, oversized input, or a zero-candidate result leaves the screen hanging or faking success; a malformed model response crashes parsing | Medium | High | PRD NFR §progress feedback; US-01 acceptance criteria (empty-input error, zero-candidate empty state); PRD Open Questions Q1–Q3; hot-spot dir `src/components/generate` (6/30d) |
| 6 | A middleware change lets an unauthenticated request reach a protected route or API endpoint, or logs authenticated users out | High | Medium | PRD §Access Control; hot-spot `src/middleware.ts` (4/30d); hot-spot dir `src/components/auth` (6/30d) |
| 7 | Untrusted model/candidate output is treated as trusted: pasted text or a hallucinated response drives content that is rendered into the UI or written to the CSV export without neutralization — enabling stored XSS in the collection/candidate view, or spreadsheet formula injection on the Anki export. Prompt injection is one trigger; hallucinated control characters are another, so the failure does not require an attacker | High | Medium | PRD FR-004 (accepts arbitrary foreign-language input) + FR-011/US-02 (CSV export to Anki); §2 abuse lens (untrusted input → injection / unsafe output handling); hot-spot dirs `src/components/generate` (6/30d), `src/lib/services` (3/30d) |

5–7 rows; every row cites at least one source.

**Abuse / security lens.** The product has authentication and accepts
untrusted user input, so the map must carry abuse scenarios. Risk #1
(authorization / IDOR — endpoint checks *ownership*, not just
*authentication*) and Risk #2 (RLS backstop) are the load-bearing abuse
rows. **Untrusted input / injection** is carried by Risk #7 (model and
candidate output treated as trusted → stored XSS on render and formula
injection on CSV export; prompt injection is one trigger, hallucination
another). Secret/PII leakage is partially covered by Risk #3 (input must not
escape into responses or stored rows). **Resource abuse** — unrate-limited,
costly OpenRouter calls triggered in a loop — is a real surface but
deprioritized for this MVP (small, private, single-user deployment, no
payments); noted in §7 as a watch item, not a Phase 1–3 test.

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|------|-----------------------------|----------------|--------------------------------------|-----------------------|-----------------------|
| #1 | A request by user B for user A's flashcard id is denied (404/403); list, export, review, and update never cross accounts | "Logged-in implies authorized" — authentication is not ownership | How each flashcard endpoint scopes its query to the caller; the auth/session shape carried into the handler | integration (two seeded users) | Happy-path-only single-user test; over-mocking the data layer so the ownership check never actually runs |
| #2 | With user B's credentials, a direct SELECT/UPDATE/DELETE of user A's row returns nothing / is denied | "The app-layer check is enough" — RLS is the backstop and must be exercised directly | The actual policies per operation; how `auth.uid()` reaches the policy under SSR | integration / direct-DB against local Supabase | Asserting only the app path; trusting the migration without exercising the policy with a second user |
| #3 | After a generation request, the raw input is absent from any persisted row and from the response body | "It's gone because we didn't deliberately save it" — verify, don't assume | The lifecycle of the pasted input; whether it is stored, echoed, or logged | integration | Mirroring the implementation; a logging assertion that cannot actually observe Worker logs (research must confirm what is observable) |
| #4 | Accepting N candidates, then reloading the collection, returns exactly those N; a forced write failure returns a non-2xx status | "200 means it persisted" | The persist path and its error translation (what the handler does when the write fails) | integration | Assertion copied from the handler's own logic; mocking the write so it can never fail |
| #5 | Empty input yields an explanatory error (not a blank candidate list); a mocked OpenRouter error yields a clean failure with no hang; zero candidates yields the empty state | "A final 200 status means it worked" | The OpenRouter boundary, the response-parse step, and oversized-input handling | integration (OpenRouter mocked at the network edge) | Oracle lifted from the parser under test; covering only the happy generation path |
| #6 | An unauthenticated request to a protected route or API endpoint is redirected / returns 401 — never data | "Protected pages imply protected APIs" — gating must be verified on both | Which paths middleware actually guards; route coverage vs API coverage | integration | A brittle full-stack e2e where an integration test against the middleware suffices |
| #7 | Adversarial content in a flashcard field is neutralized at both sinks: it renders as inert text (no script execution) in the collection/candidate view, and a field beginning with `=`,`+`,`-`,`@`, or tab is made inert in the exported CSV | "The output is safe because the user pasted the input" — output is untrusted regardless of source (injection OR hallucination); "React auto-escapes, so we're covered" — only true until a raw-HTML sink exists | Every place candidate/flashcard content is rendered (any `dangerouslySetInnerHTML` / raw-HTML path); how the CSV serializer encodes fields; whether any validation exists at the generate boundary | unit (CSV field-neutralization) + integration (render-escaping with an adversarial fixture) | Testing only benign content; using the model's own output as the oracle; assuming auto-escaping covers every sink without checking for raw-HTML paths |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|------------|-----------------|----------------|------------|--------|---------------|
| 1 | Runner bootstrap + authorization/RLS coverage | Stand up the integration runner against local Supabase and prove cross-account isolation at the app and DB layers plus auth gating | #1, #2, #6 | unit + integration | change opened | context/changes/testing-runner-bootstrap-authz/ |
| 2 | Generation, persistence & output-safety integrity | Defend the value path: no silent loss on accept, transient input never persists, AI failure/empty/zero-candidate paths surface cleanly, and untrusted model output is neutralized before render and CSV export | #3, #4, #5, #7 | unit + integration | not started | — |
| 3 | Quality-gates wiring | Lock the floor in CI (lint, typecheck, unit+integration) plus one e2e on paste→generate→accept→export | cross-cutting | gates + e2e | not started | — |

**Status vocabulary** (fixed — parser literals): `not started` →
`change opened` → `researched` → `planned` → `implementing` → `complete`.

No AI-native phase is included. Justification under cost × signal: every
user-losing risk in §2 (cross-account leak, silent loss, auth bypass) is
deterministic and cheaply caught by integration tests. A generation-quality
eval (LLM-as-judge for the ≥75% acceptance metric) has a fuzzy oracle and
tiny MVP sample sizes; the human accept/reject loop already *is* the quality
gate. Deferred to §7 rather than padded into the rollout.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

| Layer | Tool | Version | Notes |
|-------|------|---------|-------|
| unit + integration | none yet — see §3 Phase 1 | — | Vitest is the candidate (Astro's recommended runner; integrates with the Vite-based config). Phase 1 wires it. |
| API mocking | none yet — see §3 Phase 1 | — | MSW (or a network-edge fetch mock) to stub the OpenRouter boundary; mock only at the network edge, never internal modules. |
| local Supabase | `supabase` CLI | (CLI) | `npx supabase start` + `npx supabase db reset` give a real Postgres with RLS for Risk #1/#2 integration tests. |
| e2e | none yet — see §3 Phase 3 | — | Playwright is the candidate for the single paste→generate→accept→export critical flow. |
| accessibility | none yet | — | Out of MVP scope; the desktop-only NFR keeps this low priority. |
| (optional) AI-native | not included | n/a | When NOT to use: generation-quality eval where the human review loop is already the oracle (see §3 rationale + §7). |

Stack baseline (from `package.json`): Astro `^6.3.1`, React `^19.2.6`,
TypeScript `^5.9.3`, Tailwind `^4.2.4`, `@astrojs/cloudflare ^13.5.0`,
`@supabase/ssr ^0.10.3`, `@supabase/supabase-js ^2.99.1`. Runtime is
Cloudflare Workers (`nodejs_compat`); tests must account for the workerd
runtime where they exercise route handlers.

**Stack grounding tools (current session):**
- Docs: Context7 — available; use for current Vitest + Astro integration and `@supabase/ssr` test setup APIs when Phase 1 wires the runner; checked: 2026-06-01.
- Search: Exa.ai — available; use only to find current official docs / status (e.g. supabase CLI test patterns), then prefer the primary source; checked: 2026-06-01.
- Runtime/browser: none used yet — Playwright MCP not confirmed in session; Playwright is the e2e candidate for §3 Phase 3, to be verified then; checked: 2026-06-01.
- Provider/platform: Supabase MCP — available (relevant for grounding RLS policy verification in Phase 1); Cloudflare skills — available (relevant for workerd-runtime test concerns); checked: 2026-06-01.

Use docs MCPs for current framework/library APIs and setup details. Use
search MCPs for discovery or current status only. Do not use MCP docs/search
to infer code failure anchors; those belong in per-phase `/10x-research`.

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate | Where | Required? | Catches |
|------|-------|-----------|---------|
| lint + typecheck (`npm run lint`, `npx astro check`) | local + CI | required | syntactic / type drift |
| unit + integration | local + CI | required after §3 Phase 1 | authorization/RLS leaks, silent loss, generation-path regressions |
| e2e on critical flow (paste→generate→accept→export) | CI on PR | required after §3 Phase 3 | broken critical user path end-to-end |
| post-edit hook | local (agent loop) | recommended (later module) | regressions at edit time |
| visual diff (deterministic) | CI on PR | optional | rendering regressions (low priority — cosmetic UI is negative space, §7) |
| pre-prod smoke | between merge + prod | optional | Cloudflare/workerd environment-specific failures |

lint + typecheck already run in CI (`.github/workflows/ci.yml`). The
unit+integration and e2e gates are wired by the named rollout phases.

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once the
relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase N."

### 6.1 Adding a unit test

- TBD — see §3 Phase 1 (runner bootstrap establishes location, naming, and run command).

### 6.2 Adding an integration test

- TBD — see §3 Phase 1 (cross-account authorization/RLS pattern: seed two users, assert user B cannot reach user A's rows at the app and DB layers).

### 6.3 Adding an e2e test

- TBD — see §3 Phase 3 (paste→generate→accept→export critical flow).

### 6.4 Adding a test for a new API endpoint

- TBD — see §3 Phase 1. Expected pattern: an integration test that exercises the route handler against local Supabase with a seeded authenticated user, asserting both the response shape AND the ownership/side-effect (a second user must be denied). Mock only the external HTTP edge (OpenRouter).

### 6.5 Adding a test for the generation path

- TBD — see §3 Phase 2 (silent-loss on accept, transient-input non-persistence, AI failure/empty/zero-candidate states with OpenRouter mocked at the network edge, and output-safety neutralization: XSS-inert render + CSV formula-injection neutralization with an adversarial fixture).

### 6.6 Per-rollout-phase notes

(Optional. After each phase lands, `/10x-implement` appends a 2–3 line note
here capturing anything surprising the phase taught.)

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **Cosmetic UI slices** (S-04 background/button styling, S-05 nav-bar appearance) — break often, catch nothing. Re-evaluate only if a visual regression causes a real user-facing failure. (Source: Phase 2 interview Q5.)
- **shadcn/ui primitives** (`src/components/ui`) — vendored; the upstream library is the test. Re-evaluate if a primitive is forked/customized with project logic. (Source: Phase 2 interview Q5.)
- **AI generation-quality eval** (LLM-as-judge for the ≥75% acceptance metric) — fuzzy oracle, tiny MVP sample sizes; the human accept/reject loop is the oracle and the metric is tracked in product analytics, not in tests. Re-evaluate if generation quality becomes a regression source or sample volume grows. (Source: §3 cost × signal rationale.)
- **SRS read-modify-write lost update** (flagged in `lessons.md`) — known latent hazard; single-writer in the MVP (client disables buttons during submit). Not a test now. Re-evaluate — with a cheap optimistic-concurrency unit test — as soon as a flashcard row can have more than one concurrent writer (multi-device, background jobs). (Source: `lessons.md`.)
- **OpenRouter cost/rate-limit abuse** — costly generation calls in a loop. Deprioritized for a small private single-user deployment with no payments. Re-evaluate if the app opens to untrusted users. (Source: §2 abuse lens.)
- **Model-level prompt-injection red-teaming** (jailbreaks, system-prompt exfiltration, making the model misbehave) — out of scope. The single-user private threat model makes "user attacks themselves" low-value. Risk #7 instead tests that *output is neutralized at the render and CSV-export sinks* regardless of whether hostile content arrived via injection or hallucination — a deterministic, cheap oracle. Re-evaluate if the app opens to untrusted users or ever renders one user's content to another. (Source: §2 abuse lens.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-01
- Stack versions last verified: 2026-06-01
- AI-native tool references last verified: 2026-06-01

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
