import { DEFAULT_MODEL, loadEnv } from "./config.ts";
import type { Review } from "./schemas/review.ts";
import { reviewCode } from "./agent/reviewer.ts";

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
export { reviewCode, createReviewAgent } from "./agent/reviewer.ts";
export type { ReviewCodeOptions } from "./agent/reviewer.ts";

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
