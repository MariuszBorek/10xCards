# Introduce promptfoo for the Code Reviewer — Plan Brief

> Full plan: `context/changes/code-review-evals/plan.md`
> Research: `context/changes/code-review-evals/research.md`

## What & Why

Add a first **promptfoo** eval inside `packages/code-reviewer` to compare how three OpenRouter models perform the _same_ code review, and to verify the reviewer actually catches real problems. It turns "the prompt seems fine" into a repeatable, judged comparison — the foundation for choosing a review model and for regression-testing future prompt edits.

## Starting Point

The package is already eval-ready: `reviewPullRequest({ title, body, diff, model })` is a pure, side-effect-free function with an **injectable model**, validated output (`{ scores, summary, verdict }`), an offline mock, and existing Vitest tests that import it by workspace name. Nothing in the production reviewer needs to change.

## Desired End State

From `packages/code-reviewer/`, `npm run eval` runs one golden React 16→19 migration fixture (with three planted flaws) against `z-ai/glm-5.1`, `deepseek/deepseek-v4-flash`, and `anthropic/claude-sonnet-4.6`, printing a per-model matrix: a deterministic "failed for the right reasons" check and a g-eval judge scoring how many of the three flaws each review identified. `promptfoo view` shows it side-by-side.

## Key Decisions Made

| Decision      | Choice                                                                  | Why (1 sentence)                                                                  | Source          |
| ------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------- |
| Eval toolkit  | promptfoo                                                               | User's explicit pick (research leaned vitest-evals; overridden by choice).        | Plan            |
| Third model   | `anthropic/claude-sonnet-4.6`                                           | It's the production default, so the matrix is "two challengers vs the incumbent." | Plan            |
| Judge target  | Existing `{summary, scores, verdict}`, no schema change                 | Keeps it a true _first config_ with zero production-code change.                  | Plan            |
| Planted flaws | XSS + stale-closure + leaked subscription                               | Three distinct criteria → unambiguous judge + score-floor assertions.             | Plan            |
| Static check  | `verdict=failed` + security/correctness/(errorHandling∨performance) < 5 | Ties pass/fail to the planted flaws, not an unrelated failure.                    | Plan            |
| Judge engine  | g-eval, grader `anthropic/claude-sonnet-4.6` @ temp 0                   | Per-criterion partial credit ("found 2 of 3") via the existing OpenRouter key.    | Plan            |
| Scope / Node  | Local-only; document Node ≥ 22.22.0 prereq                              | Smallest safe step; avoids a repo-wide `.nvmrc` bump and CI cost.                 | Research → Plan |

## Scope

**In scope:** promptfoo devDep + `eval` scripts; a class-form custom provider wrapping `reviewPullRequest`; the 3-model matrix; one React 16→19 fixture with three flaws; deterministic + g-eval assertions; an offline mock wiring test; README prereq/usage.

**Out of scope:** any production code/schema/prompt change; CI/GitHub Actions eval job; `.nvmrc` bump; additional fixtures; red-teaming; switching the production model.

## Architecture / Approach

Model comparison happens _inside_ our agent, not promptfoo's provider layer: a class provider reads each entry's `config.model`, forwards `{title, body, diff, model}` to `reviewPullRequest`, and returns the review as a JSON string. Three provider entries (one per model) share that file; one test case loads the diff from a fixture file and attaches the deterministic `javascript` assertions plus the g-eval judge (grader via `openrouter:`). The provider calls `loadEnv()` at import so `OPENROUTER_API_KEY` is present.

## Phases at a Glance

| Phase                  | What it delivers                                                              | Key risk                                                               |
| ---------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1. Scaffold + provider | promptfoo wired, provider, 3-model matrix, offline wiring test, README prereq | Node < 22.22.0 blocks local runs; per-provider `config.model` plumbing |
| 2. Golden fixture      | React 16→19 diff with three criterion-distinct flaws + test vars              | Flaws too obvious or not mapping cleanly to one criterion each         |
| 3. Assertions          | Deterministic failure check + g-eval per-flaw judge                           | Score-floor thresholds too strict/loose across models                  |
| 4. Live run + docs     | Real 3-model matrix + README interpretation                                   | Model-slug availability; judge non-determinism (mitigated by temp 0)   |

**Prerequisites:** Node ≥ 22.22.0 locally; `OPENROUTER_API_KEY`; the three OpenRouter model slugs reachable.
**Estimated effort:** ~1–2 sessions across 4 phases (fixture authoring is the main writing task).

## Open Risks & Assumptions

- **Node floor:** promptfoo needs ≥ 22.22.0; the repo pins 22.14.0 — you must run the eval on a satisfying Node (`.nvmrc`/CI left as-is by decision).
- **Thin output:** the judge sees only `summary + scores` (no findings list); a terse summary may omit a flaw the model actually scored — g-eval partial credit absorbs this, but very short summaries weaken the signal.
- **Mock can't validate the flaw assertions** (the fixture lacks `FAIL_MARKER`), so those are verified only in the live run.
- Model slugs (`z-ai/glm-5.1`, `deepseek/deepseek-v4-flash`) are assumed valid OpenRouter ids; an unavailable slug surfaces as a per-model run error.

## Success Criteria (Summary)

- `npm run eval` produces a 3-model comparison where each model gets a deterministic pass/fail and a g-eval flaw-coverage score.
- The deterministic assertion fails a model unless it returns `failed` and penalizes security, correctness, and error-handling/performance.
- The package README documents the prereq and how to run/interpret the eval; no production reviewer behavior changed.
