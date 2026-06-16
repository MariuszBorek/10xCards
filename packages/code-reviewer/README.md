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
npm run dev        # runs the demo review in src/index.ts
npm run typecheck  # tsc --noEmit
```

As a library:

```ts
import { reviewCode } from "./src/index.ts";

const review = await reviewCode({ code: "...", language: "typescript" });
console.log(review.summary, review.findings);
```

## Configuration

| Env var              | Default                       | Description               |
| -------------------- | ----------------------------- | ------------------------- |
| `OPENROUTER_API_KEY` | _(required)_                  | OpenRouter API key        |
| `OPENROUTER_MODEL`   | `anthropic/claude-sonnet-4.6` | Model id used for reviews |

`.env` is loaded natively by Node 22 (`process.loadEnvFile`) — no `dotenv` needed.
