import { generateText, Output } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { DEFAULT_MODEL, loadEnv, resolveApiKey } from "./config.ts";
import { ReviewSchema } from "./schemas/review.ts";
import type { Review } from "./schemas/review.ts";
import { REVIEW_INSTRUCTIONS, buildReviewPrompt } from "./prompts/review.ts";

/**
 * Entry point for the AI-powered code reviewer.
 *
 * Wires together the AI SDK (`ai`), the OpenRouter provider, and zod-validated
 * structured output. This is intentionally small — a foundation that further
 * integration (CLI flags, diff parsing, GitHub comments, etc.) can build on.
 */

// Node 22 loads `.env` natively — no `dotenv` dependency needed.
loadEnv();

// Re-export the foundational modules so existing imports keep resolving from
// the barrel; the full public-surface cleanup lands in Phase 3.
export { ReviewFindingSchema, ReviewSchema } from "./schemas/review.ts";
export type { Review, ReviewFinding } from "./schemas/review.ts";

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
 * Review a snippet of code and return a zod-validated, structured report.
 */
export async function reviewCode(options: ReviewCodeOptions): Promise<Review> {
  const apiKey = resolveApiKey(options.apiKey);

  const openrouter = createOpenRouter({ apiKey });
  const model = options.model ?? DEFAULT_MODEL;

  const { output } = await generateText({
    model: openrouter(model),
    system: REVIEW_INSTRUCTIONS,
    prompt: buildReviewPrompt(options.code, options.language),
    output: Output.object({ schema: ReviewSchema }),
  });

  return output;
}

/** Pretty-print a review to the console. */
function printReview(review: Review): void {
  console.log(`\nSummary: ${review.summary}\n`);
  if (review.findings.length === 0) {
    console.log("No issues found. ✅");
    return;
  }
  for (const f of review.findings) {
    const where = f.line === null ? "" : ` (line ${f.line})`;
    console.log(`[${f.severity.toUpperCase()}] ${f.title}${where}`);
    console.log(`  ${f.detail}`);
    console.log(`  → ${f.suggestion}\n`);
  }
}

/** Demo run when executed directly via `npm run dev`. */
async function main(): Promise<void> {
  const sample = `function divide(a, b) {
  return a / b;
}`;

  console.log(`Reviewing sample code with model: ${DEFAULT_MODEL}`);
  const review = await reviewCode({ code: sample, language: "javascript" });
  printReview(review);
}

// Run main() only when this file is the entry point, not when imported.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
