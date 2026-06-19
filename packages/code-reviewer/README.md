# @10xcards/code-reviewer

AI-powered code reviewer built on the [AI SDK](https://ai-sdk.dev/) (`ai@6`) with the
[OpenRouter](https://openrouter.ai/) provider and zod-validated structured output.
Runs on Node 22 directly from TypeScript via [`tsx`](https://tsx.is/).

## Setup

```bash
npm install
cp .env.example .env   # then add your OPENROUTER_API_KEY
```

## Usage

```bash
npm run dev        # runs the demo review in src/cli.ts
npm run typecheck  # tsc --noEmit
```

As a library:

```ts
import { reviewCode, createReviewAgent } from "@10xcards/code-reviewer";

// One-shot review:
const review = await reviewCode({ code: "...", language: "typescript" });
console.log(review.summary, review.findings);

// Or build a reusable, structured-output agent:
const agent = createReviewAgent();
const { output } = await agent.generate({ prompt: "Review: ..." });
```

The package root (`src/index.ts`) is a side-effect-free barrel — importing it
loads no `.env` and runs no demo. Module layout:

- `config.ts` — env/config (`DEFAULT_MODEL`, `loadEnv`, `resolveApiKey`)
- `schemas/review.ts` — zod schemas + inferred types
- `prompts/review.ts` — review instructions + prompt builder
- `agent/reviewer.ts` — `createReviewAgent` + `reviewCode`
- `cli.ts` — the demo entrypoint (`npm run dev`)
- `index.ts` — public API barrel

## Configuration

| Env var              | Default                       | Description               |
| -------------------- | ----------------------------- | ------------------------- |
| `OPENROUTER_API_KEY` | _(required)_                  | OpenRouter API key        |
| `OPENROUTER_MODEL`   | `anthropic/claude-sonnet-4.6` | Model id used for reviews |

`.env` is loaded natively by Node 22 (`process.loadEnvFile`) — no `dotenv` needed.

## Evals (promptfoo)

The same production review prompt is evaluated across three OpenRouter models
against one golden fixture using [promptfoo](https://www.promptfoo.dev/).

**Prerequisites**

- Node ≥ 22.22.0 (promptfoo's current floor; the repo pins 22.14.0, so the eval
  is run locally on a newer Node — `.nvmrc` and CI are left untouched).
- `OPENROUTER_API_KEY` set (in this package's `.env` or the environment).

**Run**

```bash
cd packages/code-reviewer
npm run eval           # promptfoo eval -c promptfooconfig.yaml
npm run eval:view      # open the side-by-side comparison UI
npm run eval:validate  # check the config + provider load
```

The provider is loaded as a TypeScript module, so the scripts run promptfoo
under the [`tsx`](https://tsx.is/) loader (`NODE_OPTIONS="--import tsx"`) — there
is no build step for the package's TS source.

The matrix lives inside the agent: each provider entry in
`promptfooconfig.yaml` carries a distinct `config.model` that the wrapper
(`eval/review-provider.ts`) forwards into `reviewPullRequest({ model })`.
