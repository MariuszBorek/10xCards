import { ToolLoopAgent, Output } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { resolveApiKey, resolveModel } from "../config.ts";
import { ReviewSchema } from "../schemas/review.ts";
import type { Review } from "../schemas/review.ts";
import { REVIEW_INSTRUCTIONS, buildReviewPrompt } from "../prompts/review.ts";

export interface ReviewCodeOptions {
  /** The source code to review. */
  code: string;
  /** Optional language hint (e.g. "typescript") to focus the review. */
  language?: string;
  /** OpenRouter model id. Defaults to `OPENROUTER_MODEL` env or claude-sonnet-4.6. */
  model?: string;
  /** OpenRouter API key. Defaults to the `OPENROUTER_API_KEY` env var. */
  apiKey?: string;
}

/**
 * Build a reusable, structured-output code-review agent.
 *
 * Resolves the API key and model from explicit config (falling back to the
 * environment / `DEFAULT_MODEL`), wires the OpenRouter provider model, and
 * returns a tool-less `ToolLoopAgent` whose `generate({ prompt })` yields a
 * zod-validated `Review` via `Output.object`.
 */
export function createReviewAgent(config?: { model?: string; apiKey?: string }) {
  const apiKey = resolveApiKey(config?.apiKey);
  const openrouter = createOpenRouter({ apiKey });
  const model = resolveModel(config?.model);

  return new ToolLoopAgent({
    model: openrouter(model),
    instructions: REVIEW_INSTRUCTIONS,
    output: Output.object({ schema: ReviewSchema }),
  });
}

/**
 * Review a snippet of code and return a zod-validated, structured report.
 */
export async function reviewCode(options: ReviewCodeOptions): Promise<Review> {
  const agent = createReviewAgent({ model: options.model, apiKey: options.apiKey });

  const { output } = await agent.generate({
    prompt: buildReviewPrompt(options.code, options.language),
  });

  return output;
}
