/**
 * promptfoo custom provider that wraps the production code reviewer.
 *
 * promptfoo only sees an opaque input/output pair, so the model-comparison
 * matrix is achieved *inside* our agent: each provider entry in
 * `promptfooconfig.yaml` carries a distinct `config.model`, which this provider
 * forwards to `reviewPullRequest({ model })`. The review is returned as a JSON
 * string so deterministic `javascript` assertions can `JSON.parse(output)` and
 * the g-eval grader can read the full review text.
 *
 * This file is an *entrypoint* (like `cli.ts`), so — unlike the side-effect-free
 * barrel — it may call `loadEnv()` at import to populate `OPENROUTER_API_KEY`.
 * Run the eval from `packages/code-reviewer/` where its `.env` lives.
 */

import type { ApiProvider, CallApiContextParams, ProviderOptions, ProviderResponse } from "promptfoo";
import { reviewPullRequest } from "../src/index.ts";
import { loadEnv } from "../src/config.ts";

// Ensure OPENROUTER_API_KEY (and OPENROUTER_MOCK) are in process.env before any
// review call. Mirrors cli.ts; safe in an entrypoint.
loadEnv();

export default class ReviewProvider implements ApiProvider {
  private readonly providerId: string;
  private readonly model?: string;

  constructor(options: ProviderOptions) {
    this.providerId = options.id ?? "review-provider";
    this.model = (options.config as { model?: string } | undefined)?.model;
  }

  id(): string {
    return this.providerId;
  }

  async callApi(_prompt: string, context?: CallApiContextParams): Promise<ProviderResponse> {
    const vars = (context?.vars ?? {}) as { title?: string; body?: string; diff?: string };

    try {
      const review = await reviewPullRequest({
        title: vars.title ?? "Pull request",
        body: vars.body,
        diff: vars.diff ?? "",
        model: this.model,
      });
      return { output: JSON.stringify(review) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }
}
