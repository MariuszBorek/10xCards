# Tool Loop Agent — Code Reviewer Modularization — Plan Brief

> Full plan: `context/changes/tool-loop-agent/plan.md`

## What & Why

Convert the single-file `packages/code-reviewer/src/index.ts` into a modular code-review agent built on the AI SDK `ToolLoopAgent`. Schemas and prompts become standalone modules, env/config is centralized, and the agent is exposed as a reusable, side-effect-free contract so a future promptfoo eval can import it cleanly. (Eval environment itself is explicitly out of scope.)

## Starting Point

Today everything — env loading, two zod schemas, the `ReviewCodeOptions` interface, the `generateText`-based `reviewCode()`, a console formatter, and a CLI demo with an entry guard — lives in one 110-line `index.ts`. `reviewCode()` resolves the API key per call and builds the OpenRouter model lazily.

## Desired End State

`import { reviewCode, createReviewAgent } from "@10xcards/code-reviewer"` returns a validated `Review` with zero import-time side effects. `npm run dev` still runs the demo and prints findings as before. `npm run typecheck` passes. The agent is a tool-less `ToolLoopAgent` using `Output.object` for structured output.

## Key Decisions Made

| Decision             | Choice                                                            | Why (1 sentence)                                                                                                                         | Source |
| -------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Module granularity   | `schemas/`, `prompts/`, `agent/`, `cli.ts` + barrel `index.ts`    | Matches the AI SDK skill's folder convention and the task's explicit "extract schemas and prompts" ask                                   | Plan   |
| Agent construction   | `createReviewAgent(config)` factory                               | `ToolLoopAgent` needs a model at construction, but the API resolves the key per call — a factory reconciles both and stays eval-friendly | Plan   |
| Eval export contract | `reviewCode()` function + `createReviewAgent()` factory           | promptfoo wraps a single async function cleanly; factory covers advanced setups; no breaking change                                      | Plan   |
| Tools                | None (structured-output only)                                     | It's a refactor, not a feature add; a tool-less `ToolLoopAgent` is valid and leaves a clean seam                                         | Plan   |
| CLI vs library       | Demo → `cli.ts`; `index.ts` = pure barrel                         | Keeps `index.ts` import-safe (no `.env` load, no demo run) for evals                                                                     | Plan   |
| Config/env           | Dedicated `config.ts` with explicit `loadEnv()`                   | Decouples the reusable agent from `process`/`.env`; only the CLI loads `.env`                                                            | Plan   |
| Prompts shape        | `REVIEW_INSTRUCTIONS` const + `buildReviewPrompt(code, language)` | Instructions are set once at construction; the per-call prompt varies — natural fit for `ToolLoopAgent`                                  | Plan   |

## Scope

**In scope:** module split (config/schemas/prompts/agent/cli), `ToolLoopAgent`-based agent + factory, pure barrel `index.ts`, `package.json` script updates, README touch-up.

**Out of scope:** promptfoo eval config/deps, agent tools, diff/GitHub/CLI-flag pipeline, schema/prompt/model-default changes, tests, build step.

## Architecture / Approach

`config.ts` (env, default model, key resolution) and `schemas/review.ts` + `prompts/review.ts` (pure data) feed `agent/reviewer.ts`, which builds a `ToolLoopAgent` via `createReviewAgent()` and exposes `reviewCode()`. `cli.ts` is the only entrypoint that loads `.env` and runs the demo. `index.ts` re-exports the public surface with no executing statements.

## Phases at a Glance

| Phase                   | What it delivers                                                         | Key risk                                                    |
| ----------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------- |
| 1. Foundational modules | `config.ts`, `schemas/review.ts`, `prompts/review.ts` extracted verbatim | Accidentally altering schema descriptions or prompt wording |
| 2. Agent module         | `createReviewAgent` on `ToolLoopAgent` + `reviewCode` reimplemented      | `ToolLoopAgent` + `Output.object` output shape mismatch     |
| 3. CLI + barrel wiring  | `cli.ts`, side-effect-free `index.ts`, `package.json` scripts            | Residual import-time side effect in `index.ts`              |

**Prerequisites:** `OPENROUTER_API_KEY` in `.env` for live demo runs; deps already installed (`ai@6`, OpenRouter provider, zod).
**Estimated effort:** ~1 session, 3 short phases.

## Open Risks & Assumptions

- Assumes `NodeNext` `.ts`-extension relative imports (as the README already documents) compile under the strict tsconfig.
- Assumes `agent.generate({ prompt })` returns `{ output }` matching `ReviewSchema` (verified against bundled docs).
- Live `npm run dev` verification needs a valid OpenRouter key; typecheck alone does not exercise the model call.

## Success Criteria (Summary)

- `reviewCode`/`createReviewAgent` importable from the package root with no import-time side effects.
- `npm run typecheck` passes and `npm run dev` prints a structured review as before.
- Module tree matches the plan; schemas, prompts, and model default are unchanged.
