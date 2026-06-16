# Tool Loop Agent — Code Reviewer Modularization Implementation Plan

## Overview

Convert the monolithic `packages/code-reviewer/src/index.ts` (110 lines, everything in one file) into a well-organized, modular code-review agent built on the AI SDK `ToolLoopAgent`. Structured-output schemas and prompts move into dedicated modules, env/config is centralized, the CLI demo is separated from the library, and `index.ts` becomes a pure public barrel so a future promptfoo eval can import a stable, side-effect-free reviewer contract.

## Current State Analysis

Everything lives in `packages/code-reviewer/src/index.ts`:

- **Env + defaults** (`index.ts:13-20`): `process.loadEnvFile()` in a try/catch; `DEFAULT_MODEL = process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4.6"`.
- **Schemas** (`index.ts:22-37`): `ReviewFindingSchema`, `ReviewSchema`, plus `ReviewFinding` / `Review` inferred types.
- **Options interface** (`index.ts:39-48`): `ReviewCodeOptions { code, language?, model?, apiKey? }`.
- **Core function** (`index.ts:50-75`): `reviewCode()` resolves the API key, builds an OpenRouter model lazily via `createOpenRouter({ apiKey })`, and calls `generateText({ model, system, prompt, output: Output.object({ schema: ReviewSchema }) })`, returning `output`.
- **Presentation** (`index.ts:77-90`): `printReview()` console formatter.
- **CLI demo** (`index.ts:92-109`): `main()` with a hardcoded sample, plus the `import.meta.url === \`file://${process.argv[1]}\`` entry guard.

Key constraints discovered:

- **`ToolLoopAgent` takes a `LanguageModel` instance at construction** (`node_modules/ai/docs/07-reference/01-ai-sdk-core/16-tool-loop-agent.mdx:42-99`): `model` is required and is a provider model instance (e.g. `openrouter("anthropic/claude-sonnet-4.6")`). The current API resolves the API key **per call**, so the agent must be built by a factory that accepts config — not a module-level singleton.
- **`instructions` replaces `system`**; `output: Output.object({ schema })` is the same structured-output mechanism the current code already uses, and `await agent.generate({ prompt })` returns `{ output }` — the exact shape `reviewCode` already destructures (`node_modules/ai/docs/03-agents/02-building-agents.mdx:158-181, 283-297`).
- **Tools are optional** — a `ToolLoopAgent` with no tools is a valid, reusable structured-output agent. No tools are added in this change.
- `package.json` has `"type": "module"`, `main: "src/index.ts"`, scripts `dev`/`start` → `tsx src/index.ts`, `typecheck` → `tsc --noEmit`. tsconfig is strict + `verbatimModuleSyntax` + `noUncheckedIndexedAccess`, `module`/`moduleResolution` `NodeNext` (so relative imports use `.ts` extensions, already done in README example).
- The AI SDK skill mandates verifying APIs against `node_modules/ai/docs` (done) and running `npm run typecheck` after changes.

## Desired End State

A future promptfoo eval (configured in a later change) can do:

```ts
import { reviewCode, createReviewAgent } from "@10xcards/code-reviewer";
```

and get a validated `Review` with no import-time side effects (no `.env` load, no demo run, no env-dependent throw). `npm run dev` still runs the demo review and prints findings exactly as today. `npm run typecheck` passes.

### Key Discoveries:

- `ToolLoopAgent` constructor: `{ model, instructions, tools?, output?, id?, temperature?, ... }` — `node_modules/ai/docs/07-reference/01-ai-sdk-core/16-tool-loop-agent.mdx:42-180`.
- `agent.generate({ prompt })` → `{ output }` when `output: Output.object(...)` is set — `02-building-agents.mdx:178-181`.
- Skill folder convention is `lib/agents/` + `lib/tools/` (`.claude/skills/ai-sdk/references/type-safe-agents.md`); this plan adapts it to `src/agent/` + `src/schemas/` + `src/prompts/`.
- `NodeNext` resolution + `verbatimModuleSyntax`: relative imports must carry `.ts` extensions and type-only re-exports must use `export type`.

## What We're NOT Doing

- **Not** configuring the promptfoo eval environment (no promptfooconfig, no eval provider, no eval deps) — explicitly out of scope.
- **Not** adding tools to the agent (stays tool-less, structured-output only).
- **Not** adding a real diff/GitHub/CLI-flag pipeline — `cli.ts` keeps the existing hardcoded demo.
- **Not** changing the schemas' fields, the prompt wording, the model default, or the public `reviewCode` behavior/return type.
- **Not** adding tests or a build step (package runs from TS via `tsx`).

## Implementation Approach

Three phases, each independently verifiable via `npm run typecheck` and a `npm run dev` smoke run. Phase 1 extracts pure, dependency-free modules (config, schemas, prompts) and re-exports them from `index.ts` so the package keeps compiling. Phase 2 introduces the agent module built on `ToolLoopAgent` and re-points `reviewCode` at it. Phase 3 separates the CLI from the library barrel and updates `package.json`. The `reviewCode` signature and behavior are preserved throughout so nothing downstream breaks.

## Critical Implementation Details

- **No import-time side effects in the library path.** `process.loadEnvFile()` must NOT run at module top-level of anything reachable from `index.ts` — only `cli.ts` (the entrypoint) should load `.env`. The factory resolves the API key from explicit config or `process.env` at call time; if a future eval injects the key via env before invoking, that still works. This is the load-bearing reason `config.ts` exposes `loadEnv()` as a function rather than running it on import.
- **NodeNext extensions.** All intra-package relative imports use explicit `.ts` extensions (e.g. `from "./schemas/review.ts"`), matching the README's documented import style and required by `moduleResolution: NodeNext`.

## Phase 1: Foundational Modules (config, schemas, prompts)

### Overview

Extract the env/config logic, the zod schemas, and the prompts into standalone modules with no behavior change. Re-export schemas/types from `index.ts` so the package still type-checks and the demo still runs.

### Changes Required:

#### 1. Config module

**File**: `packages/code-reviewer/src/config.ts`

**Intent**: Centralize all environment concerns so the reusable agent never couples to `process`/`.env`. Move `DEFAULT_MODEL`, expose a `loadEnv()` function (wrapping `process.loadEnvFile()` in its existing try/catch) that callers invoke explicitly, and a `resolveApiKey(explicit?)` helper that returns the key from the argument or `OPENROUTER_API_KEY`, throwing the existing "Missing OpenRouter API key…" error when absent.

**Contract**: `export const DEFAULT_MODEL: string`; `export function loadEnv(): void`; `export function resolveApiKey(explicit?: string): string`. `loadEnv` must not run at import time.

#### 2. Schemas module

**File**: `packages/code-reviewer/src/schemas/review.ts`

**Intent**: Move `ReviewFindingSchema`, `ReviewSchema`, and the `ReviewFinding` / `Review` inferred types verbatim, with their `.describe()` annotations intact.

**Contract**: `export const ReviewFindingSchema`, `export const ReviewSchema`, `export type ReviewFinding`, `export type Review` — field-for-field identical to `index.ts:22-37`.

#### 3. Prompts module

**File**: `packages/code-reviewer/src/prompts/review.ts`

**Intent**: Extract the system prompt as a named constant and the user-prompt construction as a pure builder, preserving exact wording (including the language line and fenced code block).

**Contract**: `export const REVIEW_INSTRUCTIONS: string` (the current `system` string); `export function buildReviewPrompt(code: string, language?: string): string` (reproduces `index.ts:62,70`).

#### 4. Keep index.ts compiling

**File**: `packages/code-reviewer/src/index.ts`

**Intent**: Temporarily re-export the new schema/type/prompt/config symbols and import them where `reviewCode`/`main` use them, so the package compiles and runs at the end of Phase 1 (full barrel cleanup happens in Phase 3).

**Contract**: `index.ts` imports from the three new modules; existing exports (`ReviewFindingSchema`, `ReviewSchema`, types) remain available from `index.ts`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck` (run in `packages/code-reviewer`)
- Demo still runs and prints a review: `npm run dev`

#### Manual Verification:

- The three new files contain the schema/prompt/config logic verbatim; no field, description, or wording changed.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Agent Module on ToolLoopAgent

### Overview

Introduce `src/agent/reviewer.ts` exposing `createReviewAgent(config)` (returns a configured `ToolLoopAgent`) and reimplement `reviewCode(options)` on top of it, wired to config/schemas/prompts. Replace the `generateText` call path.

### Changes Required:

#### 1. Agent factory + reviewCode

**File**: `packages/code-reviewer/src/agent/reviewer.ts`

**Intent**: Build the reusable agent. `createReviewAgent` resolves the API key (via `resolveApiKey`) and model (via option or `DEFAULT_MODEL`), creates the OpenRouter provider model, and returns `new ToolLoopAgent({ model, instructions: REVIEW_INSTRUCTIONS, output: Output.object({ schema: ReviewSchema }) })`. `reviewCode(options)` builds an agent from `{ model, apiKey }`, calls `agent.generate({ prompt: buildReviewPrompt(code, language) })`, and returns the validated `output`. Move the `ReviewCodeOptions` interface here.

**Contract**: `export interface ReviewCodeOptions { code: string; language?: string; model?: string; apiKey?: string }`; `export function createReviewAgent(config?: { model?: string; apiKey?: string }): ToolLoopAgent<...>`; `export async function reviewCode(options: ReviewCodeOptions): Promise<Review>`. `reviewCode`'s observable behavior (inputs, validated `Review` return, missing-key error) is unchanged from `index.ts:50-75`.

Imports: `ToolLoopAgent`, `Output` from `"ai"`; `createOpenRouter` from `"@openrouter/ai-sdk-provider"`; `ReviewSchema`/`Review` from `../schemas/review.ts`; `REVIEW_INSTRUCTIONS`/`buildReviewPrompt` from `../prompts/review.ts`; `DEFAULT_MODEL`/`resolveApiKey` from `../config.ts`.

#### 2. Re-point index.ts at the agent module

**File**: `packages/code-reviewer/src/index.ts`

**Intent**: Remove the inline `reviewCode`/`ReviewCodeOptions`/`generateText` logic; import `reviewCode` (and `createReviewAgent`) from the agent module. `main`/`printReview`/guard stay for now (relocated in Phase 3).

**Contract**: `index.ts` no longer imports `generateText`/`Output`/`createOpenRouter` directly; `reviewCode` resolves to the agent module.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Demo runs end-to-end against OpenRouter and prints a structured review: `npm run dev`

#### Manual Verification:

- The demo output (summary + findings) is materially equivalent to the pre-refactor behavior for the sample snippet.
- `createReviewAgent()` returns a usable agent whose `.generate({ prompt })` yields `{ output }` matching `ReviewSchema`.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: CLI + Barrel Wiring

### Overview

Separate the CLI demo from the library, make `index.ts` a pure side-effect-free barrel, and update `package.json` so `dev`/`start` run the CLI.

### Changes Required:

#### 1. CLI module

**File**: `packages/code-reviewer/src/cli.ts`

**Intent**: Move `main()`, `printReview()`, and the `import.meta.url` entry guard here. `main()` calls `loadEnv()` first (the only place `.env` is loaded), then `reviewCode(...)` and `printReview(...)`. Imports `reviewCode` from the agent module (or the barrel) and `loadEnv`/`DEFAULT_MODEL` from config.

**Contract**: `cli.ts` is the executable entrypoint; running it reproduces today's `npm run dev` output. `printReview(review: Review): void` preserves the current formatting (`index.ts:77-90`).

#### 2. Pure barrel index.ts

**File**: `packages/code-reviewer/src/index.ts`

**Intent**: Reduce `index.ts` to re-exports only — no `main`, no entry guard, no `loadEnv` call, no top-level execution. Export the public API: `reviewCode`, `createReviewAgent`, `ReviewCodeOptions`, schemas, and types.

**Contract**: `export { reviewCode, createReviewAgent } from "./agent/reviewer.ts"`; `export type { ReviewCodeOptions } from "./agent/reviewer.ts"`; `export { ReviewFindingSchema, ReviewSchema } from "./schemas/review.ts"`; `export type { Review, ReviewFinding } from "./schemas/review.ts"`. No statement in `index.ts` executes on import (type-only re-exports use `export type` per `verbatimModuleSyntax`).

#### 3. package.json scripts

**File**: `packages/code-reviewer/package.json`

**Intent**: Point `dev` and `start` at `src/cli.ts`; leave `main` as `src/index.ts` (the library entry).

**Contract**: `"dev": "tsx src/cli.ts"`, `"start": "tsx src/cli.ts"`; `typecheck` unchanged.

#### 4. README touch-up

**File**: `packages/code-reviewer/README.md`

**Intent**: Update the "As a library" import example to reflect the barrel (`reviewCode`/`createReviewAgent` from the package root) and note the new module layout briefly.

**Contract**: README usage section imports resolve against the new public surface.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- CLI demo runs and prints findings: `npm run dev`
- `index.ts` has no top-level side effects: importing it does not load `.env` or run the demo (verify by a throwaway `tsx -e "await import('./src/index.ts')"` producing no output).

#### Manual Verification:

- Final module tree matches the plan (`config.ts`, `schemas/review.ts`, `prompts/review.ts`, `agent/reviewer.ts`, `cli.ts`, `index.ts`).
- README example is accurate.

**Implementation Note**: After completing this phase and all automated verification passes, pause for final manual confirmation.

---

## Testing Strategy

### Unit Tests:

- None added in this change (no test infra in the package yet; out of scope). Verification is via `typecheck` + demo run.

### Integration Tests:

- The `npm run dev` demo serves as a live end-to-end smoke test against OpenRouter.

### Manual Testing Steps:

1. From `packages/code-reviewer`: `npm run typecheck` → passes.
2. `npm run dev` → prints summary + findings for the sample `divide` snippet.
3. `tsx -e "import('./src/index.ts').then(m => console.log(Object.keys(m)))"` → lists the public exports, prints no demo output and does not throw on missing key.

## Performance Considerations

None — single model call per review, unchanged from current behavior.

## Migration Notes

`reviewCode`'s signature and return type are preserved, so any existing import keeps working. The only consumer-visible change is that the CLI demo now lives in `cli.ts` (reflected in `package.json` scripts); `main: src/index.ts` still resolves the library entry.

## References

- Target file: `packages/code-reviewer/src/index.ts:1-109`
- AI SDK skill: `packages/code-reviewer/.claude/skills/ai-sdk/SKILL.md`
- ToolLoopAgent API: `packages/code-reviewer/node_modules/ai/docs/07-reference/01-ai-sdk-core/16-tool-loop-agent.mdx`
- Building agents: `packages/code-reviewer/node_modules/ai/docs/03-agents/02-building-agents.mdx`
- Agent folder convention: `packages/code-reviewer/.claude/skills/ai-sdk/references/type-safe-agents.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Foundational Modules (config, schemas, prompts)

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck`
- [x] 1.2 Demo still runs and prints a review: `npm run dev`

#### Manual

- [x] 1.3 New files contain schema/prompt/config logic verbatim; nothing changed

### Phase 2: Agent Module on ToolLoopAgent

#### Automated

- [ ] 2.1 Type checking passes: `npm run typecheck`
- [ ] 2.2 Demo runs end-to-end against OpenRouter and prints a structured review: `npm run dev`

#### Manual

- [ ] 2.3 Demo output materially equivalent to pre-refactor behavior
- [ ] 2.4 `createReviewAgent()` returns a usable agent yielding `{ output }` matching `ReviewSchema`

### Phase 3: CLI + Barrel Wiring

#### Automated

- [ ] 3.1 Type checking passes: `npm run typecheck`
- [ ] 3.2 CLI demo runs and prints findings: `npm run dev`
- [ ] 3.3 `index.ts` has no top-level side effects on import

#### Manual

- [ ] 3.4 Final module tree matches the plan
- [ ] 3.5 README example is accurate
