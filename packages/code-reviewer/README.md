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

**The fixture and its planted flaws**

The single golden fixture (`eval/fixtures/react16-to-19.diff`) is a realistic
React 16→19 migration — `ReactDOM.render`→`createRoot` plus a class component
rewritten to function-with-hooks. It hides three impactful, criterion-distinct
flaws so the eval has unambiguous ground truth:

| #   | Flaw                                                                          | Criterion                   |
| --- | ----------------------------------------------------------------------------- | --------------------------- |
| 1   | XSS — unsanitized user content rendered via `dangerouslySetInnerHTML`         | security                    |
| 2   | Stale closure — polling `useEffect` omits `filter` from its dependency array  | correctness                 |
| 3   | Leaked subscription — connectivity `useEffect` adds listeners with no cleanup | errorHandling / performance |

**What the two assertions verify**

- **Deterministic (`javascript`)** — the review must `verdict: "failed"` **and**
  score the three planted criteria below 5 (`security < 5`, `correctness < 5`,
  and `errorHandling < 5 || performance < 5`). This catches a model that fails
  the review for the _wrong_ reasons.
- **g-eval judge** — a `claude-sonnet-4.6` grader (temperature 0) scores, per
  model, whether the review actually _named or penalized_ each of the three
  flaws. It averages the three per-criterion scores; the `0.67` threshold ≈
  2-of-3.

**Reading the per-model matrix**

`npm run eval:view` renders one column per model (`glm-5.1`,
`deepseek-v4-flash`, `sonnet-4.6`), each showing the deterministic pass/fail and
the g-eval score. A model that **fails** here is signal about _that model's_
review quality on this diff — not a config bug. The deterministic check tells
you whether it failed for the planted reasons; the g-eval score tells you how
many of the three flaws it surfaced. Re-runs are cached, so unchanged
prompt/fixture inputs don't re-bill.
