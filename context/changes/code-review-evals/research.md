---
date: 2026-06-19T18:51:02+0200
researcher: mariuszborek
git_commit: 34c562292d66684e7a30cde432afdaaee5fdeeab
branch: main
repository: MariuszBorek/10xCards
topic: "Eval-readiness of packages/code-reviewer and toolkit choice (promptfoo vs OSS alternatives)"
tags: [research, codebase, code-reviewer, evals, promptfoo, vitest-evals, evalite, ai-sdk, openrouter]
status: complete
last_updated: 2026-06-19
last_updated_by: mariuszborek
---

# Research: Eval-readiness of `packages/code-reviewer` and toolkit choice

**Date**: 2026-06-19T18:51:02+0200
**Researcher**: mariuszborek
**Git Commit**: 34c562292d66684e7a30cde432afdaaee5fdeeab
**Branch**: main
**Repository**: MariuszBorek/10xCards

## Research Question

Analyze the current state of `@packages/code-reviewer` for introducing evals — reusability of prompts, importability of the agent, etc. promptfoo is the first-pick eval toolkit; if the tech stack is aligned, go that direction, otherwise analyze other OSS tools for evaluating prompts and agents. Use current docs (web search / context7).

## Summary

**The package is already, deliberately, eval-ready.** Every seam an eval harness needs is exposed and side-effect-free: the public barrel exports the agent factory, the two review functions, the prompt constants, the prompt builder, and the zod schemas (`packages/code-reviewer/src/index.ts:8-29`). The functions are pure (inputs → validated `Review` object), there is a deterministic offline mock (`OPENROUTER_MOCK=true`), and there is already a Vitest suite importing the package by its workspace name (`@10xcards/code-reviewer`). You can stand up an eval without touching the package's source at all.

**On the toolkit choice: promptfoo is viable but it is NOT the best-aligned option for this stack — and the misalignment is concrete, not stylistic.** The honest reading of "if my tech stack is aligned with this tool, go that direction; otherwise analyze other OSS tools" is: _otherwise applies._ Three frictions push against promptfoo here:

1. **Node version floor.** Current promptfoo requires `^20.20.0 || >=22.22.0`. Your `.nvmrc` pins **22.14.0**, which is _below_ the 22.22.0 floor (and above the 20.x line) — so the project's pinned Node does not satisfy promptfoo. Workable (bump the eval/CI job's Node), but it is a real friction the alternatives don't have.
2. **It pulls you out of pure TypeScript.** promptfoo is YAML-config + provider-string centric; importing your TS agent means writing a `file://` custom-provider wrapper and threading `{title, body, diff}` out of promptfoo's single-`prompt`+`vars` model. Your agent is a clean async TS function — the TS-native runners call it directly.
3. **You already run Vitest 4 and a GitHub Actions AI-review workflow.** Two OSS options (`getsentry/vitest-evals`, Evalite) live _inside_ that exact stack with far less impedance.

**Recommendation to carry into planning (your call, not the research's):** the best-aligned choice is **`getsentry/vitest-evals` + `autoevals` scorers** — it runs inside your existing `vitest run`, has a first-class AI-SDK harness so both the agent and an OpenRouter LLM-judge are one configuration, ships a GitHub Action, and its `StructuredOutputJudge` maps directly onto your `{scores, summary, verdict}` shape. **Evalite** is the strong runner-up (lowest-friction dedicated runner, AI-SDK call caching, local UI, `--threshold` gate; cost = a second runner + pre-1.0). Keep **promptfoo** only if you specifically want its red-team / model-matrix breadth. All three can route the judge model through OpenRouter.

## Detailed Findings

### The package is built for reuse — the barrel is the eval surface

`packages/code-reviewer/src/index.ts:1-29` is an explicitly _side-effect-free_ barrel ("importing this module loads no `.env`, runs no demo, throws on no missing config"). It re-exports everything an eval needs:

- **Agent factory + review functions** — `createReviewAgent`, `reviewCode`, `reviewPullRequest` and their option types (`index.ts:8-9`).
- **Mock** — `buildMockReview`, `MOCK_FAIL_MARKER` (`index.ts:10`).
- **Schemas + helpers** — `ReviewSchema`, `ReviewScoresSchema`, `ReviewWireSchema`, `clampScores`, `CRITERIA`, `MIN_SCORE`, `MAX_SCORE`, and the `Review`/`ReviewScores` types (`index.ts:11-20`).
- **Prompts** — `REVIEW_INSTRUCTIONS`, `buildReviewPrompt`, `deriveVerdict`, `MAX_PROMPT_CHARS`, `TRUNCATION_MARKER`, `ReviewPromptInput` (`index.ts:21-28`).
- **Config probe** — `isMockEnabled` (`index.ts:29`).

This means an eval can (a) call the whole agent end-to-end, (b) test the prompt builder in isolation, (c) re-derive verdicts deterministically, and (d) reuse the exact production schema for output validation — without duplicating any wording or shape.

### Prompts are reusable and single-sourced

`REVIEW_INSTRUCTIONS` (the full 7-criterion 1–10 rubric + the project's flashcards RLS security heuristic + the min-threshold verdict rule) is a single exported constant (`packages/code-reviewer/src/prompts/review.ts:24-56`). `buildReviewPrompt` is a pure function with a `MAX_PROMPT_CHARS` size guard that truncates the diff (never title/body) with a visible marker (`prompts/review.ts:75-99`). The file's own header comment states the prompts were "extracted … so they can be reused by the agent and **a future eval** without duplicating wording" (`prompts/review.ts:3-7`) — the eval seam was anticipated.

`deriveVerdict` (`prompts/review.ts:109-111`) is a pure mirror of the rubric's min-threshold rule. It's an ideal **deterministic assertion**: an eval can compare the model's emitted `verdict` against `deriveVerdict(scores)` with zero LLM cost. (Note the production code uses it only as a non-overriding consistency _warning_ — `cli.ts:87-92` — so an eval enforcing equality would be net-new signal.)

### The agent is importable and config-injectable

`createReviewAgent({ model, apiKey })` (`packages/code-reviewer/src/agent/reviewer.ts:42-54`) builds an `ai@6` `ToolLoopAgent` over the OpenRouter provider with `Output.object({ schema: ReviewWireSchema })`. `model`/`apiKey` are injectable per call, falling back to env (`config.ts:19-21`, `config.ts:50-56`). **This is exactly the knob a model-comparison eval needs** — pass `model` per run to A/B `claude-sonnet-4.6` vs others against the same fixtures.

Output handling is two-stage and worth preserving in eval assertions: the provider-safe `ReviewWireSchema` (no numeric bounds — some OpenRouter providers reject `minimum`/`maximum`, `schemas/review.ts:72-83`) is sent on the wire, then `finalizeReview` clamps and strict-parses through `ReviewSchema` (`reviewer.ts:61-63`). An eval should assert on the _finalized_ `Review`.

### Deterministic mock = free, offline eval smoke path

`buildMockReview(diff)` (`packages/code-reviewer/src/agent/mock-review.ts:37-50`) returns a schema-valid `Review` purely from the diff: a diff containing `FAIL_MARKER` → failing review, else passing. `reviewPullRequest` short-circuits to it when `OPENROUTER_MOCK=true`, _before_ resolving any API key (`reviewer.ts:90-93`). This lets eval _plumbing_ (dataset loop, scorers, CI wiring, threshold gating) be tested with no key and no network — the same pattern the existing CLI tests rely on.

### Existing tests already model the eval entry pattern

There is a Vitest suite under `test/code-reviewer/` (`mock-review.test.ts`, `review-prompt.test.ts`, `review-schema.test.ts`, `cli.test.ts`). `test/code-reviewer/review-prompt.test.ts:1-8` imports straight from `@10xcards/code-reviewer` and asserts on `buildReviewPrompt`/`deriveVerdict` as pure functions — proving the workspace import resolves under Vitest today. An eval suite would sit naturally alongside these (e.g. `test/code-reviewer/*.eval.ts`) or in a sibling dir.

**Gap:** these are deterministic unit tests of pure helpers. There is currently **no quality/LLM-judge eval** — nothing scores the _content_ of a real review or regression-tests a prompt edit against golden PR fixtures. That is the hole this change fills.

### How the reviewer is consumed today (what an eval protects)

`.github/workflows/ai-code-review.yml` fetches the PR diff to a file (`gh pr diff … > pr.diff`, line 40) and calls the local composite action `./.github/actions/ai-review` (line 45) with the OpenRouter key/model, diff file, and PR title/body. An empty key (fork PR / unset secret) → `skipped=true` → graceful no-label skip. The action ultimately drives `packages/code-reviewer`'s CLI (`src/cli.ts:77-106`), which emits `{ verdict, summary, scores }` JSON on stdout and a neutral `{ verdict: null, error }` on infra failure. The workflow then upserts one marker comment and applies exactly one `ai-cr:passed`/`ai-cr:failed` label.

Implication: an eval is a **regression gate on the prompt + rubric that this production workflow depends on**. The natural trigger is a PR that touches `packages/code-reviewer/**` or the prompt files — catch rubric drift before it ships into PR gating.

### Toolkit assessment — promptfoo

promptfoo (OSS, local-first eval + red-team CLI/lib) does support this use case:

- **Importable agent** via a `file://./path.ts:exportName` custom provider; the provider fn `(prompt, context, options)` can read `context.vars` for `{title, body, diff}` and return a structured object as `output` (no re-parse needed). `.ts` providers run natively (no manual `tsx`).
- **Structured-output assertions**: `is-json` (+ JSON-Schema), `javascript` (assert on `scores.security >= 5`), `assert-set` with `threshold`, plus model-graded `llm-rubric` / `g-eval` / `factuality`.
- **OpenRouter** works as both provider and grader (`openrouter:<model>`), though the official `promptfoo/promptfoo-action` has no first-class `openrouter-api-key` input — pass it via step `env:` or run the CLI directly.
- **Datasets**: inline YAML, external YAML/JSON/JSONL, CSV (with `__expected` assertion columns), Excel/Sheets/HF, or a dynamic JS/TS generator.

**Frictions for this stack:** (1) **Node 22.14.0 < the `>=22.22.0` floor** — must bump the eval job's Node; (2) YAML-config + custom-provider wrapper pulls work out of pure TS; (3) no `openrouter-api-key` action input; (4) no native zod-validation assertion (convert to JSON Schema, or import the zod schema inside a `javascript` assertion).

Sources: promptfoo.dev/docs — custom-api, configuration/reference, expected-outputs, guides/evaluate-json, model-graded, providers/openrouter, integrations/ci-cd, test-cases, installation, red-team/quickstart (Node floor); github.com/promptfoo/promptfoo-action.

### Toolkit assessment — OSS alternatives (TS-native)

- **`getsentry/vitest-evals`** (Apache-2.0, very active — published 2026-06-18). Vitest extension: `describeEval(...)` runs inside `vitest run`. First-class **AI-SDK harness** (`packages/harness-ai-sdk`) → your OpenRouter agent drops in; built-in `FactualityJudge`, **`StructuredOutputJudge`**, `ToolCallJudge`; judge model also routes via the AI-SDK harness (→ OpenRouter). Ships a JSON reporter + **GitHub Action** (`getsentry/vitest-evals@v0`) and a local UI. _Best "stays in Vitest" + CI fit; the `StructuredOutputJudge`/`{scores,summary,verdict}` match is the standout._ URLs: github.com/getsentry/vitest-evals, vitest-evals.sentry.dev.
- **Evalite** (MIT, `evalite@0.19.x`, requires Vitest ≥3.2.4). `evalite(name, { data, task, scorers })` — `task` is an async fn you import your agent into; **caches AI-SDK model calls** (cheap re-runs); local web UI with traces; `evalite --threshold=N` exit-code CI gate. Cost: a _separate_ runner/config alongside Vitest, pre-1.0 API churn. URLs: evalite.dev, github.com/mattpocock/evalite.
- **`autoevals`** (Braintrust OSS, MIT, active 2026-06-09). A **scorer library, not a runner** — Factuality, `LLMClassifier` (custom rubric judge), Levenshtein, JSON-diff, embedding sim, RAG metrics. Works standalone (no Braintrust cloud); judge points at OpenRouter via a custom OpenAI client / `OPENAI_BASE_URL`. Pair it with vitest-evals, Evalite, or plain Vitest. Its model-graded judges are adapted from OpenAI Evals — i.e. you get OpenAI-Evals substance _in TS_.
- **Plain Vitest + autoevals** — `*.eval.test.ts`, import the agent, score with autoevals or a hand-rolled `toPassJudge` matcher. Zero new framework, max control; you own the dataset loop, aggregation, reporting, and gating. (Reference pattern: xata.io/blog/llm-evals-with-vercel-ai-and-vitest.)

**Out of scope for this stack:** DeepEval and OpenAI Evals are Python (cross-language friction; DeepEval's TS SDK is pre-GA, ~July 2026). Mastra evals only make sense if adopting Mastra. The Vercel AI SDK itself ships only unit-test mocks (`ai/test`) — no eval runner / judge.

## Code References

- `packages/code-reviewer/src/index.ts:1-29` — side-effect-free public barrel; the entire eval surface (agent, functions, prompts, schemas, mock).
- `packages/code-reviewer/src/agent/reviewer.ts:42-54` — `createReviewAgent({ model, apiKey })`, injectable model → model-comparison evals.
- `packages/code-reviewer/src/agent/reviewer.ts:61-63,90-106` — `finalizeReview` (clamp + strict parse); `reviewPullRequest` mock short-circuit.
- `packages/code-reviewer/src/prompts/review.ts:24-56` — `REVIEW_INSTRUCTIONS` (7-criterion rubric + RLS heuristic + verdict rule), single-sourced.
- `packages/code-reviewer/src/prompts/review.ts:75-99` — `buildReviewPrompt` + `MAX_PROMPT_CHARS` truncation guard.
- `packages/code-reviewer/src/prompts/review.ts:109-111` — `deriveVerdict`: pure, free deterministic assertion.
- `packages/code-reviewer/src/schemas/review.ts:67-126` — strict vs provider-safe (`ReviewWireSchema`) schemas + `clampScores`; reuse for output validation.
- `packages/code-reviewer/src/agent/mock-review.ts:13-50` — deterministic offline review for keyless/offline eval plumbing.
- `packages/code-reviewer/src/cli.ts:77-106` — CI JSON contract `{ verdict, summary, scores }` / neutral `{ verdict: null, error }`.
- `test/code-reviewer/review-prompt.test.ts:1-8` — proves `@10xcards/code-reviewer` workspace import resolves under Vitest.
- `vitest.config.ts:13-37` — Vitest 4 config (`getViteConfig`, `@/*` alias, strips the Cloudflare plugin); `include: test/**/*.test.ts` (eval files may need a glob/config tweak).
- `package.json:5-7,33` — npm workspaces (`packages/*`); `"test": "vitest run"`; Vitest 4, Playwright present.
- `packages/code-reviewer/package.json:13-25` — Node `>=22.14.0`, deps `ai@^6`, `@openrouter/ai-sdk-provider@^2.9.1`, `zod@^4`.
- `.github/workflows/ai-code-review.yml:37-52` — production consumer the eval would guard (diff → ai-review action → CLI).

## Architecture Insights

- **The eval seam was designed in, not bolted on.** Side-effect-free barrel + extracted prompt constants + exported schemas + injectable model + deterministic mock is exactly the shape an eval wants. The prompts file comment names "a future eval" as the reason for the extraction.
- **Two layers of "truth" to assert against, both reusable:** the structured **schema** (shape/range validity via `ReviewSchema`) and the **rubric rule** (`deriveVerdict` for verdict/score consistency). Deterministic assertions are free; reserve the paid LLM-judge for review-_content_ quality.
- **Mock-first plumbing.** `OPENROUTER_MOCK=true` lets the eval's non-LLM machinery (loop, scoring, gating, CI) be validated keyless — the same discipline already used for the CLI tests, and it dovetails with the workflow's existing fork-PR skip path.
- **Stack gravity points to "stay in Vitest."** Vitest 4 + a GitHub Actions AI-review workflow already exist; the lowest-friction eval lives in that same runner and CI surface (favoring vitest-evals/Evalite over a second YAML-configured tool).

## Historical Context (from prior changes)

- `context/foundation/lessons.md` — the **flashcards RLS / `user_id` defense-in-depth** lesson is encoded directly into the reviewer's security heuristic (`prompts/review.ts:48-52`). This is a prime **golden-eval fixture**: a diff that touches `flashcards` endpoints _without_ an app-layer `user_id` filter should drive the Security score down — an eval can assert exactly that, locking the lesson into the rubric. The SRS lost-update lesson is a second candidate fixture.
- No prior `context/changes/**` or `context/archive/**` research on evals exists; this is the first eval-focused change. The `packages/code-reviewer` package itself was built across recent commits (`1828b8d`, `04a6494`, `5b1722a`) culminating in the provider-safe wire schema (#7).

## Related Research

None yet — this is the first research artifact under `context/changes/`. Future eval work should link back here.

## Open Questions

1. **Toolkit decision** — go promptfoo anyway (accept the Node bump + YAML/provider friction for its red-team/matrix breadth), or pick the better-aligned `vitest-evals + autoevals`? _Research recommends the latter; the decision is the user's._
2. **Eval target** — quality eval of full reviews (LLM-judge, paid, non-deterministic), deterministic regression of prompt/verdict (free), model comparison, or all three in phases?
3. **Golden dataset** — where do fixtures live and how are they curated? The RLS/SRS lessons and real merged PR diffs are natural seeds; need expected score-floors/verdicts per fixture.
4. **CI gating policy** — gate merges on eval thresholds, or run advisory-only first? How does this coexist with the existing `ai-code-review.yml` workflow (separate job vs extension)?
5. **Cost & non-determinism control** — temperature-0 judge, fixed judge model, cache (Evalite caches AI-SDK calls; promptfoo caches eval results), and how many fixtures before per-PR cost matters.
6. **Node version** — if promptfoo: bump the eval job to ≥22.22.0; the TS-native options run on the pinned 22.14.0 as-is.
